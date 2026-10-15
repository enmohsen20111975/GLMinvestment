import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

const HELPER = "/home/z/my-project/GLMinvestment/scripts/dcs_data.py";
const PYTHON = "/home/z/.venv/bin/python3";

const TTL = 3000;
const cache = new Map<string, { t: number; data: unknown }>();

const ALLOWED = new Set([
  "overview", "stocks", "indicators", "signals",
  "feeds", "crypto", "risk-guard", "screener", "topology",
]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ view: string }> }
) {
  const { view } = await params;
  if (!ALLOWED.has(view)) {
    return NextResponse.json(
      { error: `unknown view '${view}'`, available: [...ALLOWED] },
      { status: 400 }
    );
  }
  const url = new URL(req.url);
  const limit = url.searchParams.get("limit");
  const symbol = url.searchParams.get("symbol");
  const bars = url.searchParams.get("bars");
  const args: string[] = [HELPER, view];
  if (view === "indicators") {
    args.push(symbol || "COMI");
    if (bars) args.push(bars);
  } else if (["stocks", "signals", "crypto", "screener"].includes(view) && limit) {
    args.push(limit);
  }
  const cacheKey = args.join("|");
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.t < TTL) {
    return NextResponse.json(hit.data, { headers: { "x-dcs-cache": "HIT" } });
  }
  try {
    const { stdout } = await execFileAsync(PYTHON, args, {
      timeout: 15000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const data = JSON.parse(stdout);
    cache.set(cacheKey, { t: Date.now(), data });
    return NextResponse.json(data, { headers: { "x-dcs-cache": "MISS" } });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    return NextResponse.json(
      { error: "python helper failed", view, stderr: (e.stderr || "").slice(0, 500), message: e.message },
      { status: 500 }
    );
  }
}
