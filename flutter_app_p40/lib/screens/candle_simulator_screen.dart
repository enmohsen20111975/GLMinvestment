// ============================================================================
// مساعد الاستثمار Flutter - Candle Simulator Screen (P40 Pillar 2)
// محاكي الشموع اليابانية التفاعلي — 14 نمط + sliders + كشف آلي
// ============================================================================

import 'package:flutter/material.dart';
import '../theme/colors.dart';

class CandleSimulatorScreen extends StatefulWidget {
  const CandleSimulatorScreen({super.key});

  @override
  State<CandleSimulatorScreen> createState() => _CandleSimulatorScreenState();
}

class _CandleSimulatorScreenState extends State<CandleSimulatorScreen> {
  double _open = 50;
  double _high = 60;
  double _low = 40;
  double _close = 55;

  @override
  Widget build(BuildContext context) {
    final patterns = _detectPatterns();
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        // SVG-like candle rendering
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                const Text('الشمعة الحالية', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                const SizedBox(height: 12),
                SizedBox(
                  height: 220,
                  child: CustomPaint(
                    painter: _CandlePainter(
                      open: _open,
                      high: _high,
                      low: _low,
                      close: _close,
                    ),
                    child: const SizedBox.expand(),
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _priceLabel('O', _open, Colors.blue),
                    _priceLabel('H', _high, Colors.green),
                    _priceLabel('L', _low, Colors.red),
                    _priceLabel('C', _close, Colors.purple),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        // Sliders
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                _buildSlider('الافتتاح (Open)', _open, (v) => setState(() {
                  _open = v;
                  if (_high < v) _high = v;
                  if (_low > v) _low = v;
                })),
                _buildSlider('الأعلى (High)', _high, (v) => setState(() {
                  _high = v;
                  if (v < _open) _high = _open;
                  if (v < _close) _high = _close;
                })),
                _buildSlider('الأدنى (Low)', _low, (v) => setState(() {
                  _low = v;
                  if (v > _open) _low = _open;
                  if (v > _close) _low = _close;
                })),
                _buildSlider('الإغلاق (Close)', _close, (v) => setState(() {
                  _close = v;
                  if (_high < v) _high = v;
                  if (_low > v) _low = v;
                })),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        // Detected patterns
        if (patterns.isNotEmpty) ...[
          const Text('الأنماط المكتشفة', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
          const SizedBox(height: 6),
          ...patterns.map(_buildPatternCard),
        ] else
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                children: [
                  const Icon(Icons.lightbulb_outline, size: 32, color: Colors.grey),
                  const SizedBox(height: 6),
                  const Text('لا يوجد نمط واضح', style: TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  const Text('جرّب تحريك الـ sliders لإنشاء نمط شمعة معروف', style: TextStyle(fontSize: 11, color: Colors.grey), textAlign: TextAlign.center),
                ],
              ),
            ),
          ),
        const SizedBox(height: 12),
        // Educational footer
        Card(
          color: AppColors.primaryContainer,
          child: const Padding(
            padding: EdgeInsets.all(12),
            child: Text(
              'الشموع اليابانية تعكس صراع المشتري والبائع خلال الجلسة. الجسم الأخضر يعني أن المشتري سيطر، والأحمر يعني أن البائع سيطر. الفتيل العلوي يُظهر رفض السعر للأعلى، والسفلي يُظهر رفض السعر للأسفل.',
              style: TextStyle(fontSize: 11, height: 1.5),
              textAlign: TextAlign.center,
            ),
          ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }

  Widget _priceLabel(String label, double value, Color color) {
    return Column(
      children: [
        Text(label, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 12)),
        Text(value.toStringAsFixed(1), style: TextStyle(color: color, fontSize: 13)),
      ],
    );
  }

  Widget _buildSlider(String label, double value, ValueChanged<double> onChanged) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(width: 110, child: Text(label, style: const TextStyle(fontSize: 12))),
          Expanded(
            child: Slider(
              value: value,
              min: 0,
              max: 100,
              divisions: 200,
              activeColor: AppColors.primary,
              onChanged: onChanged,
            ),
          ),
          SizedBox(width: 40, child: Text(value.toStringAsFixed(1), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold))),
        ],
      ),
    );
  }

  Widget _buildPatternCard(Map<String, dynamic> p) {
    final type = p['type'] as String;
    final typeColor = type == 'bullish' ? Colors.green : (type == 'bearish' ? Colors.red : Colors.grey);
    final reliability = p['reliability'] as String;
    final relColor = reliability == 'high' ? Colors.amber : (reliability == 'medium' ? Colors.blueGrey : Colors.brown);
    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(p['emoji'] as String, style: const TextStyle(fontSize: 18)),
                const SizedBox(width: 6),
                Expanded(child: Text(p['nameAr'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13))),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: typeColor.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(4)),
                  child: Text(type == 'bullish' ? 'صاعد' : (type == 'bearish' ? 'هابط' : 'محايد'), style: TextStyle(color: typeColor, fontSize: 9, fontWeight: FontWeight.bold)),
                ),
                const SizedBox(width: 4),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: relColor.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(4)),
                  child: Text(reliability == 'high' ? 'عالي' : (reliability == 'medium' ? 'متوسط' : 'منخفض'), style: TextStyle(color: relColor, fontSize: 9)),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(p['description'] as String, style: const TextStyle(fontSize: 11, height: 1.4)),
            const SizedBox(height: 6),
            // Probability bar
            Row(
              children: [
                Expanded(
                  flex: (p['bullishProb'] as int),
                  child: Container(height: 6, color: Colors.green),
                ),
                Expanded(
                  flex: 100 - (p['bullishProb'] as int) - (p['bearishProb'] as int),
                  child: Container(height: 6, color: Colors.grey.shade300),
                ),
                Expanded(
                  flex: (p['bearishProb'] as int),
                  child: Container(height: 6, color: Colors.red),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('صعود ${(p['bullishProb'] as int)}%', style: const TextStyle(fontSize: 9, color: Colors.green)),
                Text('هبوط ${(p['bearishProb'] as int)}%', style: const TextStyle(fontSize: 9, color: Colors.red)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  List<Map<String, dynamic>> _detectPatterns() {
    final o = _open, h = _high, l = _low, c = _close;
    final body = (c - o).abs();
    final range = h - l;
    final upperWick = h - (o > c ? o : c);
    final lowerWick = (o < c ? o : c) - l;
    final isBull = c > o;
    final isBear = c < o;
    final results = <Map<String, dynamic>>[];

    // Doji
    if (body <= range * 0.1) {
      results.add({'emoji': '➕', 'nameAr': 'دوجي (Doji)', 'type': 'neutral', 'reliability': 'medium',
        'description': 'تساوي تقريبي بين الافتتاح والإغلاق — تردد السوق وانتظار اتجاه جديد.',
        'bullishProb': 45, 'bearishProb': 45});
    }
    // Hammer
    if (lowerWick > body * 2 && upperWick < body * 0.5 && body > range * 0.1) {
      results.add({'emoji': '🔨', 'nameAr': 'المطرقة (Hammer)', 'type': 'bullish', 'reliability': 'high',
        'description': 'فتيل سفلي طويل وجسم صغير بأعلى — رفض البائعين للسعر المنخفض وإشارة شراء محتملة.',
        'bullishProb': 70, 'bearishProb': 20});
    }
    // Inverted Hammer
    if (upperWick > body * 2 && lowerWick < body * 0.5 && body > range * 0.1) {
      results.add({'emoji': '🔨', 'nameAr': 'المطرقة المقلوبة (Inverted Hammer)', 'type': 'bullish', 'reliability': 'medium',
        'description': 'فتيل علوي طويل — محاولة شراء قوبلت ببيع، تحتاج تأكيد بالشمعة التالية.',
        'bullishProb': 55, 'bearishProb': 30});
    }
    // Shooting Star
    if (upperWick > body * 2 && lowerWick < body * 0.5 && isBear && body > range * 0.1) {
      results.add({'emoji': '🌠', 'nameAr': 'النجمة الهابطة (Shooting Star)', 'type': 'bearish', 'reliability': 'high',
        'description': 'فتيل علوي طويل مع جسم أحمر صغير — رفض المشترين للسعر المرتفع وإشارة بيع.',
        'bullishProb': 20, 'bearishProb': 70});
    }
    // Marubozu Bullish
    if (isBull && upperWick < body * 0.05 && lowerWick < body * 0.05 && body > range * 0.9) {
      results.add({'emoji': '🟩', 'nameAr': 'ماروبوزو الصاعد (Marubozu Bullish)', 'type': 'bullish', 'reliability': 'high',
        'description': 'جسم أخضر كامل بدون فتائل — سيطرة تامة للمشترين واستمرار صعودي محتمل.',
        'bullishProb': 80, 'bearishProb': 10});
    }
    // Marubozu Bearish
    if (isBear && upperWick < body * 0.05 && lowerWick < body * 0.05 && body > range * 0.9) {
      results.add({'emoji': '🟥', 'nameAr': 'ماروبوزو الهابط (Marubozu Bearish)', 'type': 'bearish', 'reliability': 'high',
        'description': 'جسم أحمر كامل بدون فتائل — سيطرة تامة للبائعين واستمرار هبوطي محتمل.',
        'bullishProb': 10, 'bearishProb': 80});
    }
    // Spinning Top
    if (body <= range * 0.3 && upperWick > body && lowerWick > body) {
      results.add({'emoji': '🌀', 'nameAr': 'النخامة الدوارة (Spinning Top)', 'type': 'neutral', 'reliability': 'low',
        'description': 'جسم صغير مع فتائل طويلة من الجانبين — تردد وصراع متوازن، انتظر كسر الاتجاه.',
        'bullishProb': 40, 'bearishProb': 40});
    }
    // Bullish Engulfing (simplified: big green body)
    if (isBull && body > range * 0.6) {
      results.add({'emoji': '🟢', 'nameAr': 'ابتلاع صاعد محتمل (Bullish Engulfing)', 'type': 'bullish', 'reliability': 'medium',
        'description': 'جسم أخضر كبير — يحتاج شمعة حمراء سابقة لتأكيد نموذج الابتلاع الصاعد.',
        'bullishProb': 65, 'bearishProb': 25});
    }
    // Bearish Engulfing (simplified: big red body)
    if (isBear && body > range * 0.6) {
      results.add({'emoji': '🔴', 'nameAr': 'ابتلاع هابط محتمل (Bearish Engulfing)', 'type': 'bearish', 'reliability': 'medium',
        'description': 'جسم أحمر كبير — يحتاج شمعة خضراء سابقة لتأكيد نموذج الابتلاع الهابط.',
        'bullishProb': 25, 'bearishProb': 65});
    }
    return results;
  }
}

class _CandlePainter extends CustomPainter {
  final double open, high, low, close;
  _CandlePainter({required this.open, required this.high, required this.low, required this.close});

  @override
  void paint(Canvas canvas, Size size) {
    final isBull = close >= open;
    final color = isBull ? Colors.green : Colors.red;
    final w = size.width;
    final h = size.height;
    final padTop = 20.0;
    final padBottom = 20.0;
    final usableH = h - padTop - padBottom;
    final range = 100.0; // 0..100

    double y(double price) => padTop + (1 - price / range) * usableH;

    // Grid lines
    final gridPaint = Paint()..color = Colors.grey.shade300..strokeWidth = 0.5;
    for (var i = 0; i <= 4; i++) {
      final yy = padTop + (usableH * i / 4);
      canvas.drawLine(Offset(0, yy), Offset(w, yy), gridPaint);
    }

    final centerX = w / 2;
    final bodyTop = y(open > close ? open : close);
    final bodyBottom = y(open < close ? open : close);
    final bodyHeight = (bodyBottom - bodyTop).abs().clamp(2.0, double.infinity);

    // Wick
    final wickPaint = Paint()..color = color..strokeWidth = 2;
    canvas.drawLine(Offset(centerX, y(high)), Offset(centerX, y(low)), wickPaint);

    // Body
    final bodyPaint = Paint()..color = color;
    final bodyRect = Rect.fromCenter(center: Offset(centerX, (bodyTop + bodyBottom) / 2), width: 40, height: bodyHeight);
    canvas.drawRect(bodyRect, bodyPaint);

    // Doji cross
    if ((close - open).abs() < 0.5) {
      final crossPaint = Paint()..color = Colors.black..strokeWidth = 2;
      canvas.drawLine(Offset(centerX - 20, bodyTop), Offset(centerX + 20, bodyTop), crossPaint);
    }

    // Price labels
    final tp = TextPainter(textDirection: TextDirection.ltr, textAlign: TextAlign.left);
    final labelStyle = TextStyle(fontSize: 9, color: Colors.grey.shade700);
    tp.text = TextSpan(text: 'H: ${high.toStringAsFixed(1)}', style: labelStyle.copyWith(color: Colors.green));
    tp.layout();
    tp.paint(canvas, Offset(w - 50, y(high) - 6));
    tp.text = TextSpan(text: 'L: ${low.toStringAsFixed(1)}', style: labelStyle.copyWith(color: Colors.red));
    tp.layout();
    tp.paint(canvas, Offset(w - 50, y(low) - 6));
    tp.text = TextSpan(text: 'O: ${open.toStringAsFixed(1)}', style: labelStyle.copyWith(color: Colors.blue));
    tp.layout();
    tp.paint(canvas, Offset(w - 50, y(open) - 6));
    tp.text = TextSpan(text: 'C: ${close.toStringAsFixed(1)}', style: labelStyle.copyWith(color: Colors.purple));
    tp.layout();
    tp.paint(canvas, Offset(w - 50, y(close) - 6));
  }

  @override
  bool shouldRepaint(covariant _CandlePainter old) =>
      old.open != open || old.high != high || old.low != low || old.close != close;
}
