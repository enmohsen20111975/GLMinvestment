'use client';

/**
 * GitHubFileManager.tsx
 * =====================
 * UI كامل لإدارة ملفات GitHub من لوحة الأدمن.
 *
 * المميزات:
 * 1. عرض كل الملفات على GitHub (مع الحجم + التتبع)
 * 2. حذف ملفات محددة (checkbox selection)
 * 3. حذف folder كامل
 * 4. إيقاف / استئناف تتبع ملفات
 * 5. إضافة / إزالة patterns من .gitignore
 * 6. عرض حالة git (ahead/behind/conflicts)
 * 7. commit + push مباشر
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Trash2, RefreshCw, Loader2, Upload, GitBranch, AlertTriangle,
  FileText, Folder, Eye, EyeOff, Settings, CheckCircle2, XCircle
} from 'lucide-react';
import { toast } from 'sonner';

interface GitFile {
  name: string;
  path: string;
  size_mb: number;
  sha: string;
  type: string;
  tracked: boolean;
  selected: boolean;
}

interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  uncommitted: number;
  conflicts: number;
  trackedCount: number;
  gitignorePatterns: number;
}

export function GitHubFileManager() {
  const [files, setFiles] = useState<GitFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState('data');
  const [folderInput, setFolderInput] = useState('data');
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [gitignorePatterns, setGitignorePatterns] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/git-files?folder=${encodeURIComponent(folder)}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setFiles(data.files.map((f: any) => ({ ...f, selected: false })));
      } else {
        toast.error(data.error || 'فشل تحميل الملفات');
        setFiles([]);
      }
    } catch (e) {
      toast.error('خطأ في الاتصال');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [folder]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/git-files?action=status', { cache: 'no-store' });
      const data = await res.json();
      if (data.success) setStatus(data.status);
    } catch {}
  }, []);

  const fetchGitignore = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/git-files?action=gitignore', { cache: 'no-store' });
      const data = await res.json();
      if (data.success) setGitignorePatterns(data.patterns || []);
    } catch {}
  }, []);

  useEffect(() => { fetchFiles(); fetchStatus(); fetchGitignore(); }, [fetchFiles, fetchStatus, fetchGitignore]);

  const toggleSelect = (path: string) => {
    setFiles(prev => prev.map(f => f.path === path ? { ...f, selected: !f.selected } : f));
  };

  const selectAll = () => setFiles(prev => prev.map(f => ({ ...f, selected: !prev.every(x => x.selected) })));

  const selectedFiles = files.filter(f => f.selected);

  const action = async (act: string, body: any = {}, successMsg: string = '') => {
    setBusy(act);
    try {
      const res = await fetch('/api/admin/git-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act, ...body }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(successMsg || data.message || 'تم بنجاح');
        if (act === 'delete' || act === 'delete_folder') fetchFiles();
        if (act === 'untrack' || act === 'track') fetchFiles();
        if (act === 'add_to_gitignore' || act === 'remove_from_gitignore') fetchGitignore();
        fetchStatus();
      } else {
        toast.error(data.error || 'فشل');
      }
    } catch (e) {
      toast.error('خطأ في الاتصال');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = () => {
    if (selectedFiles.length === 0) { toast.warning('اختر ملفات للحذف'); return; }
    if (!confirm(`⚠️ تأكيد حذف ${selectedFiles.length} ملف من GitHub؟\n\nهذه العملية لا يمكن التراجع عنها!`)) return;
    action('delete', { files: selectedFiles.map(f => f.path) }, `تم حذف ${selectedFiles.length} ملف`);
  };

  const handleDeleteFolder = () => {
    if (!confirm(`⚠️ حذف كل ملفات ${folder}/ من GitHub؟\n\nهذه العملية لا يمكن التراجع عنها!`)) return;
    action('delete_folder', { folder }, `تم حذف كل ملفات ${folder}/`);
  };

  const handleUntrack = () => {
    const tracked = selectedFiles.filter(f => f.tracked);
    if (tracked.length === 0) { toast.warning('لا توجد ملفات متتبعة في الاختيار'); return; }
    if (!confirm(`إيقاف تتبع ${tracked.length} ملف؟\n(الملفات لسه على GitHub بس مش هتتتبع)`)) return;
    action('untrack', { files: tracked.map(f => f.path) }, `تم إيقاف تتبع ${tracked.length} ملف`);
  };

  const handleTrack = () => {
    const untracked = selectedFiles.filter(f => !f.tracked);
    if (untracked.length === 0) { toast.warning('لا توجد ملفات غير متتبعة في الاختيار'); return; }
    if (!confirm(`استئناف تتبع ${untracked.length} ملف؟`)) return;
    action('track', { files: untracked.map(f => f.path) }, `تم استئناف تتبع ${untracked.length} ملف`);
  };

  const handleAddPattern = () => {
    if (!newPattern.trim()) return;
    action('add_to_gitignore', { pattern: newPattern.trim() }, `تم إضافة '${newPattern}' لـ .gitignore`);
    setNewPattern('');
  };

  const handleRemovePattern = (p: string) => {
    if (!confirm(`إزالة '${p}' من .gitignore؟`)) return;
    action('remove_from_gitignore', { pattern: p }, `تم إزالة '${p}'`);
  };

  const handleCommitPush = () => {
    if (!confirm('commit + push التغييرات لـ GitHub؟')) return;
    action('commit_push', {}, 'تم commit + push بنجاح');
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* === Status Bar === */}
      <Card className="border-2 border-primary/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            حالة Git
          </CardTitle>
        </CardHeader>
        <CardContent>
          {status && !status.error ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">الفرع</span>
                <span className="font-bold text-primary">{status.branch}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">ahead / behind</span>
                <span className="font-bold">
                  <span className="text-emerald-600">↑{status.ahead}</span>
                  {' / '}
                  <span className="text-amber-600">↓{status.behind}</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">ملفات متتبعة</span>
                <span className="font-bold">{status.trackedCount}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">تغييرات غير ملتزمة</span>
                <span className={`font-bold ${status.uncommitted > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {status.uncommitted}
                </span>
              </div>
              {status.conflicts > 0 && (
                <div className="flex items-center gap-1 text-rose-600 col-span-2 md:col-span-4">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-sm font-bold">يوجد conflicts — راجع الكود</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">تعذّر تحميل حالة Git</p>
          )}
          <div className="flex gap-2 mt-3">
            <Button size="sm" variant="outline" onClick={() => { fetchStatus(); fetchFiles(); fetchGitignore(); }} disabled={loading}>
              <RefreshCw className="w-3.5 h-3.5 ml-1" />
              تحديث
            </Button>
            <Button size="sm" variant="default" onClick={handleCommitPush} disabled={!!busy}>
              {busy === 'commit_push' ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 ml-1" />}
              Commit + Push
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* === File Browser === */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Folder className="w-4 h-4 text-primary" />
              ملفات GitHub: {folder}/
            </CardTitle>
            <div className="flex items-center gap-2">
              <Input
                placeholder="اسم المجلد"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                className="w-32 h-8 text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') { setFolder(folderInput); } }}
              />
              <Button size="sm" variant="outline" onClick={() => setFolder(folderInput)}>
                تصفّح
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 mb-3">
            <Button size="sm" variant="outline" onClick={selectAll} disabled={loading}>
              تحديد الكل
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDelete} disabled={!selectedFiles.length || !!busy}>
              {busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 ml-1" />}
              حذف المحدد ({selectedFiles.length})
            </Button>
            <Button size="sm" variant="outline" onClick={handleUntrack} disabled={!selectedFiles.length || !!busy}>
              {busy === 'untrack' ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" /> : <EyeOff className="w-3.5 h-3.5 ml-1" />}
              إيقاف تتبع
            </Button>
            <Button size="sm" variant="outline" onClick={handleTrack} disabled={!selectedFiles.length || !!busy}>
              {busy === 'track' ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" /> : <Eye className="w-3.5 h-3.5 ml-1" />}
              استئناف تتبع
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDeleteFolder} disabled={loading || !!busy}>
              <Trash2 className="w-3.5 h-3.5 ml-1 text-rose-500" />
              حذف المجلد كاملاً
            </Button>
          </div>

          {/* File list */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="mr-2 text-sm text-muted-foreground">جاري التحميل...</span>
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Folder className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">لا توجد ملفات في {folder}/</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px] w-full rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/95 backdrop-blur">
                  <tr>
                    <th className="w-10 p-2"></th>
                    <th className="text-right p-2 font-semibold">الملف</th>
                    <th className="text-right p-2 font-semibold w-24">الحجم</th>
                    <th className="text-right p-2 font-semibold w-20">التتبع</th>
                    <th className="text-right p-2 font-semibold w-16">SHA</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.path} className={`border-b hover:bg-muted/50 ${f.selected ? 'bg-primary/5' : ''}`}>
                      <td className="p-2">
                        <Checkbox checked={f.selected} onCheckedChange={() => toggleSelect(f.path)} />
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          {f.type === 'dir' ? (
                            <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          ) : (
                            <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          )}
                          <span className="font-mono text-xs truncate max-w-[300px]">{f.name}</span>
                        </div>
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {f.size_mb > 0 ? `${f.size_mb} MB` : f.type === 'dir' ? '—' : '0 KB'}
                      </td>
                      <td className="p-2">
                        {f.type === 'dir' ? null : f.tracked ? (
                          <Badge variant="default" className="text-[10px]">متتبع</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">غير متتبع</Badge>
                        )}
                      </td>
                      <td className="p-2 font-mono text-xs text-muted-foreground">{f.sha}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}

          {files.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              إجمالي: {files.length} ملف | {files.filter(f => f.tracked).length} متتبع | {files.filter(f => !f.tracked && f.type === 'file').length} غير متتبع |
              الحجم: {files.reduce((s, f) => s + f.size_mb, 0).toFixed(1)} MB
            </div>
          )}
        </CardContent>
      </Card>

      {/* === .gitignore Manager === */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" />
            إدارة .gitignore
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Add pattern */}
          <div className="flex gap-2 mb-3">
            <Input
              placeholder="pattern (مثال: data/db_backup_*)"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              className="flex-1"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddPattern(); }}
            />
            <Button size="sm" variant="default" onClick={handleAddPattern} disabled={!newPattern.trim() || !!busy}>
              {busy === 'add_to_gitignore' ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 ml-1" />}
              إضافة
            </Button>
          </div>

          {/* Patterns list */}
          {gitignorePatterns.length > 0 ? (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">الأنماط الحالية ({gitignorePatterns.length}):</Label>
              <ScrollArea className="h-[150px] w-full rounded-md border">
                <div className="p-2 space-y-1">
                  {gitignorePatterns.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-muted/50">
                      <code className="text-xs flex-1 truncate">{p}</code>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-rose-500"
                        onClick={() => handleRemovePattern(p)}
                        disabled={!!busy}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">لا توجد أنماط في .gitignore</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
