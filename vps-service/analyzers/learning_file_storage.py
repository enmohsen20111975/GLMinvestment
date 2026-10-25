"""
Learning File Storage
=====================
تخزين بيانات التعلم المؤقتة في ملفات خارجية بدلاً من قاعدة البيانات

الهدف: تقليل حجم قاعدة البيانات وتسريع العمليات
- بيانات التعلم التكراري → learning_logs/iterative/
- بيانات التعلم الذكي → learning_logs/intelligent/
- التوقعات المؤقتة → learning_logs/predictions/

Author: دليل الاستثمار
Version: 1.0.0
"""

import os
import json
import gzip
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

# Base directory for learning logs
BASE_DIR = Path(__file__).parent.parent / 'learning_logs'
ITERATIVE_DIR = BASE_DIR / 'iterative'
INTELLIGENT_DIR = BASE_DIR / 'intelligent'
PREDICTIONS_DIR = BASE_DIR / 'predictions'


class LearningFileStorage:
    """
    تخزين بيانات التعلم في ملفات خارجية
    
    المميزات:
    - ضغط البيانات تلقائياً (gzip)
    - تنظيف تلقائي للملفات القديمة
    - قراءة سريعة بدون قاعدة بيانات
    """
    
    def __init__(self):
        # Ensure directories exist
        ITERATIVE_DIR.mkdir(parents=True, exist_ok=True)
        INTELLIGENT_DIR.mkdir(parents=True, exist_ok=True)
        PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"LearningFileStorage initialized at {BASE_DIR}")
    
    def _get_date_filename(self, base_dir: Path, prefix: str = '') -> Path:
        """Get filename for today's date"""
        date_str = datetime.now().strftime('%Y-%m-%d')
        if prefix:
            return base_dir / f"{prefix}_{date_str}.json.gz"
        return base_dir / f"{date_str}.json.gz"
    
    def _get_session_filename(self, base_dir: Path, session_id: str) -> Path:
        """Get filename for a specific session"""
        return base_dir / f"session_{session_id}.json.gz"
    
    def save_iterative_session(self, session_data: Dict, session_id: Optional[str] = None) -> str:
        """
        حفظ جلسة تعلم تكراري
        
        Args:
            session_data: بيانات الجلسة
            session_id: معرف الجلسة (اختياري)
        
        Returns:
            معرف الجلسة
        """
        if session_id is None:
            session_id = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        filepath = self._get_session_filename(ITERATIVE_DIR, session_id)
        
        # Add metadata
        data = {
            'session_id': session_id,
            'type': 'iterative',
            'timestamp': datetime.now().isoformat(),
            'data': session_data
        }
        
        # Compress and save
        with gzip.open(filepath, 'wt', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Saved iterative session: {session_id}")
        return session_id
    
    def save_intelligent_session(self, session_data: Dict, session_id: Optional[str] = None) -> str:
        """
        حفظ جلسة تعلم ذكي
        
        Args:
            session_data: بيانات الجلسة
            session_id: معرف الجلسة (اختياري)
        
        Returns:
            معرف الجلسة
        """
        if session_id is None:
            session_id = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        filepath = self._get_session_filename(INTELLIGENT_DIR, session_id)
        
        data = {
            'session_id': session_id,
            'type': 'intelligent',
            'timestamp': datetime.now().isoformat(),
            'data': session_data
        }
        
        with gzip.open(filepath, 'wt', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Saved intelligent session: {session_id}")
        return session_id
    
    def save_daily_predictions(self, predictions: List[Dict], date: Optional[str] = None) -> str:
        """
        حفظ توقعات يومية (فقط أفضل التوقعات)
        
        Args:
            predictions: قائمة التوقعات
            date: التاريخ (اختياري)
        
        Returns:
            اسم الملف
        """
        if date is None:
            date = datetime.now().strftime('%Y-%m-%d')
        
        filepath = ITERATIVE_DIR / f"predictions_{date}.json.gz"
        
        # Sort by confidence and keep only best predictions
        sorted_predictions = sorted(predictions, key=lambda x: x.get('confidence', 0), reverse=True)
        
        # Keep only top 20 predictions per day
        best_predictions = sorted_predictions[:20]
        
        data = {
            'date': date,
            'total_generated': len(predictions),
            'saved_count': len(best_predictions),
            'predictions': best_predictions,
            'timestamp': datetime.now().isoformat()
        }
        
        with gzip.open(filepath, 'wt', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Saved {len(best_predictions)} predictions for {date}")
        return str(filepath)
    
    def load_iterative_session(self, session_id: str) -> Optional[Dict]:
        """تحميل جلسة تعلم تكراري"""
        filepath = self._get_session_filename(ITERATIVE_DIR, session_id)
        
        if not filepath.exists():
            return None
        
        with gzip.open(filepath, 'rt', encoding='utf-8') as f:
            return json.load(f)
    
    def load_intelligent_session(self, session_id: str) -> Optional[Dict]:
        """تحميل جلسة تعلم ذكي"""
        filepath = self._get_session_filename(INTELLIGENT_DIR, session_id)
        
        if not filepath.exists():
            return None
        
        with gzip.open(filepath, 'rt', encoding='utf-8') as f:
            return json.load(f)
    
    def load_daily_predictions(self, date: str) -> Optional[Dict]:
        """تحميل توقعات يوم"""
        filepath = ITERATIVE_DIR / f"predictions_{date}.json.gz"
        
        if not filepath.exists():
            return None
        
        with gzip.open(filepath, 'rt', encoding='utf-8') as f:
            return json.load(f)
    
    def list_iterative_sessions(self, limit: int = 10) -> List[Dict]:
        """قائمة جلسات التعلم التكراري"""
        sessions = []
        
        for filepath in sorted(ITERATIVE_DIR.glob('session_*.json.gz'), reverse=True)[:limit]:
            try:
                with gzip.open(filepath, 'rt', encoding='utf-8') as f:
                    data = json.load(f)
                    sessions.append({
                        'session_id': data.get('session_id'),
                        'timestamp': data.get('timestamp'),
                        'type': data.get('type')
                    })
            except Exception as e:
                logger.warning(f"Error reading session {filepath}: {e}")
        
        return sessions
    
    def list_intelligent_sessions(self, limit: int = 10) -> List[Dict]:
        """قائمة جلسات التعلم الذكي"""
        sessions = []
        
        for filepath in sorted(INTELLIGENT_DIR.glob('session_*.json.gz'), reverse=True)[:limit]:
            try:
                with gzip.open(filepath, 'rt', encoding='utf-8') as f:
                    data = json.load(f)
                    sessions.append({
                        'session_id': data.get('session_id'),
                        'timestamp': data.get('timestamp'),
                        'type': data.get('type')
                    })
            except Exception as e:
                logger.warning(f"Error reading session {filepath}: {e}")
        
        return sessions
    
    def cleanup_old_files(self, days_to_keep: int = 30):
        """
        تنظيف الملفات القديمة
        
        Args:
            days_to_keep: عدد الأيام للاحتفاظ بالملفات
        """
        cutoff_date = datetime.now() - timedelta(days=days_to_keep)
        deleted_count = 0
        
        for directory in [ITERATIVE_DIR, INTELLIGENT_DIR, PREDICTIONS_DIR]:
            for filepath in directory.glob('*.json.gz'):
                try:
                    # Check file modification time
                    mtime = datetime.fromtimestamp(filepath.stat().st_mtime)
                    if mtime < cutoff_date:
                        filepath.unlink()
                        deleted_count += 1
                except Exception as e:
                    logger.warning(f"Error deleting {filepath}: {e}")
        
        if deleted_count > 0:
            logger.info(f"Cleaned up {deleted_count} old files")
        
        return deleted_count
    
    def get_storage_stats(self) -> Dict:
        """إحصائيات التخزين"""
        stats = {
            'iterative': {'files': 0, 'size_mb': 0},
            'intelligent': {'files': 0, 'size_mb': 0},
            'predictions': {'files': 0, 'size_mb': 0}
        }
        
        for name, directory in [
            ('iterative', ITERATIVE_DIR),
            ('intelligent', INTELLIGENT_DIR),
            ('predictions', PREDICTIONS_DIR)
        ]:
            files = list(directory.glob('*.json.gz'))
            stats[name]['files'] = len(files)
            stats[name]['size_mb'] = sum(f.stat().st_size for f in files) / (1024 * 1024)
        
        return stats
    
    def append_iteration_log(self, iteration_data: Dict, session_id: str):
        """
        إضافة سجل دورة تعلم (للاستخدام أثناء التعلم)
        
        Instead of saving to database, append to file
        """
        # Load existing session or create new
        filepath = self._get_session_filename(ITERATIVE_DIR, session_id)
        
        if filepath.exists():
            with gzip.open(filepath, 'rt', encoding='utf-8') as f:
                data = json.load(f)
        else:
            data = {
                'session_id': session_id,
                'type': 'iterative',
                'timestamp': datetime.now().isoformat(),
                'iterations': []
            }
        
        # Append iteration
        if 'iterations' not in data:
            data['iterations'] = []
        data['iterations'].append(iteration_data)
        
        # Save
        with gzip.open(filepath, 'wt', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)


# Global instance
_storage_instance = None

def get_storage() -> LearningFileStorage:
    """Get or create storage instance"""
    global _storage_instance
    if _storage_instance is None:
        _storage_instance = LearningFileStorage()
    return _storage_instance
