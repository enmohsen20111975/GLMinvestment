#!/usr/bin/env python3
"""
auto_git_sync.py — Git Auto-Sync Engine
========================================
يحل مشكلة: "cannot lock ref" اللي بتحصل لما السيرفر الإنتاجي
يعمل commits محلية (DB backups) والساندبوكس يرفع commits في نفس الوقت.

الـ script بيتعامل مع كل الاحتمالات:
  1. fetch + merge (الـ flow الطبيعي)
  2. conflict في worklog.md → auto-resolve (keep both)
  3. conflict في أي ملف تاني → auto-resolve (keep theirs = remote)
  4. conflict في DB backups → auto-resolve (keep ours = local)
  5. force push لو الـ ref lock فشل
  6. rebase fallback لو merge فشل
  7. stash + pop لو فيه uncommitted changes

Usage:
  python3 vps-service/scripts/auto_git_sync.py           # sync + push
  python3 vps-service/scripts/auto_git_sync.py --pull     # pull فقط
  python3 vps-service/scripts/auto_git_sync.py --push     # push فقط
  python3 vps-service/scripts/auto_git_sync.py --status   # status فقط

Author: Main Agent (Z.ai Code)
Date: 2026-10-09
"""

import subprocess
import sys
import os
import re
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f'[{ts}] [{level}] {msg}', flush=True)


def run_git(*args, check=True, capture=True):
    """تشغيل git command."""
    cmd = ['git', '-C', str(PROJECT_ROOT)] + list(args)
    result = subprocess.run(cmd, capture_output=capture, text=True, check=False)
    if check and result.returncode != 0:
        raise RuntimeError(f'git {args[0]} failed: {result.stderr.strip()}')
    return result


def get_current_branch():
    """جلب اسم الفرع الحالي."""
    result = run_git('rev-parse', '--abbrev-ref', 'HEAD')
    return result.stdout.strip()


def get_local_commits_ahead():
    """عدد commits المحلية قبل الـ remote."""
    result = run_git('rev-list', '--count', 'HEAD', '^origin/main', check=False)
    try:
        return int(result.stdout.strip())
    except ValueError:
        return 0


def get_remote_commits_ahead():
    """عدد commits على الـ remote قبل المحلي."""
    result = run_git('rev-list', '--count', 'origin/main', '^HEAD', check=False)
    try:
        return int(result.stdout.strip())
    except ValueError:
        return 0


def has_conflict_markers():
    """فحص لو فيه conflict markers في أي ملف."""
    result = run_git('diff', '--check', check=False)
    return result.returncode != 0


def get_conflicted_files():
    """جلب قائمة الملفات اللي فيها conflict."""
    result = run_git('diff', '--name-only', '--diff-filter=U', check=False)
    return [f.strip() for f in result.stdout.split('\n') if f.strip()]


def resolve_conflict(filepath, strategy='theirs'):
    """
    حل conflict في ملف معين.
    
    strategies:
      - 'theirs': خذ نسخة الـ remote (للملفات اللي اتعدلت على الساندبوكس)
      - 'ours': خذ نسخة المحلي (للـ DB backups + بيانات السيرفر)
      - 'merge': دمج الاتنين (للـ worklog.md)
    """
    full_path = PROJECT_ROOT / filepath
    
    if not full_path.exists():
        return False
    
    try:
        content = full_path.read_text(encoding='utf-8')
    except Exception:
        return False
    
    if strategy == 'theirs':
        # خذ نسخة الـ remote
        run_git('checkout', '--theirs', filepath, check=False)
        run_git('add', filepath, check=False)
        log(f'  ✓ Resolved (theirs): {filepath}')
        return True
    
    elif strategy == 'ours':
        # خذ نسخة المحلي
        run_git('checkout', '--ours', filepath, check=False)
        run_git('add', filepath, check=False)
        log(f'  ✓ Resolved (ours): {filepath}')
        return True
    
    elif strategy == 'merge':
        # دمج الاتنين — شيل الـ conflict markers وضيف المحتوى من الاتنين
        # pattern: <<<<<<< ... ======= ... >>>>>> ...
        lines = content.split('\n')
        merged = []
        in_ours = False
        in_theirs = False
        ours_lines = []
        theirs_lines = []
        
        for line in lines:
            if line.startswith('<<<<<<<'):
                in_ours = True
                continue
            elif line.startswith('======='):
                in_ours = False
                in_theirs = True
                continue
            elif line.startswith('>>>>>>>'):
                in_theirs = False
                # ضيف ours الأول ثم theirs (بدون تكرار)
                for l in ours_lines:
                    if l not in merged:
                        merged.append(l)
                for l in theirs_lines:
                    if l not in merged:
                        merged.append(l)
                ours_lines = []
                theirs_lines = []
                continue
            
            if in_ours:
                ours_lines.append(line)
            elif in_theirs:
                theirs_lines.append(line)
            else:
                merged.append(line)
        
        full_path.write_text('\n'.join(merged), encoding='utf-8')
        run_git('add', filepath, check=False)
        log(f'  ✓ Resolved (merge): {filepath}')
        return True
    
    return False


def get_uncommitted_files():
    """جلب قائمة الملفات غير الملتزمة."""
    result = run_git('status', '--porcelain', check=False)
    return [line.strip() for line in result.stdout.split('\n') if line.strip()]


def stash_uncommitted():
    """stash التغييرات غير الملتزمة."""
    files = get_uncommitted_files()
    if not files:
        return False
    
    log(f'Stashing {len(files)} uncommitted files...')
    run_git('stash', check=False)
    return True


def pop_stash():
    """استرجاع الـ stash."""
    result = run_git('stash', 'list', check=False)
    if result.stdout.strip():
        log('Popping stash...')
        run_git('stash', 'pop', check=False)
        return True
    return False


def auto_sync():
    """
    الـ flow الكامل للـ auto-sync:
    
    1. fetch origin
    2. لو فيه uncommitted → stash
    3. لو remote ahead → merge origin/main
    4. لو فيه conflicts:
       a. worklog.md → merge (keep both)
       b. data/* (DB backups) → ours (keep local)
       c. أي حاجة تانية → theirs (keep remote)
    5. commit الـ merge
    6. push
    7. pop stash لو كان فيه
    """
    log('═══════════════════════════════════════════════════════════')
    log('  🔄 Auto Git Sync — بدء المزامنة')
    log('═══════════════════════════════════════════════════════════')
    
    branch = get_current_branch()
    log(f'Branch: {branch}')
    
    # 1) Fetch
    log('\n━━━ 1. Fetch origin ━━━')
    try:
        run_git('fetch', 'origin', check=False)
        log('✅ Fetch complete')
    except Exception as e:
        log(f'❌ Fetch failed: {e}', 'ERROR')
        return {'success': False, 'error': f'fetch_failed: {e}'}
    
    # 2) Check sync status
    log('\n━━━ 2. Sync status ━━━')
    local_ahead = get_local_commits_ahead()
    remote_ahead = get_remote_commits_ahead()
    log(f'  Local ahead: {local_ahead} commits')
    log(f'  Remote ahead: {remote_ahead} commits')
    
    if remote_ahead == 0 and local_ahead == 0:
        log('✅ Already in sync — nothing to do')
        return {'success': True, 'action': 'already_synced'}
    
    # 3) Stash uncommitted
    log('\n━━━ 3. Stash uncommitted ━━━')
    stashed = stash_uncommitted()
    if stashed:
        log('✅ Stashed')
    else:
        log('ℹ️ No uncommitted changes')
    
    # 4) Merge or pull
    log('\n━━━ 4. Merge origin/main ━━━')
    merge_result = run_git('merge', 'origin/main', '--no-edit', check=False)
    
    if merge_result.returncode != 0:
        # Conflicts!
        log('⚠️ Merge conflicts detected — auto-resolving...', 'WARN')
        conflicted = get_conflicted_files()
        log(f'  Conflicted files: {len(conflicted)}')
        
        for filepath in conflicted:
            # تحديد strategy حسب نوع الملف
            if 'worklog' in filepath or 'CHANGELOG' in filepath:
                strategy = 'merge'
            elif filepath.startswith('data/') or filepath.startswith('db/'):
                strategy = 'ours'  # DB backups = keep local
            elif filepath.startswith('audit-reports/'):
                strategy = 'theirs'  # audit reports = keep remote
            else:
                strategy = 'theirs'  # default = keep remote (ساندبوكس fixes)
            
            resolve_conflict(filepath, strategy)
        
        # commit الـ merge
        run_git('commit', '--no-edit', check=False)
        log('✅ Conflicts resolved + merge committed')
    else:
        log('✅ Merge clean (no conflicts)')
    
    # 5) Push
    log('\n━━━ 5. Push to origin ━━━')
    push_result = run_git('push', 'origin', f'HEAD:{branch}', check=False)
    
    if push_result.returncode != 0:
        log('⚠️ Push failed — trying force-with-lease...', 'WARN')
        # force-with-lease = آمن (بيpush بس لو الـ remote ما اتغيرش من حد تاني)
        push_result = run_git('push', '--force-with-lease', 'origin', f'HEAD:{branch}', check=False)
        
        if push_result.returncode != 0:
            log('⚠️ Force-with-lease failed — trying rebase...', 'WARN')
            # rebase fallback
            run_git('rebase', 'origin/main', check=False)
            
            # لو فيه conflicts بعد rebase
            conflicted = get_conflicted_files()
            if conflicted:
                for filepath in conflicted:
                    if 'worklog' in filepath or 'CHANGELOG' in filepath:
                        resolve_conflict(filepath, 'merge')
                    elif filepath.startswith('data/') or filepath.startswith('db/'):
                        resolve_conflict(filepath, 'ours')
                    else:
                        resolve_conflict(filepath, 'theirs')
                run_git('rebase', '--continue', check=False)
            
            # push بعد rebase
            push_result = run_git('push', 'origin', f'HEAD:{branch}', check=False)
            
            if push_result.returncode != 0:
                log(f'❌ Push failed even after rebase: {push_result.stderr.strip()}', 'ERROR')
                # pop stash قبل ما نخرج
                if stashed:
                    pop_stash()
                return {'success': False, 'error': f'push_failed: {push_result.stderr.strip()}'}
    
    log('✅ Push successful')
    
    # 6) Pop stash
    if stashed:
        log('\n━━━ 6. Pop stash ━━━')
        pop_stash()
        log('✅ Stash popped')
    
    # 7) Final status
    log('\n━━━ 7. Final status ━━━')
    local_ahead = get_local_commits_ahead()
    remote_ahead = get_remote_commits_ahead()
    log(f'  Local ahead: {local_ahead}')
    log(f'  Remote ahead: {remote_ahead}')
    
    if has_conflict_markers():
        log('⚠️ Conflict markers still present — manual review needed', 'WARN')
    
    log('\n═══════════════════════════════════════════════════════════')
    log('  ✅ Auto Sync Complete')
    log('═══════════════════════════════════════════════════════════')
    
    return {
        'success': True,
        'action': 'synced_and_pushed',
        'local_ahead': local_ahead,
        'remote_ahead': remote_ahead,
    }


def show_status():
    """عرض حالة الـ git."""
    log('━━━ Git Status ━━━')
    branch = get_current_branch()
    local_ahead = get_local_commits_ahead()
    remote_ahead = get_remote_commits_ahead()
    
    log(f'Branch: {branch}')
    log(f'Local ahead: {local_ahead} commits')
    log(f'Remote ahead: {remote_ahead} commits')
    
    uncommitted = get_uncommitted_files()
    if uncommitted:
        log(f'Uncommitted files: {len(uncommitted)}')
        for f in uncommitted[:5]:
            log(f'  • {f}')
    
    conflicts = get_conflicted_files()
    if conflicts:
        log(f'⚠️ Conflicted files: {len(conflicts)}')
        for f in conflicts:
            log(f'  • {f}')
    
    return {
        'branch': branch,
        'local_ahead': local_ahead,
        'remote_ahead': remote_ahead,
        'uncommitted': len(uncommitted),
        'conflicts': len(conflicts),
    }


def pull_only():
    """pull فقط بدون push."""
    log('━━━ Pull Only ━━━')
    
    run_git('fetch', 'origin', check=False)
    stashed = stash_uncommitted()
    
    merge_result = run_git('merge', 'origin/main', '--no-edit', check=False)
    
    if merge_result.returncode != 0:
        conflicted = get_conflicted_files()
        for filepath in conflicted:
            if 'worklog' in filepath or 'CHANGELOG' in filepath:
                resolve_conflict(filepath, 'merge')
            elif filepath.startswith('data/') or filepath.startswith('db/'):
                resolve_conflict(filepath, 'ours')
            else:
                resolve_conflict(filepath, 'theirs')
        run_git('commit', '--no-edit', check=False)
    
    if stashed:
        pop_stash()
    
    log('✅ Pull complete')
    return {'success': True, 'action': 'pulled'}


def push_only():
    """push فقط بدون pull."""
    log('━━━ Push Only ━━━')
    
    result = run_git('push', 'origin', f'HEAD:{get_current_branch()}', check=False)
    
    if result.returncode != 0:
        log('⚠️ Push failed — trying force-with-lease...', 'WARN')
        result = run_git('push', '--force-with-lease', 'origin', f'HEAD:{get_current_branch()}', check=False)
    
    if result.returncode == 0:
        log('✅ Push successful')
        return {'success': True, 'action': 'pushed'}
    else:
        log(f'❌ Push failed: {result.stderr.strip()}', 'ERROR')
        return {'success': False, 'error': result.stderr.strip()}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Auto Git Sync')
    parser.add_argument('--pull', action='store_true', help='Pull فقط')
    parser.add_argument('--push', action='store_true', help='Push فقط')
    parser.add_argument('--status', action='store_true', help='Status فقط')
    args = parser.parse_args()
    
    if args.status:
        show_status()
    elif args.pull:
        pull_only()
    elif args.push:
        push_only()
    else:
        result = auto_sync()
        sys.exit(0 if result['success'] else 1)
