/**
 * GET /api/admin/git-files
 * POST /api/admin/git-files (with { action: 'delete', files: ['path1', 'path2'] })
 * =====================================================================
 * عرض + حذف ملفات من GitHub repo.
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { requireAdminAsync } from '@/lib/admin-auth-server';
import path from 'path';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const REPO_OWNER = 'enmohsen20111975';
const REPO_NAME = 'GLMinvestment';
const BRANCH = 'main';

interface GitHubFile {
  name: string;
  path: string;
  size: number;
  sha: string;
  type: string;
  download_url?: string;
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
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((f: any) => ({
    name: f.name,
    path: f.path,
    size: f.size,
    sha: f.sha,
    type: f.type,
    download_url: f.download_url,
  }));
}

async function deleteGitHubFile(filePath: string): Promise<{ success: boolean; error?: string }> {
  if (!GITHUB_TOKEN) {
    return { success: false, error: 'GITHUB_TOKEN not configured' };
  }

  // 1. جلب SHA بتاع الملف
  const fileDir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const listUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${fileDir}?ref=${BRANCH}`;

  const listRes = await fetch(listUrl, {
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!listRes.ok) {
    return { success: false, error: `Failed to list ${fileDir}: ${listRes.status}` };
  }

  const files = await listRes.json();
  const file = (files as any[]).find((f) => f.name === fileName);
  if (!file) {
    return { success: false, error: `File ${filePath} not found on GitHub` };
  }

  // 2. حذف الملف عبر GitHub API
  const deleteUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
  const deleteRes = await fetch(deleteUrl, {
    method: 'DELETE',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `chore: delete ${filePath} (admin panel)`,
      sha: file.sha,
      branch: BRANCH,
    }),
  });

  if (!deleteRes.ok) {
    const err = await deleteRes.json().catch(() => ({ message: deleteRes.statusText }));
    return { success: false, error: err.message || `HTTP ${deleteRes.status}` };
  }

  return { success: true };
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const folder = searchParams.get('folder') || 'data';

  try {
    const files = await listGitHubFiles(folder);

    // تجميع حسب الـ timestamp
    const grouped: Record<string, GitHubFile[]> = {};
    for (const f of files) {
      const match = f.name.match(/(\d{4}-\d{2}-\d{2}T[\d-]+)/);
      const key = match ? match[1] : 'other';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(f);
    }

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
      })),
      grouped,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { action, files, folder } = body;

    if (action === 'list') {
      const fileList = await listGitHubFiles(folder || 'data');
      return NextResponse.json({
        success: true,
        files: fileList.map(f => ({
          name: f.name,
          path: f.path,
          size_mb: Math.round(f.size / (1024 * 1024) * 100) / 100,
          sha: f.sha.substring(0, 7),
        })),
      });
    }

    if (action === 'delete') {
      if (!files || !Array.isArray(files) || files.length === 0) {
        return NextResponse.json(
          { success: false, error: 'files array required' },
          { status: 400 }
        );
      }

      const results = [];
      for (const filePath of files) {
        if (filePath.includes('..') || filePath.startsWith('/')) {
          results.push({ path: filePath, success: false, error: 'invalid path' });
          continue;
        }

        const result = await deleteGitHubFile(filePath);
        results.push({ path: filePath, ...result });
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      return NextResponse.json({
        success: true,
        deleted: successCount,
        failed: failCount,
        results,
        message: `تم حذف ${successCount} ملف${failCount > 0 ? `، فشل ${failCount}` : ''}`,
      });
    }

    if (action === 'delete_folder') {
      const targetFolder = folder || 'data';
      const fileList = await listGitHubFiles(targetFolder);

      if (fileList.length === 0) {
        return NextResponse.json({ success: true, message: 'لا توجد ملفات', deleted: 0 });
      }

      const results = [];
      for (const f of fileList) {
        const result = await deleteGitHubFile(f.path);
        results.push({ path: f.path, ...result });
      }

      const successCount = results.filter(r => r.success).length;
      return NextResponse.json({
        success: true,
        deleted: successCount,
        total: fileList.length,
        results,
        message: `تم حذف ${successCount} من ${fileList.length} ملف من ${targetFolder}/`,
      });
    }

    return NextResponse.json(
      { success: false, error: 'unknown action' },
      { status: 400 }
    );
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    );
  }
}
