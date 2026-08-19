// ============================================================================
// مساعد الاستثمار Flutter - Risk Profiler Screen (P39)
// استبيان الأهداف الديناميكي — 10 أسئلة تحسب Risk Score (1-100)
// ============================================================================

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../theme/colors.dart';
import '../api/client.dart';

class RiskProfilerScreen extends StatefulWidget {
  const RiskProfilerScreen({super.key});

  @override
  State<RiskProfilerScreen> createState() => _RiskProfilerScreenState();
}

class _RiskProfilerScreenState extends State<RiskProfilerScreen> {
  int _step = 0;
  final Map<int, int> _answers = {};
  bool _completed = false;

  static const _questions = [
    _Question('ما نسبة رأس مالك المستعد لخسارته في صفقة واحدة؟', [
      _Option('أقل من 1%', 1),
      _Option('من 1% إلى 3%', 4),
      _Option('من 3% إلى 6%', 7),
      _Option('أكثر من 6%', 10),
    ]),
    _Question('إذا انخفض سهمك 15% خلال أسبوع، ماذا تفعل؟', [
      _Option('أبيع فوراً وأقطع الخسارة', 1),
      _Option('أراجع التحليل وأعيد التقييم', 4),
      _Option('أعمل متوسط للسهم', 7),
      _Option('أشتري المزيد بحماس', 10),
    ]),
    _Question('ما الأصل الذي تفضّل الاستثمار فيه؟', [
      _Option('الذهب والسندات فقط', 1),
      _Option('أسهم EGX الكبرى فقط', 4),
      _Option('أسهم + كريبتو (BTC/ETH)', 7),
      _Option('كريبتو + أسهم صغيرة المعدّل', 10),
    ]),
    _Question('ما أفق استثمارك الزمني؟', [
      _Option('أقل من 3 أشهر', 2),
      _Option('من 3 إلى 12 شهر', 5),
      _Option('من 1 إلى 3 سنوات', 8),
      _Option('أكثر من 3 سنوات', 10),
    ]),
    _Question('كيف تتعامل مع التقلبات اليومية للسوق؟', [
      _Option('تقلقني جداً وأتابعها كل ساعة', 1),
      _Option('أتابعها يومياً بهدوء', 5),
      _Option('أتابعها أسبوعياً', 8),
      _Option('لا أهتم — أثق بخطتي', 10),
    ]),
    _Question('ما نسبة دخلك الموظّف المخصّصة للاستثمار؟', [
      _Option('أقل من 5%', 2),
      _Option('من 5% إلى 15%', 5),
      _Option('من 15% إلى 30%', 8),
      _Option('أكثر من 30%', 10),
    ]),
    _Question('هل لديك صندوق طوارئ منفصل عن الاستثمار؟', [
      _Option('نعم، يكفي 12 شهر+', 10),
      _Option('نعم، يكفي 6 أشهر', 7),
      _Option('نعم، يكفي 3 أشهر', 4),
      _Option('لا، أعتمد على الاستثمار', 1),
    ]),
    _Question('ما رد فعلك لو حققت ربحاً 30% في شهر؟', [
      _Option('أبيع الكل وأضمن الربح', 1),
      _Option('أبيع نصف الكمية', 5),
      _Option('أرفع الهدف وأنتظر', 8),
      _Option('أضاعف الرهان', 10),
    ]),
    _Question('ما مدى معرفتك بالتحليل الفني (SMC / Quant)؟', [
      _Option('لا أعرف شيئاً', 1),
      _Option('أساسيات بسيطة', 4),
      _Option('متوسط — أقرأ الشارت', 7),
      _Option('متقدّم — أحلل بنفسي', 10),
    ]),
    _Question('لو خُيّرت بين عائدين متوقّعين، أيهما تختار؟', [
      _Option('8% سنوياً مضمون', 1),
      _Option('12% سنوياً بتقلب منخفض', 4),
      _Option('20% سنوياً بتقلب متوسط', 7),
      _Option('40% سنوياً بتقلب عالٍ جداً', 10),
    ]),
  ];

  int get _totalScore => _answers.values.fold(0, (a, b) => a + b);
  int get _maxScore => _questions.fold(0, (sum, q) => sum + q.options.map((o) => o.score).reduce((a, b) => a > b ? a : b));
  int get _normalizedScore => (_totalScore / _maxScore * 100).round().clamp(1, 100);

  Future<void> _finish() async {
    final score = _normalizedScore;
    final persona = api.scoreToPersona(score);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt('risk_tolerance_score', score);
    await prefs.setString('active_persona', persona);
    await prefs.setBool('risk_profiler_completed', true);
    setState(() => _completed = true);
  }

  @override
  Widget build(BuildContext context) {
    if (_completed) {
      final score = _normalizedScore;
      final persona = api.scoreToPersona(score);
      final personaInfo = {
        'conservative': {'name': '🛡️ المحافظ', 'color': Colors.blue, 'desc': 'حماية رأس المال أولاً — وقف خسارة ضيق (0.8×ATR) وحد مخاطفة 1%.'},
        'balanced': {'name': '⚖️ المتوازن', 'color': Colors.amber.shade700, 'desc': 'توازن بين العائد والمخاطر — معاملات قياسية (1.0×ATR) وحد مخاطفة 2%.'},
        'gambler': {'name': '🔥 المغامر', 'color': Colors.red, 'desc': 'مخاطر عالية جداً مع وعي — وقف واسع (1.5×ATR) وحد مخاطفة 4.5%.'},
      }[persona]!;
      return Scaffold(
        appBar: AppBar(title: const Text('الشخصية الاستثمارية'), backgroundColor: AppColors.primaryDark, foregroundColor: Colors.white),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.emoji_events, size: 60, color: Colors.amber),
                const SizedBox(height: 16),
                const Text('نتيجة الاستبيان', style: TextStyle(fontSize: 14, color: Colors.grey)),
                const SizedBox(height: 8),
                Text('$score', style: const TextStyle(fontSize: 48, fontWeight: FontWeight.bold, color: AppColors.primary)),
                const Text('من 100', style: TextStyle(fontSize: 12, color: Colors.grey)),
                const SizedBox(height: 24),
                const Text('الشخصية المُستنتَجة', style: TextStyle(fontSize: 12, color: Colors.grey)),
                const SizedBox(height: 8),
                Text(personaInfo['name'] as String, style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: personaInfo['color'] as Color)),
                const SizedBox(height: 12),
                Text(personaInfo['desc'] as String, style: const TextStyle(fontSize: 12, height: 1.5), textAlign: TextAlign.center),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () => Navigator.pop(context),
                    style: ElevatedButton.styleFrom(backgroundColor: AppColors.primary, foregroundColor: Colors.white),
                    child: const Text('تم'),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }
    final q = _questions[_step];
    final progress = (_step / _questions.length);
    return Scaffold(
      appBar: AppBar(
        title: const Text('استبيان تحمّل المخاطر'),
        backgroundColor: AppColors.primaryDark,
        foregroundColor: Colors.white,
      ),
      body: Column(
        children: [
          // Progress
          LinearProgressIndicator(value: progress, backgroundColor: Colors.grey.shade300, color: AppColors.primary, minHeight: 4),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('السؤال ${_step + 1} من ${_questions.length}', style: const TextStyle(fontSize: 11, color: Colors.grey)),
                Text('${(progress * 100).round()}%', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      CircleAvatar(
                        backgroundColor: AppColors.primaryContainer,
                        child: Text('${_step + 1}', style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.primary)),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(q.text, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, height: 1.4)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  ...q.options.asMap().entries.map((entry) {
                    final idx = entry.key;
                    final opt = entry.value;
                    final selected = _answers[_step] == opt.score;
                    return GestureDetector(
                      onTap: () {
                        setState(() => _answers[_step] = opt.score);
                        Future.delayed(const Duration(milliseconds: 200), () {
                          if (_step < _questions.length - 1) {
                            setState(() => _step++);
                          } else {
                            _finish();
                          }
                        });
                      },
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: selected ? AppColors.primary.withValues(alpha: 0.1) : Colors.grey.shade50,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: selected ? AppColors.primary : Colors.grey.shade300, width: selected ? 2 : 1),
                        ),
                        child: Row(
                          children: [
                            Text('${String.fromCharCode(65 + idx)})', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                            const SizedBox(width: 8),
                            Expanded(child: Text(opt.text, style: const TextStyle(fontSize: 13))),
                          ],
                        ),
                      ),
                    );
                  }),
                  const Spacer(),
                  if (_step > 0)
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton.icon(
                        onPressed: () => setState(() => _step--),
                        icon: const Icon(Icons.arrow_forward, size: 16),
                        label: const Text('السابق'),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Question {
  final String text;
  final List<_Option> options;
  const _Question(this.text, this.options);
}

class _Option {
  final String text;
  final int score;
  const _Option(this.text, this.score);
}
