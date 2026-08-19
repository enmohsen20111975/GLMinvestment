// ============================================================================
// مساعد الاستثمار Flutter - Academy Screen (P40)
// أكاديمية M2y التعليمية ومحاكي التداول الحي
// 4 تبويبات: الموسوعة | التداول الورقي | محاكي الشموع | مختبر الاستراتيجيات
// ============================================================================

import 'package:flutter/material.dart';
import '../theme/colors.dart';
import 'paper_trading_screen.dart';
import 'candle_simulator_screen.dart';
import 'strategy_sandbox_screen.dart';
import 'academy_encyclopedia_screen.dart';

class AcademyScreen extends StatefulWidget {
  const AcademyScreen({super.key});

  @override
  State<AcademyScreen> createState() => _AcademyScreenState();
}

class _AcademyScreenState extends State<AcademyScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: AppColors.surface,
        appBar: AppBar(
          backgroundColor: AppColors.primaryDark,
          foregroundColor: Colors.white,
          title: const Row(
            children: [
              Icon(Icons.school, color: Colors.white, size: 22),
              SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'أكاديمية M2y التعليمية',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                    Text(
                      'تعلّم، تدرّب، ثم استثمر بثقة',
                      style: TextStyle(fontSize: 11, color: Colors.white70),
                    ),
                  ],
                ),
              ),
            ],
          ),
          bottom: TabBar(
            controller: _tabController,
            indicatorColor: AppColors.accent,
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white60,
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: const [
              Tab(icon: Icon(Icons.menu_book, size: 18), text: 'الموسوعة'),
              Tab(icon: Icon(Icons.show_chart, size: 18), text: 'التداول الورقي'),
              Tab(icon: Icon(Icons.candlestick_chart, size: 18), text: 'محاكي الشموع'),
              Tab(icon: Icon(Icons.science, size: 18), text: 'مختبر الاستراتيجيات'),
            ],
          ),
        ),
        body: TabBarView(
          controller: _tabController,
          children: const [
            AcademyEncyclopediaScreen(),
            PaperTradingScreen(),
            CandleSimulatorScreen(),
            StrategySandboxScreen(),
          ],
        ),
      ),
    );
  }
}
