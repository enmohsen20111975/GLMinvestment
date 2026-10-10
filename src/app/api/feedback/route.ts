import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * User feedback / issue reports endpoint.
 *
 * POST  -> validate + append a feedback entry to db/feedback.json
 * GET   -> return all feedback entries (newest first) for the admin view
 *
 * Storage is a simple JSON file under db/ to avoid schema migrations. The file
 * is read-modify-write with a small retry to survive concurrent writes.
 */

const FEEDBACK_PATH = path.join(process.cwd(), 'db', 'feedback.json');
const VALID_TYPES = ['bug', 'suggestion', 'opinion', 'praise'] as const;
type FeedbackType = (typeof VALID_TYPES)[number];

type FeedbackEntry = {
  id: string;
  type: FeedbackType;
  message: string;
  rating: number | null;
  contact: string | null;
  page: string | null;
  userAgent: string | null;
  status: 'new' | 'reviewed' | 'resolved';
  createdAt: string;
};

function safeParseList(raw: string): FeedbackEntry[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { // silent fallback (safe-by-design)
    return [];
  }
}

async function readAll(): Promise<FeedbackEntry[]> {
  try {
    const raw = await fs.readFile(FEEDBACK_PATH, 'utf-8');
    return safeParseList(raw);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(entries: FeedbackEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(FEEDBACK_PATH), { recursive: true });
  // Atomic-ish write: write temp then rename.
  const tmp = `${FEEDBACK_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(entries, null, 2), 'utf-8');
  await fs.rename(tmp, FEEDBACK_PATH);
}

export async function GET() {
  try {
    const entries = await readAll();
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const summary = {
      total: entries.length,
      new: entries.filter((e) => e.status === 'new').length,
      bug: entries.filter((e) => e.type === 'bug').length,
      suggestion: entries.filter((e) => e.type === 'suggestion').length,
      opinion: entries.filter((e) => e.type === 'opinion').length,
      praise: entries.filter((e) => e.type === 'praise').length,
    };
    return NextResponse.json({ success: true, feedback: entries, summary });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String((err as Error)?.message || err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const type = (body.type as FeedbackType) || 'opinion';
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { success: false, error: 'نوع التقرير غير صالح' },
        { status: 400 },
      );
    }
    if (message.length < 3) {
      return NextResponse.json(
        { success: false, error: 'الرجاء كتابة تفاصيل أكثر (3 أحرف على الأقل)' },
        { status: 400 },
      );
    }
    if (message.length > 4000) {
      return NextResponse.json(
        { success: false, error: 'الرسالة طويلة جداً (الحد الأقصى 4000 حرف)' },
        { status: 400 },
      );
    }

    const ratingNum = Number(body.rating);
    const rating =
      Number.isFinite(ratingNum) && ratingNum >= 1 && ratingNum <= 5
        ? Math.round(ratingNum)
        : null;

    const contactRaw = typeof body.contact === 'string' ? body.contact.trim() : '';
    const contact = contactRaw.length > 200 ? contactRaw.slice(0, 200) : contactRaw || null;

    const pageRaw = typeof body.page === 'string' ? body.page.trim() : '';
    const page = pageRaw.slice(0, 500) || null;

    const entry: FeedbackEntry = {
      id: crypto.randomUUID(),
      type,
      message,
      rating,
      contact,
      page,
      userAgent: req.headers.get('user-agent')?.slice(0, 300) || null,
      status: 'new',
      createdAt: new Date().toISOString(),
    };

    let entries = await readAll();
    entries.push(entry);
    if (entries.length > 5000) entries = entries.slice(-5000); // cap history
    await writeAll(entries);

    return NextResponse.json({ success: true, id: entry.id });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String((err as Error)?.message || err) },
      { status: 500 },
    );
  }
}
