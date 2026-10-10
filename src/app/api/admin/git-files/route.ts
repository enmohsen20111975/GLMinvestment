/**
 * GET /api/admin/git-files
 * POST /api/admin/git-files
 * =====================================================
 * إدارة كاملة لملفات GitHub: عرض + حذف + تتبع
 *
 * GET ?folder=data → قائمة الملفات
 * GET ?action=status → حالة git (ahead/behind/conflicts)
 * GET ?action=tracked → الملفات المتتبعة
 *
 * POST { action: 'delete', files: [...] }
 * POST { action: 'delete_folder', folder: 'data' }
 * POST { action: 'untrack', files: [...] } → git rm --cached
 * POST { action: 'track', files: [...] } → git add -f
 * POST { action: 'add_to_gitignore', pattern: 'data/db_backup_*' }
 * POST { action: 'remove_from_gitignore', pattern: 'data/db_backup_*' }
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { requireAdminAsync } from '@/lib/admin-auth-server';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const REPO_OWNER = 'enmohsen20111975';
const REPO_NAME = 'GLMinvestment';
const BRANCH = 'main';
const PROJECT_ROOT = process.cwd();

interface GitHubFile {
  name: string;
  path: string;
  size: number;
  sha: string;
  type: string;
  tracked: boolean;
}

async function listGitHubFiles(folder: string): Promise<GitHubFile[]> {
  if (!GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN not configured in .env');
  }

  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${folder}?ref=${BRANCH}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(`GitHub API: ${err.message || res.status}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) return [];

  // فحص التتبع: الملف المتتبع موجود في git ls-files
  let trackedFiles: Set<string> = new Set();
  try {
    const output = execSync('git ls-files', { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 5000 });
    trackedFiles = new Set(output.trim().split('\n').filter(Boolean));
  } catch {}

  return data.map((f: any) => ({
    name: f.name,
    path: f.path,
    size: f.size,
    sha: f.sha,
    type: f.type,
    tracked: trackedFiles.has(f.path),
  }));
}

async function deleteGitHubFile(filePath: string): Promise<{ success: boolean; error?: string }> {
  if (!GITHUB_TOKEN) return { success: false, error: 'GITHUB_TOKEN not configured' };

  // جلب SHA
  const fileDir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const listUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${fileDir}?ref=${BRANCH}`;
  const listRes = await fetch(listUrl, {
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
  });
  if (!listRes.ok) return { success: false, error: `list failed: ${listRes.status}` };

  const files = await listRes.json();
  const file = (files as any[]).find((f) => f.name === fileName);
  if (!file) return { success: false, error: 'file not found' };

  // حذف
  const deleteRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`, {
    method: 'DELETE',
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `chore: delete ${filePath}`, sha: file.sha, branch: BRANCH }),
  });

  if (!deleteRes.ok) {
    const err = await deleteRes.json().catch(() => ({ message: deleteRes.statusText }));
    return { success: false, error: err.message || `HTTP ${deleteRes.status}` };
  }
  return { success: true };
}

function gitStatus() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 5000 }).trim();
    const ahead = parseInt(execSync('git rev-list --count HEAD ^origin/main', { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 5000 }).trim()) || 0;
    const behind = parseInt(execSync('git rev-list --count origin/main ^HEAD', { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 5000 }).trim()) || 0;
    const status = execSync('git status --porcelain', { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 5000 }).trim();
    const uncommitted = status ? status.split('\n').length : 0;

    // فحص conflict markers
    let conflicts = 0;
    try {
      execSync('git diff --check', { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 5000 });
    } catch {
      conflicts = 1;
    }

    // عدد الملفات المتتبعة
    const trackedCount = parseInt(execSync('git ls-files | wc -l', { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 5000 }).trim()) || 0;

    // .gitignore lines
    const gitignorePath = path.join(PROJECT_ROOT, '.gitignore');
    const gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
    const gitignorePatterns = gitignoreContent.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;

    return { branch, ahead, behind, uncommitted, conflicts, trackedCount, gitignorePatterns };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'unknown' };
  }
}

function untrackFiles(files: string[]) {
  const results = [];
  for (const f of files) {
    if (f.includes('..') || f.startsWith('/')) { results.push({ path: f, success: false, error: 'invalid' }); continue; }
    try {
      execSync(`git rm --cached "${f}"`, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 10000 });
      results.push({ path: f, success: true });
    } catch (e) {
      results.push({ path: f, success: false, error: e instanceof Error ? e.message.slice(0, 100) : 'failed' });
    }
  }
  return results;
}

function trackFiles(files: string[]) {
  const results = [];
  for (const f of files) {
    if (f.includes('..') || f.startsWith('/')) { results.push({ path: f, success: false, error: 'invalid' }); continue; }
    try {
      execSync(`git add -f "${f}"`, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 10000 });
      results.push({ path: f, success: true });
    } catch (e) {
      results.push({ path: f, success: false, error: e instanceof Error ? e.message.slice(0, 100) : 'failed' });
    }
  }
  return results;
}

function addToGitignore(pattern: string) {
  const gitignorePath = path.join(PROJECT_ROOT, '.gitignore');
  let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
  if (content.includes(pattern)) return { success: true, message: 'already exists' };
  content += `\n# Auto-added by admin panel\n${pattern}\n`;
  fs.writeFileSync(gitignorePath, content);
  return { success: true };
}

function removeFromGitignore(pattern: string) {
  const gitignorePath = path.join(PROJECT_ROOT, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return { success: false, error: 'no .gitignore' };
  let content = fs.readFileSync(gitignorePath, 'utf-8');
  const lines = content.split('\n');
  const filtered = lines.filter(l => l.trim() !== pattern && !l.includes(`# Auto-added`) === false || !l.includes(pattern));
  fs.writeFileSync(gitignorePath, filtered.join('\n'));
  return { success: true };
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const folder = searchParams.get('folder') || 'data';

  // ?action=status → حالة git
  if (action === 'status') {
    return NextResponse.json({ success: true, status: gitStatus() });
  }

  // ?action=gitignore → محتوى .gitignore
  if (action === 'gitignore') {
    const gitignorePath = path.join(PROJECT_ROOT, '.gitignore');
    const content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
    const patterns = content.split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim());
    return NextResponse.json({ success: true, patterns });
  }

  // default: عرض ملفات folder
  try {
    const files = await listGitHubFiles(folder);
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    return NextResponse.json({
      success: true,
      folder,
      branch: BRANCH,
      total_files: files.length,
      total_size_mb: Math.round(totalSize / (1024 * 1024) * 100) / 100,
      files: files.map(f => ({
        name: f.name,
        path: f.path,
        size_mb: Math.round(f.size / (1024 * 1024) * 100) / 100,
        sha: f.sha.substring(0, 7),
        type: f.type,
        tracked: f.tracked,
        selected: false,
      })),
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { action, files, folder, pattern } = body;

    if (action === 'delete') {
      if (!files?.length) return NextResponse.json({ success: false, error: 'files required' }, { status: 400 });
      const results = [];
      for (const fp of files) {
        if (fp.includes('..') || fp.startsWith('/')) { results.push({ path: fp, success: false, error: 'invalid' }); continue; }
        results.push({ path: fp, ...(await deleteGitHubFile(fp)) });
      }
      const ok = results.filter(r => r.success).length;
      const fail = results.filter(r => !r.success).length;
      return NextResponse.json({ success: true, deleted: ok, failed: fail, results, message: `تم حذف ${ok} ملف${fail ? `، فشل ${fail}` : ''}` });
    }

    if (action === 'delete_folder') {
      const targetFolder = folder || 'data';
      const fileList = await listGitHubFiles(targetFolder);
      if (!fileList.length) return NextResponse.json({ success: true, message: 'لا توجد ملفات', deleted: 0 });
      const results = [];
      for (const f of fileList) results.push({ path: f.path, ...(await deleteGitHubFile(f.path)) });
      const ok = results.filter(r => r.success).length;
      return NextResponse.json({ success: true, deleted: ok, total: fileList.length, results, message: `تم حذف ${ok} من ${fileList.length}` });
    }

    if (action === 'untrack') {
      const results = untrackFiles(files || []);
      const ok = results.filter(r => r.success).length;
      return NextResponse.json({ success: true, untracked: ok, failed: results.length - ok, results, message: `تم إيقاف تتبع ${ok} ملف` });
    }

    if (action === 'track') {
      const results = trackFiles(files || []);
      const ok = results.filter(r => r.success).length;
      return NextResponse.json({ success: true, tracked: ok, failed: results.length - ok, results, message: `تم استئناف تتبع ${ok} ملف` });
    }

    if (action === 'add_to_gitignore') {
      const result = addToGitignore(pattern);
      return NextResponse.json({ success: true, ...result, message: `تم إضافة '${pattern}' لـ .gitignore` });
    }

    if (action === 'remove_from_gitignore') {
      const result = removeFromGitignore(pattern);
      return NextResponse.json({ success: true, ...result, message: `تم إزالة '${pattern}' من .gitignore` });
    }

    if (action === 'commit_push') {
      try {
        execSync('git add -A', { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30000 });
        execSync(`git commit -m "chore: git file management update"`, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30000 });
        execSync('git push origin main', { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 120000 });
        return NextResponse.json({ success: true, message: 'تم commit + push بنجاح' });
      } catch (e) {
        return NextResponse.json({ success: false, error: e instanceof Error ? e.message.slice(0, 200) : 'failed' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: false, error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
