"""
Fibonacci Analyzer
==================
Fibonacci Analysis Engine for support/resistance levels.

Features:
- Fibonacci Retracements
- Fibonacci Extensions
- Fibonacci Clusters
- Golden Ratio Analysis

Author: دليل الاستثمار
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass


@dataclass
class FibonacciLevel:
    """Fibonacci level."""
    level_name: str
    level_value: float
    price: float
    significance: str  # CRITICAL, IMPORTANT, MODERATE
    description: str = ""


class FibonacciAnalyzer:
    """
    Fibonacci Analysis Engine.
    
    Usage:
        fib = FibonacciAnalyzer()
        levels = fib.calculate_retracement(100, 80, 90)
        clusters = fib.find_cluster_zones(retracements, extensions)
    """
    
    # Standard Fibonacci levels
    RETRACEMENT_LEVELS = {
        '0%': 0,
        '23.6%': 0.236,
        '38.2%': 0.382,
        '50%': 0.5,
        '61.8%': 0.618,  # Golden Ratio
        '78.6%': 0.786,
        '100%': 1.0
    }
    
    EXTENSION_LEVELS = {
        '127.2%': 1.272,
        '161.8%': 1.618,  # Golden Extension
        '200%': 2.0,
        '261.8%': 2.618
    }
    
    def __init__(self):
        self.golden_ratio = 0.618
        self.golden_extension = 1.618
    
    def calculate_retracement(
        self,
        swing_high: float,
        swing_low: float,
        current_price: float = None
    ) -> List[FibonacciLevel]:
        """
        Calculate Fibonacci retracement levels.
        
        Args:
            swing_high: Highest price in the move
            swing_low: Lowest price in the move
            current_price: Current price (optional)
            
        Returns:
            List of FibonacciLevel objects
        """
        levels = []
        price_range = swing_high - swing_low
        
        for name, value in self.RETRACEMENT_LEVELS.items():
            price = swing_high - (price_range * value)
            
            # Determine significance
            if value == 0.618:
                significance = "CRITICAL"
                description = "النسبة الذهبية - أقوى مستوى دعم/مقاومة"
            elif value in [0.382, 0.5]:
                significance = "IMPORTANT"
                description = "مستوى مهم"
            elif value == 0.786:
                significance = "IMPORTANT"
                description = "مستوى تصحيح عميق"
            else:
                significance = "MODERATE"
                description = ""
            
            levels.append(FibonacciLevel(
                level_name=name,
                level_value=value,
                price=round(price, 4),
                significance=significance,
                description=description
            ))
        
        return levels
    
    def calculate_extension(
        self,
        wave_start: float,
        wave_end: float,
        retracement_point: float
    ) -> List[FibonacciLevel]:
        """
        Calculate Fibonacci extension levels for targets.
        
        Args:
            wave_start: Start of the wave
            wave_end: End of the wave
            retracement_point: Point where retracement ended
            
        Returns:
            List of FibonacciLevel objects
        """
        levels = []
        wave_length = abs(wave_end - wave_start)
        
        for name, value in self.EXTENSION_LEVELS.items():
            price = retracement_point + (wave_length * value)
            
            if value == 1.618:
                significance = "CRITICAL"
                description = "الهدف الذهبي - امتداد 161.8%"
            elif value == 1.272:
                significance = "IMPORTANT"
                description = "الهدف الأول - امتداد 127.2%"
            else:
                significance = "MODERATE"
                description = ""
            
            levels.append(FibonacciLevel(
                level_name=name,
                level_value=value,
                price=round(price, 4),
                significance=significance,
                description=description
            ))
        
        return levels
    
    def find_cluster_zones(
        self,
        retracement_levels: List[FibonacciLevel],
        extension_levels: List[FibonacciLevel],
        tolerance: float = 0.01
    ) -> List[Dict]:
        """
        Find Fibonacci cluster zones (confluence areas).
        
        Args:
            retracement_levels: List of retracement levels
            extension_levels: List of extension levels
            tolerance: Tolerance for clustering (1% default)
            
        Returns:
            List of cluster zones
        """
        clusters = []
        all_levels = retracement_levels + extension_levels
        
        for i, level1 in enumerate(all_levels):
            for level2 in all_levels[i+1:]:
                # Check if levels are close (within tolerance)
                price_diff = abs(level1.price - level2.price) / level1.price
                
                if price_diff < tolerance:
                    # Found a cluster
                    cluster_price = (level1.price + level2.price) / 2
                    
                    # Determine strength
                    if level1.significance == "CRITICAL" or level2.significance == "CRITICAL":
                        strength = "VERY_STRONG"
                    elif level1.significance == "IMPORTANT" or level2.significance == "IMPORTANT":
                        strength = "STRONG"
                    else:
                        strength = "MODERATE"
                    
                    clusters.append({
                        'price': round(cluster_price, 4),
                        'levels': [level1.level_name, level2.level_name],
                        'strength': strength,
                        'description': f"Cluster at {cluster_price:.2f} - {level1.level_name} + {level2.level_name}"
                    })
        
        return clusters
    
    def check_price_at_golden_level(
        self,
        current_price: float,
        swing_high: float,
        swing_low: float,
        tolerance: float = 0.02
    ) -> Optional[Dict]:
        """
        Check if price is at golden ratio level (61.8%).
        
        Args:
            current_price: Current price
            swing_high: Swing high
            swing_low: Swing low
            tolerance: Tolerance (2% default)
            
        Returns:
            Dict if at golden level, None otherwise
        """
        price_range = swing_high - swing_low
        golden_price = swing_high - (price_range * self.golden_ratio)
        
        diff_percent = abs(current_price - golden_price) / golden_price
        
        if diff_percent < tolerance:
            return {
                'at_golden_level': True,
                'golden_price': round(golden_price, 4),
                'current_price': current_price,
                'distance_percent': round(diff_percent * 100, 2),
                'signal': 'STRONG_SUPPORT' if current_price < golden_price else 'STRONG_RESISTANCE'
            }
        
        return None
    
    def integrate_with_pattern(
        self,
        pattern_type: str,
        pattern_high: float,
        pattern_low: float,
        current_price: float
    ) -> Dict:
        """
        Integrate Fibonacci with pattern analysis.
        
        Args:
            pattern_type: Type of pattern detected
            pattern_high: Pattern high
            pattern_low: Pattern low
            current_price: Current price
            
        Returns:
            Integration result
        """
        retracements = self.calculate_retracement(pattern_high, pattern_low, current_price)
        
        # Find golden level
        golden_level = None
        for level in retracements:
            if level.level_value == self.golden_ratio:
                golden_level = level
                break
        
        # Calculate confidence boost
        confidence_boost = 0
        signals = []
        
        if golden_level:
            price_diff = abs(current_price - golden_level.price) / golden_level.price
            
            if price_diff < 0.02:  # Within 2%
                confidence_boost = 15
                signals.append(f"Price at golden ratio {golden_level.price:.2f}")
            elif price_diff < 0.05:
                confidence_boost = 5
                signals.append(f"Price near golden ratio {golden_level.price:.2f}")
        
        return {
            'fibonacci_integration': {
                'golden_level': golden_level.price if golden_level else None,
                'current_distance_from_golden': price_diff if golden_level else None
            },
            'confidence_boost': confidence_boost,
            'signals': signals
        }
