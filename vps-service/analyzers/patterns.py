"""
Pattern Recognition Engine
==========================
Price Pattern Recognition for technical analysis.

Features:
- Head and Shoulders
- Double Top/Bottom
- Triangles (Ascending, Descending, Symmetrical)
- Flags and Pennants
- Cup and Handle

Author: دليل الاستثمار
"""

from typing import Dict, List, Optional
from dataclasses import dataclass
from enum import Enum


class PatternType(Enum):
    HEAD_AND_SHOULDERS = "HEAD_AND_SHOULDERS"
    INVERSE_HEAD_AND_SHOULDERS = "INVERSE_HEAD_AND_SHOULDERS"
    DOUBLE_TOP = "DOUBLE_TOP"
    DOUBLE_BOTTOM = "DOUBLE_BOTTOM"
    ASCENDING_TRIANGLE = "ASCENDING_TRIANGLE"
    DESCENDING_TRIANGLE = "DESCENDING_TRIANGLE"
    SYMMETRICAL_TRIANGLE = "SYMMETRICAL_TRIANGLE"
    BULL_FLAG = "BULL_FLAG"
    BEAR_FLAG = "BEAR_FLAG"
    CUP_AND_HANDLE = "CUP_AND_HANDLE"


@dataclass
class Pattern:
    """Detected pattern."""
    pattern_type: str
    direction: str  # BULLISH, BEARISH, NEUTRAL
    confidence: float
    entry_price: Optional[float]
    target_price: Optional[float]
    stop_loss: Optional[float]
    description: str
    start_index: int
    end_index: int
    
    def to_dict(self) -> Dict:
        return {
            'pattern_type': self.pattern_type,
            'direction': self.direction,
            'confidence': round(self.confidence, 2),
            'entry_price': round(self.entry_price, 4) if self.entry_price else None,
            'target_price': round(self.target_price, 4) if self.target_price else None,
            'stop_loss': round(self.stop_loss, 4) if self.stop_loss else None,
            'description': self.description
        }


class PatternRecognitionEngine:
    """
    Pattern Recognition Engine.
    
    Usage:
        engine = PatternRecognitionEngine()
        patterns = engine.analyze(highs, lows, closes)
    """
    
    def __init__(self):
        self.patterns_found: List[Pattern] = []
    
    def analyze(
        self,
        highs: List[float],
        lows: List[float],
        closes: List[float],
        volumes: List[float] = None
    ) -> List[Pattern]:
        """
        Analyze price data for patterns.
        
        Args:
            highs: List of high prices
            lows: List of low prices
            closes: List of close prices
            volumes: Optional list of volumes
            
        Returns:
            List of detected patterns
        """
        self.patterns_found = []
        
        if len(closes) < 50:
            return []
        
        # Detect different patterns
        self._detect_head_and_shoulders(highs, lows, closes)
        self._detect_double_top_bottom(highs, lows, closes)
        self._detect_triangles(highs, lows, closes)
        
        return self.patterns_found
    
    def _detect_head_and_shoulders(self, highs, lows, closes):
        """Detect head and shoulders pattern."""
        if len(highs) < 30:
            return
        
        # Find local maxima
        peaks = []
        for i in range(5, len(highs) - 5):
            if highs[i] == max(highs[i-5:i+6]):
                peaks.append((i, highs[i]))
        
        if len(peaks) < 3:
            return
        
        # Check for head and shoulders
        for i in range(len(peaks) - 2):
            left_shoulder = peaks[i]
            head = peaks[i + 1]
            right_shoulder = peaks[i + 2]
            
            # Head should be higher than shoulders
            if head[1] > left_shoulder[1] and head[1] > right_shoulder[1]:
                # Shoulders should be roughly equal (within 5%)
                if abs(left_shoulder[1] - right_shoulder[1]) / left_shoulder[1] < 0.05:
                    neckline = min(lows[head[0]:right_shoulder[0] + 1])
                    
                    pattern = Pattern(
                        pattern_type="HEAD_AND_SHOULDERS",
                        direction="BEARISH",
                        confidence=0.7,
                        entry_price=closes[-1],
                        target_price=neckline - (head[1] - neckline),
                        stop_loss=head[1] * 1.02,
                        description="Head and Shoulders - bearish reversal pattern",
                        start_index=left_shoulder[0],
                        end_index=right_shoulder[0]
                    )
                    self.patterns_found.append(pattern)
    
    def _detect_double_top_bottom(self, highs, lows, closes):
        """Detect double top and double bottom patterns."""
        if len(highs) < 20:
            return
        
        # Find peaks and troughs
        peaks = []
        troughs = []
        
        for i in range(5, len(highs) - 5):
            if highs[i] == max(highs[i-5:i+6]):
                peaks.append((i, highs[i]))
            if lows[i] == min(lows[i-5:i+6]):
                troughs.append((i, lows[i]))
        
        # Double Top
        if len(peaks) >= 2:
            for i in range(len(peaks) - 1):
                p1, p2 = peaks[i], peaks[i + 1]
                if abs(p1[1] - p2[1]) / p1[1] < 0.02:  # Within 2%
                    neckline = min(lows[p1[0]:p2[0] + 1])
                    pattern = Pattern(
                        pattern_type="DOUBLE_TOP",
                        direction="BEARISH",
                        confidence=0.75,
                        entry_price=closes[-1],
                        target_price=neckline - (p1[1] - neckline),
                        stop_loss=p1[1] * 1.02,
                        description="Double Top - bearish reversal",
                        start_index=p1[0],
                        end_index=p2[0]
                    )
                    self.patterns_found.append(pattern)
        
        # Double Bottom
        if len(troughs) >= 2:
            for i in range(len(troughs) - 1):
                t1, t2 = troughs[i], troughs[i + 1]
                if abs(t1[1] - t2[1]) / t1[1] < 0.02:
                    neckline = max(highs[t1[0]:t2[0] + 1])
                    pattern = Pattern(
                        pattern_type="DOUBLE_BOTTOM",
                        direction="BULLISH",
                        confidence=0.75,
                        entry_price=closes[-1],
                        target_price=neckline + (neckline - t1[1]),
                        stop_loss=t1[1] * 0.98,
                        description="Double Bottom - bullish reversal",
                        start_index=t1[0],
                        end_index=t2[0]
                    )
                    self.patterns_found.append(pattern)
    
    def _detect_triangles(self, highs, lows, closes):
        """Detect triangle patterns."""
        if len(highs) < 20:
            return
        
        window = 20
        recent_highs = highs[-window:]
        recent_lows = lows[-window:]
        
        # Calculate trend lines
        high_slope = self._calculate_slope(list(range(window)), recent_highs)
        low_slope = self._calculate_slope(list(range(window)), recent_lows)
        
        # Ascending Triangle (flat top, rising bottom)
        if abs(high_slope) < 0.01 and low_slope > 0.02:
            pattern = Pattern(
                pattern_type="ASCENDING_TRIANGLE",
                direction="BULLISH",
                confidence=0.7,
                entry_price=closes[-1],
                target_price=max(recent_highs) * 1.05,
                stop_loss=min(recent_lows) * 0.98,
                description="Ascending Triangle - bullish continuation",
                start_index=len(highs) - window,
                end_index=len(highs) - 1
            )
            self.patterns_found.append(pattern)
        
        # Descending Triangle (falling top, flat bottom)
        elif high_slope < -0.02 and abs(low_slope) < 0.01:
            pattern = Pattern(
                pattern_type="DESCENDING_TRIANGLE",
                direction="BEARISH",
                confidence=0.7,
                entry_price=closes[-1],
                target_price=min(recent_lows) * 0.95,
                stop_loss=max(recent_highs) * 1.02,
                description="Descending Triangle - bearish continuation",
                start_index=len(highs) - window,
                end_index=len(highs) - 1
            )
            self.patterns_found.append(pattern)
        
        # Symmetrical Triangle (converging)
        elif high_slope < -0.01 and low_slope > 0.01:
            pattern = Pattern(
                pattern_type="SYMMETRICAL_TRIANGLE",
                direction="NEUTRAL",
                confidence=0.6,
                entry_price=closes[-1],
                target_price=None,
                stop_loss=None,
                description="Symmetrical Triangle - breakout pending",
                start_index=len(highs) - window,
                end_index=len(highs) - 1
            )
            self.patterns_found.append(pattern)
    
    def _calculate_slope(self, x: List[float], y: List[float]) -> float:
        """Calculate slope of linear regression."""
        n = len(x)
        if n < 2:
            return 0
        
        sum_x = sum(x)
        sum_y = sum(y)
        sum_xy = sum(x[i] * y[i] for i in range(n))
        sum_xx = sum(x[i] ** 2 for i in range(n))
        
        denominator = n * sum_xx - sum_x ** 2
        if denominator == 0:
            return 0
        
        return (n * sum_xy - sum_x * sum_y) / denominator
    
    def get_pattern_score(self) -> int:
        """Get overall pattern score (-5 to +5)."""
        if not self.patterns_found:
            return 0
        
        score = 0
        for pattern in self.patterns_found:
            if pattern.direction == "BULLISH":
                score += pattern.confidence * 2
            elif pattern.direction == "BEARISH":
                score -= pattern.confidence * 2
        
        return max(-5, min(5, int(score)))
