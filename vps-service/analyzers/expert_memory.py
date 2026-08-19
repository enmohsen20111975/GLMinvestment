"""
Expert Memory Engine - الذاكرة الخبيرة - CONJUNCTION PATTERNS VERSION
======================================================================

Improved version with:
- Conjunction Patterns: (Sector + Regime + RSI Bucket + Month + Persona)
- NO weighted average - we query the exact combination
- Block signals if conjunction has < 40% win rate with 5+ samples
- Boost confidence if conjunction has > 65% win rate with 5+ samples

@authorM2yDevelopers Team
@version 3.0.0 - Conjunction Patterns
"""

from typing import Dict, List, Optional, Tuple
import sqlite3
import json
from dataclasses import dataclass
from datetime import datetime


@dataclass
class MemoryInsight:
    """نتيجة البحث في الذاكرة"""
    found_similar: bool
    total_similar: int
    wins: int
    losses: int
    win_rate: float
    avg_pnl: float
    confidence_adjustment: float
    recommendation: str
    reason: str
    factors: Dict = None
    pattern_type: str = 'none'  # 'exact', 'partial', 'sector_regime', 'broad'


class ExpertMemoryEngineV3:
    """
    محرك الذاكرة الخبيرة - نسخة التوليفات (Conjunction Patterns)
    
    الفرق عن V2:
    - V2: sector WR 60% + regime WR 55% + RSI WR 65% → avg = 60%
    - V3: (Banks + Bull + RSI 30-40 + May) → WR 75% OR WR 25%
    
    القواعد:
    - لو نفس التوليفة حصلت 5+ مرات و WR < 40% → BLOCK
    - لو نفس التوليفة حصلت 5+ مرات و WR > 65% → BOOST +20%
    - لو العينات < 5 → نبحث في توليفة أوسع
    """
    
    # RSI Buckets for generalization
    RSI_BUCKETS = {
        'oversold': (0, 30),
        'low': (30, 45),
        'neutral': (45, 55),
        'high': (55, 70),
        'overbought': (70, 100)
    }
    
    # Months to quarters
    MONTH_TO_QUARTER = {
        1: 'Q1', 2: 'Q1', 3: 'Q1',
        4: 'Q2', 5: 'Q2', 6: 'Q2',
        7: 'Q3', 8: 'Q3', 9: 'Q3',
        10: 'Q4', 11: 'Q4', 12: 'Q4'
    }
    
    # Min samples for trust (INCREASED from 5 to 10 per Kimi's request)
    MIN_SAMPLES_FOR_DECISION = 10
    MIN_SAMPLES_FOR_BOOST = 15
    
    # Win rate thresholds (INCREASED from 40% to 45% per Kimi's request)
    WR_BLOCK_THRESHOLD = 0.45  # Below this = BLOCK (was 0.40)
    WR_BOOST_THRESHOLD = 0.65  # Above this = BOOST
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._ensure_tables()
    
    def get_connection(self):
        return sqlite3.connect(self.db_path)
    
    def _ensure_tables(self):
        """Ensure conjunction_patterns table exists"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS conjunction_patterns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                persona_name TEXT DEFAULT 'balanced',
                sector TEXT NOT NULL,
                regime TEXT NOT NULL,
                rsi_bucket TEXT NOT NULL,
                month INTEGER,
                quarter TEXT,
                total_signals INTEGER DEFAULT 0,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                win_rate REAL DEFAULT 0,
                avg_pnl REAL DEFAULT 0,
                decision TEXT DEFAULT 'proceed',
                confidence_adjustment REAL DEFAULT 0,
                last_updated TEXT,
                UNIQUE(persona_name, sector, regime, rsi_bucket, month)
            )
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_conjunction_lookup 
            ON conjunction_patterns(sector, regime, rsi_bucket, month)
        ''')
        
        conn.commit()
        conn.close()
    
    def get_rsi_bucket(self, rsi: float) -> str:
        """Get RSI bucket name"""
        for bucket_name, (low, high) in self.RSI_BUCKETS.items():
            if low <= rsi < high:
                return bucket_name
        return 'neutral'
    
    def get_quarter(self, month: int) -> str:
        """Get quarter from month"""
        return self.MONTH_TO_QUARTER.get(month, 'Q1')
    
    def query_exact_conjunction(
        self,
        sector: str,
        regime: str,
        rsi_bucket: str,
        month: int,
        persona_name: str = 'balanced'
    ) -> Dict:
        """
        Query exact conjunction pattern from outcome_logs
        
        This is the KEY difference from V2:
        - We look for the EXACT combination, not individual factors
        """
        query = '''
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN ol.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN ol.profit_loss_percent <= 0 THEN 1 ELSE 0 END) as losses,
                AVG(ol.profit_loss_percent) as avg_pnl
            FROM outcome_logs ol
            JOIN signal_logs sl ON sl.id = ol.trade_id
            WHERE sl.sector = ?
            AND sl.regime = ?
            AND sl.rsi_bucket = ?
            AND sl.month = ?
            AND (sl.persona_name = ? OR sl.persona_name IS NULL)
        '''
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, (sector, regime, rsi_bucket, month, persona_name))
            result = cursor.fetchone()
            
            if result and result[0] >= self.MIN_SAMPLES_FOR_DECISION:
                total = result[0]
                wins = result[1] or 0
                losses = result[2] or 0
                avg_pnl = result[3] or 0
                win_rate = wins / total if total > 0 else 0.5
                
                return {
                    'found': True,
                    'total': total,
                    'wins': wins,
                    'losses': losses,
                    'win_rate': win_rate,
                    'avg_pnl': avg_pnl,
                    'pattern_type': 'exact',
                    'query': f'{sector}+{regime}+{rsi_bucket}+M{month}'
                }
            
            return {'found': False, 'pattern_type': 'exact'}
    
    def query_partial_conjunction(
        self,
        sector: str,
        regime: str,
        rsi_bucket: str,
        persona_name: str = 'balanced'
    ) -> Dict:
        """
        Query partial conjunction (without month)
        Used when exact conjunction has insufficient samples
        """
        query = '''
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN ol.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
                AVG(ol.profit_loss_percent) as avg_pnl
            FROM outcome_logs ol
            JOIN signal_logs sl ON sl.id = ol.trade_id
            WHERE sl.sector = ?
            AND sl.regime = ?
            AND sl.rsi_bucket = ?
            AND (sl.persona_name = ? OR sl.persona_name IS NULL)
        '''
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, (sector, regime, rsi_bucket, persona_name))
            result = cursor.fetchone()
            
            if result and result[0] >= self.MIN_SAMPLES_FOR_DECISION:
                total = result[0]
                wins = result[1] or 0
                avg_pnl = result[2] or 0
                win_rate = wins / total if total > 0 else 0.5
                
                return {
                    'found': True,
                    'total': total,
                    'wins': wins,
                    'win_rate': win_rate,
                    'avg_pnl': avg_pnl,
                    'pattern_type': 'partial',
                    'query': f'{sector}+{regime}+{rsi_bucket}'
                }
            
            return {'found': False, 'pattern_type': 'partial'}
    
    def query_sector_regime_combo(
        self,
        sector: str,
        regime: str,
        persona_name: str = 'balanced'
    ) -> Dict:
        """
        Query sector + regime combination
        Broader fallback when partial conjunction fails
        """
        query = '''
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN ol.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
                AVG(ol.profit_loss_percent) as avg_pnl
            FROM outcome_logs ol
            JOIN signal_logs sl ON sl.id = ol.trade_id
            WHERE sl.sector = ?
            AND sl.regime = ?
            AND (sl.persona_name = ? OR sl.persona_name IS NULL)
        '''
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, (sector, regime, persona_name))
            result = cursor.fetchone()
            
            if result and result[0] >= self.MIN_SAMPLES_FOR_DECISION:
                total = result[0]
                wins = result[1] or 0
                avg_pnl = result[2] or 0
                win_rate = wins / total if total > 0 else 0.5
                
                return {
                    'found': True,
                    'total': total,
                    'wins': wins,
                    'win_rate': win_rate,
                    'avg_pnl': avg_pnl,
                    'pattern_type': 'sector_regime',
                    'query': f'{sector}+{regime}'
                }
            
            return {'found': False, 'pattern_type': 'sector_regime'}
    
    def query_broad_sector(
        self,
        sector: str,
        persona_name: str = 'balanced'
    ) -> Dict:
        """
        Broadest fallback - just sector
        """
        query = '''
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN ol.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
                AVG(ol.profit_loss_percent) as avg_pnl
            FROM outcome_logs ol
            JOIN signal_logs sl ON sl.id = ol.trade_id
            WHERE sl.sector = ?
            AND (sl.persona_name = ? OR sl.persona_name IS NULL)
        '''
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, (sector, persona_name))
            result = cursor.fetchone()
            
            if result and result[0] >= 10:  # Higher threshold for broad
                total = result[0]
                wins = result[1] or 0
                avg_pnl = result[2] or 0
                win_rate = wins / total if total > 0 else 0.5
                
                return {
                    'found': True,
                    'total': total,
                    'wins': wins,
                    'win_rate': win_rate,
                    'avg_pnl': avg_pnl,
                    'pattern_type': 'broad',
                    'query': sector
                }
            
            return {'found': False, 'pattern_type': 'broad'}
    
    def make_decision(self, result: Dict) -> Tuple[str, float, str]:
        """
        Make decision based on conjunction result
        
        Returns: (decision, confidence_adjustment, reason)
        """
        if not result.get('found'):
            return 'proceed', 0, 'No historical data for this pattern'
        
        win_rate = result['win_rate']
        total = result['total']
        pattern_type = result.get('pattern_type', 'none')
        query = result.get('query', 'unknown')
        
        # Strong block if < 40% win rate with enough samples
        if win_rate < self.WR_BLOCK_THRESHOLD:
            return (
                'block',
                -20,
                f'BLOCK: {query} has {win_rate*100:.0f}% WR ({total} samples)'
            )
        
        # Boost if > 65% win rate with enough samples
        if win_rate >= self.WR_BOOST_THRESHOLD:
            boost = 20 if total >= self.MIN_SAMPLES_FOR_BOOST else 10
            return (
                'boost',
                boost,
                f'BOOST: {query} has {win_rate*100:.0f}% WR ({total} samples)'
            )
        
        # Caution zone
        if win_rate < 0.50:
            return (
                'caution',
                -10,
                f'CAUTION: {query} has {win_rate*100:.0f}% WR ({total} samples)'
            )
        
        # Normal proceed
        return (
            'proceed',
            0,
            f'OK: {query} has {win_rate*100:.0f}% WR ({total} samples)'
        )
    
    def analyze_all_factors(
        self,
        sector: str,
        regime: str,
        rsi: float,
        month: int,
        personality: str = None,
        persona_name: str = 'balanced'
    ) -> MemoryInsight:
        """
        Analyze using Conjunction Patterns
        
        The KEY method - searches from specific to broad:
        1. Exact: sector + regime + rsi_bucket + month + persona
        2. Partial: sector + regime + rsi_bucket + persona
        3. Sector-Regime: sector + regime + persona
        4. Broad: just sector
        """
        rsi_bucket = self.get_rsi_bucket(rsi)
        factors = {}
        
        # Level 1: Exact conjunction
        result = self.query_exact_conjunction(
            sector, regime, rsi_bucket, month, persona_name
        )
        if result['found']:
            decision, adj, reason = self.make_decision(result)
            factors['exact'] = result
            return MemoryInsight(
                found_similar=True,
                total_similar=result['total'],
                wins=result['wins'],
                losses=result.get('losses', result['total'] - result['wins']),
                win_rate=result['win_rate'],
                avg_pnl=result['avg_pnl'],
                confidence_adjustment=adj,
                recommendation=decision,
                reason=reason,
                factors=factors,
                pattern_type='exact'
            )
        
        # Level 2: Partial conjunction (no month)
        result = self.query_partial_conjunction(
            sector, regime, rsi_bucket, persona_name
        )
        if result['found']:
            decision, adj, reason = self.make_decision(result)
            factors['partial'] = result
            return MemoryInsight(
                found_similar=True,
                total_similar=result['total'],
                wins=result['wins'],
                losses=result['total'] - result['wins'],
                win_rate=result['win_rate'],
                avg_pnl=result['avg_pnl'],
                confidence_adjustment=adj * 0.8,  # Slightly less confident
                recommendation=decision,
                reason=reason,
                factors=factors,
                pattern_type='partial'
            )
        
        # Level 3: Sector + Regime
        result = self.query_sector_regime_combo(sector, regime, persona_name)
        if result['found']:
            decision, adj, reason = self.make_decision(result)
            factors['sector_regime'] = result
            return MemoryInsight(
                found_similar=True,
                total_similar=result['total'],
                wins=result['wins'],
                losses=result['total'] - result['wins'],
                win_rate=result['win_rate'],
                avg_pnl=result['avg_pnl'],
                confidence_adjustment=adj * 0.6,  # Less confident
                recommendation=decision,
                reason=reason,
                factors=factors,
                pattern_type='sector_regime'
            )
        
        # Level 4: Broad sector only
        result = self.query_broad_sector(sector, persona_name)
        if result['found']:
            decision, adj, reason = self.make_decision(result)
            factors['broad'] = result
            return MemoryInsight(
                found_similar=True,
                total_similar=result['total'],
                wins=result['wins'],
                losses=result['total'] - result['wins'],
                win_rate=result['win_rate'],
                avg_pnl=result['avg_pnl'],
                confidence_adjustment=adj * 0.4,  # Much less confident
                recommendation=decision,
                reason=reason,
                factors=factors,
                pattern_type='broad'
            )
        
        # No data found = UNKNOWN PATTERN
        # CMS Phase 1.5: UNKNOWN → CAUTION (مش PROCEED)
        # نخصم 30% من الـ Confidence في maestro_orchestrator.py
        return MemoryInsight(
            found_similar=False,
            total_similar=0,
            wins=0,
            losses=0,
            win_rate=0.5,
            avg_pnl=0,
            confidence_adjustment=-30,  # خصم 30% للـ UNKNOWN patterns
            recommendation='caution',
            reason='UNKNOWN_PATTERN: no historical data for this combination',
            factors=factors,
            pattern_type='none'
        )
    
    def record_signal_outcome(
        self,
        ticker: str,
        sector: str,
        regime: str,
        rsi_bucket: str,
        month: int,
        persona_name: str,
        won: bool,
        pnl_percent: float
    ) -> bool:
        """
        Record a signal outcome for future learning
        Updates the conjunction_patterns table
        """
        quarter = self.get_quarter(month)
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Try to update existing pattern
            cursor.execute('''
                UPDATE conjunction_patterns
                SET total_signals = total_signals + 1,
                    wins = wins + ?,
                    losses = losses + ?,
                    avg_pnl = (avg_pnl * total_signals + ?) / (total_signals + 1),
                    win_rate = CAST(wins AS REAL) / total_signals,
                    last_updated = ?
                WHERE persona_name = ? AND sector = ? AND regime = ? 
                  AND rsi_bucket = ? AND month = ?
            ''', (1 if won else 0, 0 if won else 1, pnl_percent, 
                  datetime.now().isoformat(),
                  persona_name, sector, regime, rsi_bucket, month))
            
            if cursor.rowcount == 0:
                # Insert new pattern
                win_rate = 1.0 if won else 0.0
                cursor.execute('''
                    INSERT INTO conjunction_patterns 
                    (persona_name, sector, regime, rsi_bucket, month, quarter,
                     total_signals, wins, losses, win_rate, avg_pnl, last_updated)
                    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
                ''', (persona_name, sector, regime, rsi_bucket, month, quarter,
                      1 if won else 0, win_rate, pnl_percent, 
                      datetime.now().isoformat()))
            
            conn.commit()
            return True
    
    def get_pattern_stats(self) -> Dict:
        """Get statistics about recorded patterns"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Total patterns
            cursor.execute('SELECT COUNT(*) FROM conjunction_patterns')
            total_patterns = cursor.fetchone()[0]
            
            # Patterns with enough samples
            cursor.execute('''
                SELECT COUNT(*) FROM conjunction_patterns 
                WHERE total_signals >= ?
            ''', (self.MIN_SAMPLES_FOR_DECISION,))
            reliable_patterns = cursor.fetchone()[0]
            
            # Distribution by decision
            cursor.execute('''
                SELECT decision, COUNT(*) 
                FROM conjunction_patterns 
                WHERE total_signals >= ?
                GROUP BY decision
            ''', (self.MIN_SAMPLES_FOR_DECISION,))
            decision_dist = dict(cursor.fetchall())
            
            # Top performing patterns
            cursor.execute('''
                SELECT sector, regime, rsi_bucket, win_rate, total_signals
                FROM conjunction_patterns
                WHERE total_signals >= ?
                ORDER BY win_rate DESC
                LIMIT 5
            ''', (self.MIN_SAMPLES_FOR_DECISION,))
            top_patterns = cursor.fetchall()
            
            # Worst performing patterns
            cursor.execute('''
                SELECT sector, regime, rsi_bucket, win_rate, total_signals
                FROM conjunction_patterns
                WHERE total_signals >= ?
                ORDER BY win_rate ASC
                LIMIT 5
            ''', (self.MIN_SAMPLES_FOR_DECISION,))
            worst_patterns = cursor.fetchall()
            
            return {
                'total_patterns': total_patterns,
                'reliable_patterns': reliable_patterns,
                'decision_distribution': decision_dist,
                'top_patterns': [
                    {'sector': p[0], 'regime': p[1], 'rsi': p[2], 
                     'win_rate': p[3], 'samples': p[4]}
                    for p in top_patterns
                ],
                'worst_patterns': [
                    {'sector': p[0], 'regime': p[1], 'rsi': p[2], 
                     'win_rate': p[3], 'samples': p[4]}
                    for p in worst_patterns
                ]
            }


# ==================== CONVENIENCE FUNCTIONS ====================

def get_expert_memory_v3(db_path: str) -> ExpertMemoryEngineV3:
    """Get ExpertMemoryEngineV3 instance"""
    return ExpertMemoryEngineV3(db_path)


def check_signal_memory_v3(
    db_path: str,
    ticker: str,
    sector: str,
    regime: str,
    rsi: float,
    month: int,
    personality: str = None,
    persona_name: str = 'balanced'
) -> MemoryInsight:
    """
    Quick check for signal memory - V3 with Conjunction Patterns
    """
    engine = ExpertMemoryEngineV3(db_path)
    return engine.analyze_all_factors(
        sector, regime, rsi, month, personality, persona_name
    )


# Backward compatibility
def get_expert_memory_v2(db_path: str) -> ExpertMemoryEngineV3:
    """Backward compatibility - returns V3"""
    return ExpertMemoryEngineV3(db_path)


def check_signal_memory_v2(
    db_path: str,
    ticker: str,
    sector: str,
    regime: str,
    rsi: float,
    month: int,
    personality: str = None
) -> MemoryInsight:
    """Backward compatibility - uses V3 logic"""
    return check_signal_memory_v3(
        db_path, ticker, sector, regime, rsi, month, personality, 'balanced'
    )
