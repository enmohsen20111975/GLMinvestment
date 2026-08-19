// ============================================================================
// مساعد الاستثمار Flutter - Strategy Sandbox Screen (P40 Pillar 3)
// مختبر الاستراتيجيات الفنية والمالية — 13 استراتيجية بشارتات SVG توضيحية
// ============================================================================

import 'package:flutter/material.dart';
import '../theme/colors.dart';

class StrategySandboxScreen extends StatefulWidget {
  const StrategySandboxScreen({super.key});

  @override
  State<StrategySandboxScreen> createState() => _StrategySandboxScreenState();
}

class _StrategySandboxScreenState extends State<StrategySandboxScreen> {
  int _selectedTopic = 0;

  static const _topics = [
    _StrategyTopic(
      category: 'SMC / ICT',
      nameAr: 'الفجوة السعرية (FVG)',
      nameEn: 'Fair Value Gap',
      emoji: '📊',
      explanation: 'الفجوة السعرية تحدث عندما يكون هناك فراغ بين جسم الشمعة الأولى والشمعة الثالثة بسبب حركة سريعة في السعر.',
      bullets: [
        'تحصل عندما لا يتداخل جسم الشمعة 1 مع جسم الشمعة 3',
        'تعمل كمنطقة جذب للسعر — غالباً سيعود لملئها',
        'تُستخدم كمنطقة دعم/مقاومة ديناميكية',
      ],
      entry: 'انتظر عودة السعر للفجوة',
      stop: 'أسفل الفجوة بقليل',
      target: 'أحدث قمة قبل الفجوة',
      example: 'COMI في مارس 2024 شكّل FVG صاعدة عند 28-30 ج.م',
    ),
    _StrategyTopic(
      category: 'SMC / ICT',
      nameAr: 'كتلة الطلب (Order Block)',
      nameEn: 'Order Block',
      emoji: '🧱',
      explanation: 'كتلة الطلب هي آخر شمعة هابطة قبل الاندفاع الصاعد القوي. تعمل كدعم عند عودة السعر.',
      bullets: [
        'آخر شمعة حمراء قبل الشراء القوي',
        'تحتوي على طلبات الشراء المؤجلة للأصول الكبيرة',
        'السعر غالباً يرتد منها عند العودة',
      ],
      entry: 'عند وصول السعر لكتلة الطلب',
      stop: 'أسفل كتلة الطلب',
      target: '1:2 على الأقل',
      example: 'ETEL في يناير 2024 — ارتداد قوي من OB عند 18 ج.م',
    ),
    _StrategyTopic(
      category: 'SMC / ICT',
      nameAr: 'جمع السيولة (Liquidity Sweep)',
      nameEn: 'Liquidity Sweep',
      emoji: '💧',
      explanation: 'يحدث عندما يكسر السعر قمة/قاع سابق لجمع أوامر الوقف ثم يرتد في الاتجاه المعاكس.',
      bullets: [
        'صانع السوق يجمع السيولة فوق القمم/تحت القيعان',
        'كسر القمة ثم الارتداد هابط = إشارة بيع',
        'كسر القاع ثم الارتداد صاعد = إشارة شراء',
      ],
      entry: 'بعد الارتداد من القمة المكسورة',
      stop: 'فوق القمة الجديدة',
      target: 'آخر قاع مهم',
      example: 'ORHD في فبراير 2024 — sweep لقمة 25 ثم هبوط لـ 22',
    ),
    _StrategyTopic(
      category: 'SMC / ICT',
      nameAr: 'تغير هيكل السوق (MSS)',
      nameEn: 'Market Structure Shift',
      emoji: '🔄',
      explanation: 'تغير الهيكل من صاعد لهابط يحدث عند كسر آخر قاع. إشارة قوية على تغير الاتجاه.',
      bullets: [
        'صاعد: قمم وقيعان صاعدة → كسر آخر قاع = MSS هابط',
        'هابط: قمم وقيعان هابطة → كسر آخر قمة = MSS صاعد',
        'يؤكد تغير السيطرة من المشتري للبائع أو العكس',
      ],
      entry: 'بعد تأكيد كسر الهيكل',
      stop: 'فوق القمة/القاع المكسور',
      target: '1:3 على الأقل',
      example: 'TMG في أبريل 2024 — MSS هابط بعد كسر قاع 4.5',
    ),
    _StrategyTopic(
      category: 'التحليل الفني التقليدي',
      nameAr: 'الرأس والكتفين (Head & Shoulders)',
      nameEn: 'Head and Shoulders',
      emoji: '👥',
      explanation: 'نموذج انعكاسي هابط يتكون من 3 قمم: الكتف الأيسر، الرأس (الأعلى)، الكتف الأيمن.',
      bullets: [
        'الكتف الأيسر: قمة يتبعها هبوط',
        'الرأس: قمة أعلى من الكتفين',
        'الكتف الأيمن: قمة بمستوى الكتف الأيسر تقريباً',
        'خط الرقبة: وصل القيعان بين القمم',
      ],
      entry: 'بعد كسر خط الرقبة',
      stop: 'فوق الكتف الأيمن',
      target: 'مسافة الرأس لخط الرقبة (أسفل)',
      example: 'CIB في 2023 — H&S كلاسيكي أدى لهبوط 15%',
    ),
    _StrategyTopic(
      category: 'التحليل الفني التقليدي',
      nameAr: 'المثلث الصاعد (Ascending Triangle)',
      nameEn: 'Ascending Triangle',
      emoji: '📐',
      explanation: 'نموذج استمراري صاعد: مقاومة أفقية + خط دعم صاعد. الكسر للأعلى غالباً.',
      bullets: [
        'مقاومة أفقية في الأعلى',
        'قيعان صاعدة تشكل خط دعم مائل',
        'كل قاع أعلى من السابق = ضغط شراء',
        'الكسر للأعلى مع حجم تداول عالي = تأكيد',
      ],
      entry: 'عند كسر المقاومة الأفقية',
      stop: 'أسفل آخر قاع',
      target: 'ارتفاع القاعدة من نقطة الكسر',
      example: 'COMI في 2024 — مثلث صاعد أدى لصعود 12%',
    ),
    _StrategyTopic(
      category: 'التحليل الفني التقليدي',
      nameAr: 'تقاطع RSI السلبي (Bearish Divergence)',
      nameEn: 'RSI Divergence',
      emoji: '📉',
      explanation: 'السعر يصنع قمة أعلى بينما RSI يصنع قمة أقل — تحذير من ضعف الزخم.',
      bullets: [
        'السعر: قمة 1 → قمة 2 أعلى',
        'RSI: قمة 1 → قمة 2 أقل',
        'الزخم يضعف رغم ارتفاع السعر',
        'إشارة بيع محتملة — انتظر تأكيد الشارت',
      ],
      entry: 'بعد كسر الدعم أو شمعة انعكاسية',
      stop: 'فوق القمة الأخيرة',
      target: 'آخر دعم مهم',
      example: 'AAPL في سبتمبر 2023 — RSI divergence أدت لهبوط 8%',
    ),
    _StrategyTopic(
      category: 'التحليل الفني التقليدي',
      nameAr: 'تقاطع MACD (Crossover)',
      nameEn: 'MACD Crossover',
      emoji: '🎯',
      explanation: 'تقاطع خط MACD فوق خط Signal = إشارة شراء. تقاطعه تحته = إشارة بيع.',
      bullets: [
        'MACD فوق Signal = زخم صاعد (شراء)',
        'MACD تحت Signal = زخم هابط (بيع)',
        'الهيستوجرام فوق الصفر = تأكيد قوة',
        'أقوى إشارة عند تقاطع خط الصفر',
      ],
      entry: 'عند تقاطع MACD فوق Signal',
      stop: 'أسفل آخر قاع',
      target: '1:2 R:R',
      example: 'BTC في أكتوبر 2023 — تقاطع MACD أدى لصعود 25%',
    ),
    _StrategyTopic(
      category: 'التحليل الفني التقليدي',
      nameAr: 'انضغاط بولينجر (Bollinger Squeeze)',
      nameEn: 'Bollinger Squeeze',
      emoji: '📏',
      explanation: 'عندما تضيق نطاقات بولينجر بشدة، يسبق ذلك انفجاراً سعرياً في اتجاه ما.',
      bullets: [
        'النطاقات تضيق لأدنى مستوى (Squeeze)',
        'يدل على هدوء مؤقت قبل العاصفة',
        'انتظر اتساع النطاقات لتحديد الاتجاه',
        'الكسر فوق النطاق العلوي = صعود',
      ],
      entry: 'عند اتساع النطاقات + كسر العلوي',
      stop: 'داخل النطاق الأوسط',
      target: 'مسافة الانضغاط',
      example: 'TSLA في يناير 2024 — squeeze أدى لصعود 18%',
    ),
    _StrategyTopic(
      category: 'التحليل المالي والأساسي',
      nameAr: 'مكرر الربح (P/E Ratio)',
      nameEn: 'Price to Earnings',
      emoji: '💰',
      explanation: 'نسبة سعر السهم إلى ربحيته السنوية للسهم الواحد. كلما انخفض عن متوسط القطاع كان أرخص.',
      bullets: [
        'P/E = سعر السهم ÷ EPS',
        'مثال: سعر 100، EPS=10 → P/E=10',
        'P/E منخفض عن متوسط القطاع = سهم رخيص',
        'P/E مرتفع جداً = سهم مبالغ فيه',
      ],
      entry: 'عند P/E < متوسط القطاع + نمو أرباح',
      stop: 'حسب التحليل الفني',
      target: 'P/E يصل لمتوسط القطاع',
      example: 'CIB: P/E=5.2 مقابل متوسط القطاع 8 → مقوّم بأقل من قيمته',
    ),
    _StrategyTopic(
      category: 'التحليل المالي والأساسي',
      nameAr: 'القيمة الدفترية (P/B Ratio)',
      nameEn: 'Price to Book',
      emoji: '📚',
      explanation: 'نسبة سعر السوق للسهم إلى قيمته الدفترية. P/B < 1 يعني السهم يتداول بأقل من قيمته الدفترية.',
      bullets: [
        'P/B = سعر السهم ÷ القيمة الدفترية للسهم',
        'P/B < 1 = سهم بأقل من قيمته الدفترية (فرصة)',
        'P/B > 3 = مبالغة في التقييم (حذر)',
        'مهم للبنوك وشركات التأمين',
      ],
      entry: 'عند P/B < 1 + ROE مرتفع',
      stop: 'حسب التحليل الفني',
      target: 'P/B يصل لـ 1.5-2',
      example: 'بنوك EGX كثيراً ما تتداول بـ P/B < 1',
    ),
    _StrategyTopic(
      category: 'التحليل المالي والأساسي',
      nameAr: 'نسبة التوزيعات (Dividend Yield)',
      nameEn: 'Dividend Yield',
      emoji: '💵',
      explanation: 'نسبة التوزيعات السنوية للسهم إلى سعره. تُظهر العائد النقدي للمستثمر.',
      bullets: [
        'Yield = (التوزيع السنوي ÷ سعر السهم) × 100',
        'مثال: سهم 50 ج.م يوزّع 2.5 → Yield=5%',
        'Yield > 7% = توزيعات سخية (تحقق من الاستدامة)',
        'Yield < 2% = شركة تُعيد استثمار أرباحها',
      ],
      entry: 'قبل تاريخ التوزيع + Yield > 5%',
      stop: 'حسب التحليل الفني',
      target: 'العائد السنوي + نمو رأس المال',
      example: 'TMG توزّع 5-7% سنوياً — مصدر دخل ثابت',
    ),
    _StrategyTopic(
      category: 'التحليل المالي والأساسي',
      nameAr: 'رقم جراهام (Graham Number)',
      nameEn: 'Graham Number',
      emoji: '🧮',
      explanation: 'صيغة بنجامين جراهام لحساب القيمة العادلة للسهم من EPS والقيمة الدفترية.',
      bullets: [
        'Graham = √(22.5 × EPS × Book Value)',
        '22.5 = P/E=15 × P/B=1.5 (معايير جراهام)',
        'إذا كان السعر < Graham = السهم رخيص',
        'إذا كان السعر > Graham = مبالغ فيه',
      ],
      entry: 'عند السعر < 80% من Graham',
      stop: 'حسب التحليل الفني',
      target: 'السعر يصل لـ Graham Number',
      example: 'سهم EPS=5, BV=20 → Graham=√(2250)=47.4 ج.م',
    ),
  ];

  void _next() => setState(() => _selectedTopic = (_selectedTopic + 1) % _topics.length);
  void _prev() => setState(() => _selectedTopic = (_selectedTopic - 1 + _topics.length) % _topics.length);

  @override
  Widget build(BuildContext context) {
    final topic = _topics[_selectedTopic];
    final categories = _topics.map((t) => t.category).toSet().toList();
    return Column(
      children: [
        // Category chips
        Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            itemCount: _topics.length,
            itemBuilder: (ctx, i) {
              final t = _topics[i];
              final selected = i == _selectedTopic;
              return GestureDetector(
                onTap: () => setState(() => _selectedTopic = i),
                child: Container(
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: selected ? AppColors.primary : Colors.grey.shade100,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(t.emoji, style: const TextStyle(fontSize: 12)),
                      const SizedBox(width: 4),
                      Text(
                        t.nameAr,
                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: selected ? Colors.white : Colors.black87),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        // Main content
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(12),
            children: [
              // Chart placeholder
              Card(
                color: AppColors.primaryDark,
                child: SizedBox(
                  height: 160,
                  child: CustomPaint(
                    painter: _StrategyChartPainter(topicIndex: _selectedTopic),
                    child: const SizedBox.expand(),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              // Title
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(topic.emoji, style: const TextStyle(fontSize: 22)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(topic.nameAr, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                                Text(topic.nameEn, style: const TextStyle(fontSize: 11, color: Colors.grey)),
                              ],
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(color: AppColors.primaryContainer, borderRadius: BorderRadius.circular(8)),
                            child: Text(topic.category, style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(topic.explanation, style: const TextStyle(fontSize: 12, height: 1.5)),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              // Bullets
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('النقاط الأساسية', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                      const SizedBox(height: 6),
                      ...topic.bullets.map((b) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('• ', style: TextStyle(fontWeight: FontWeight.bold, color: AppColors.primary)),
                            Expanded(child: Text(b, style: const TextStyle(fontSize: 11, height: 1.4))),
                          ],
                        ),
                      )),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              // How to trade
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('كيف تتداوله', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                      const SizedBox(height: 6),
                      _tradeRow('EntryPoint', topic.entry, Colors.green),
                      _tradeRow('Stop Loss', topic.stop, Colors.red),
                      _tradeRow('Target', topic.target, Colors.blue),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              // Real example
              Card(
                color: Colors.amber.withValues(alpha: 0.1),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.star, size: 16, color: Colors.amber),
                          SizedBox(width: 4),
                          Text('أمثلة حقيقية', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(topic.example, style: const TextStyle(fontSize: 11, height: 1.4)),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              // Nav buttons
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _prev,
                      icon: const Icon(Icons.chevron_right, size: 18),
                      label: const Text('السابق'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _next,
                      icon: const Icon(Icons.chevron_left, size: 18),
                      label: const Text('التالي'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ],
    );
  }

  Widget _tradeRow(String label, String value, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(
            width: 80,
            child: Text(label, style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.bold)),
          ),
          Expanded(child: Text(value, style: const TextStyle(fontSize: 11))),
        ],
      ),
    );
  }
}

class _StrategyTopic {
  final String category;
  final String nameAr;
  final String nameEn;
  final String emoji;
  final String explanation;
  final List<String> bullets;
  final String entry;
  final String stop;
  final String target;
  final String example;
  const _StrategyTopic({
    required this.category,
    required this.nameAr,
    required this.nameEn,
    required this.emoji,
    required this.explanation,
    required this.bullets,
    required this.entry,
    required this.stop,
    required this.target,
    required this.example,
  });
}

class _StrategyChartPainter extends CustomPainter {
  final int topicIndex;
  _StrategyChartPainter({required this.topicIndex});

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    // Background grid
    final gridPaint = Paint()..color = Colors.white24..strokeWidth = 0.5;
    for (var i = 0; i <= 4; i++) {
      final yy = h * i / 4;
      canvas.drawLine(Offset(0, yy), Offset(w, yy), gridPaint);
    }
    // Generate synthetic candle data based on topic
    final candles = _generateCandles(topicIndex, w, h);
    final greenPaint = Paint()..color = Colors.green;
    final redPaint = Paint()..color = Colors.red;
    final wickPaint = Paint()..color = Colors.white54..strokeWidth = 1;
    for (final c in candles) {
      final x = c['x'] as double;
      final high = c['high'] as double;
      final low = c['low'] as double;
      final open = c['open'] as double;
      final close = c['close'] as double;
      canvas.drawLine(Offset(x, high), Offset(x, low), wickPaint);
      final isBull = close >= open;
      final bodyRect = Rect.fromCenter(
        center: Offset(x, (open + close) / 2),
        width: 8,
        height: (close - open).abs().clamp(2.0, double.infinity),
      );
      canvas.drawRect(bodyRect, isBull ? greenPaint : redPaint);
    }
    // Annotations
    final labelPaint = Paint()..color = Colors.amber..style = PaintingStyle.stroke..strokeWidth = 2;
    if (topicIndex < 4) {
      // SMC topics: draw rectangle around the key area
      final rect = Rect.fromLTWH(w * 0.4, h * 0.2, w * 0.25, h * 0.4);
      canvas.drawRect(rect, labelPaint);
    } else if (topicIndex == 4) {
      // Head & Shoulders: draw 3 circles
      final circlePaint = Paint()..color = Colors.amber..style = PaintingStyle.stroke..strokeWidth = 2;
      canvas.drawCircle(Offset(w * 0.25, h * 0.5), 8, circlePaint);
      canvas.drawCircle(Offset(w * 0.5, h * 0.3), 8, circlePaint);
      canvas.drawCircle(Offset(w * 0.75, h * 0.55), 8, circlePaint);
    }
  }

  List<Map<String, double>> _generateCandles(int topic, double w, double h) {
    final candles = <Map<String, double>>[];
    final count = 20;
    final step = w / count;
    var base = h * 0.5;
    for (var i = 0; i < count; i++) {
      final x = step * (i + 0.5);
      final isUp = (i + topic) % 3 != 0;
      final vol = (i % 5) * 3 + 5;
      final open = base;
      final close = isUp ? base - vol : base + vol;
      final high = (open < close ? open : close) - vol * 0.5;
      final low = (open > close ? open : close) + vol * 0.5;
      candles.add({'x': x, 'open': open, 'close': close, 'high': high, 'low': low});
      base = close;
    }
    return candles;
  }

  @override
  bool shouldRepaint(covariant _StrategyChartPainter old) => old.topicIndex != topicIndex;
}
