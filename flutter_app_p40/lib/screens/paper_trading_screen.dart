// ============================================================================
// مساعد الاستثمار Flutter - Paper Trading Screen (P40 Pillar 1)
// محطة التداول الورقي الحي بالأسعار الحقيقية
// API: /api/paper-trading-v2/*
// ============================================================================

import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/colors.dart';
import '../api/client.dart';

class PaperTradingScreen extends StatefulWidget {
  const PaperTradingScreen({super.key});

  @override
  State<PaperTradingScreen> createState() => _PaperTradingScreenState();
}

class _PaperTradingScreenState extends State<PaperTradingScreen> {
  Map<String, dynamic> _account = {};
  List<Map<String, dynamic>> _positions = [];
  List<Map<String, dynamic>> _closedOrders = [];
  bool _loading = true;
  bool _placing = false;
  Timer? _pollTimer;

  // Order form state
  final _tickerCtrl = TextEditingController();
  final _sharesCtrl = TextEditingController(text: '100');
  final _entryCtrl = TextEditingController();
  final _stopCtrl = TextEditingController();
  final _targetCtrl = TextEditingController();
  String _assetType = 'stock';
  String _orderType = 'BUY';
  double _livePrice = 0;

  @override
  void initState() {
    super.initState();
    _loadData();
    _pollTimer = Timer.periodic(const Duration(seconds: 10), (_) => _refreshPositions());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _tickerCtrl.dispose();
    _sharesCtrl.dispose();
    _entryCtrl.dispose();
    _stopCtrl.dispose();
    _targetCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() => _loading = true);
    await Future.wait([
      _refreshPositions(),
      _loadClosedOrders(),
    ]);
    setState(() => _loading = false);
  }

  Future<void> _refreshPositions() async {
    final data = await api.getPaperPositions();
    final autoClosed = (data['autoClosed'] as List?) ?? [];
    if (autoClosed.isNotEmpty && mounted) {
      for (final ac in autoClosed) {
        final order = ac['order'] as Map<String, dynamic>?;
        final reason = ac['reason'] as String? ?? 'MANUAL';
        final pnl = (order?['pnl'] as num?)?.toDouble() ?? 0;
        final ticker = order?['ticker'] as String? ?? '';
        final emoji = reason == 'STOP_LOSS' ? '🔒' : '🎯';
        final msg = pnl >= 0
            ? '$emoji تم تحقيق الهدف لـ $ticker — ربح ${pnl.toStringAsFixed(2)} ج.م'
            : '$emoji تم تفعيل وقف الخسارة لـ $ticker — خسارة ${pnl.abs().toStringAsFixed(2)} ج.م';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), duration: const Duration(seconds: 4)),
        );
      }
    }
    setState(() {
      _account = data['account'] as Map<String, dynamic>? ?? {};
      _positions = (data['positions'] as List?)
              ?.map((e) => e as Map<String, dynamic>)
              .toList() ??
          [];
      final livePrices = data['livePrices'] as Map<String, dynamic>? ?? {};
      if (_tickerCtrl.text.isNotEmpty) {
        final t = _tickerCtrl.text.toUpperCase();
        _livePrice = (livePrices[t] as num?)?.toDouble() ?? _livePrice;
      }
    });
  }

  Future<void> _loadClosedOrders() async {
    final orders = await api.getPaperOrders(status: 'closed');
    setState(() => _closedOrders = orders);
  }

  Future<void> _fetchLivePrice() async {
    final ticker = _tickerCtrl.text.trim().toUpperCase();
    if (ticker.isEmpty) return;
    try {
      final response = await api.dio.get('/api/stocks/$ticker');
      final data = response.data as Map<String, dynamic>;
      final stock = data['stock'] ?? data;
      final price = (stock['current_price'] as num?)?.toDouble() ??
          (stock['last_price'] as num?)?.toDouble() ??
          (stock['close'] as num?)?.toDouble();
      if (price != null && price > 0) {
        setState(() {
          _livePrice = price;
          if (_entryCtrl.text.isEmpty) _entryCtrl.text = price.toStringAsFixed(2);
        });
      }
    } catch (_) {/* silent */}
  }

  Future<void> _placeOrder() async {
    final ticker = _tickerCtrl.text.trim().toUpperCase();
    final shares = double.tryParse(_sharesCtrl.text) ?? 0;
    final entry = double.tryParse(_entryCtrl.text) ?? 0;
    if (ticker.isEmpty || shares <= 0 || entry <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('أدخل الكود والكمية والسعر')),
      );
      return;
    }
    setState(() => _placing = true);
    try {
      await api.placePaperOrder(
        ticker: ticker,
        assetType: _assetType,
        orderType: _orderType,
        shares: shares,
        entryPrice: entry,
        stopLoss: double.tryParse(_stopCtrl.text),
        takeProfit: double.tryParse(_targetCtrl.text),
      );
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تم تنفيذ أمر $_orderType على $ticker')),
      );
      _tickerCtrl.clear();
      _entryCtrl.clear();
      _stopCtrl.clear();
      _targetCtrl.clear();
      _livePrice = 0;
      await _refreshPositions();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
      );
    } finally {
      setState(() => _placing = false);
    }
  }

  Future<void> _closeOrder(Map<String, dynamic> order) async {
    final orderId = order['id'] as int;
    final currentPrice = (order['current_price'] as num?)?.toDouble() ??
        (order['entry_price'] as num?)?.toDouble() ??
        0;
    final ticker = order['ticker'] as String? ?? '';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('تأكيد إغلاق الصفقة'),
        content: Text('إغلاق صفقة $ticker بسعر ${currentPrice.toStringAsFixed(2)}؟'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('إلغاء')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('إغلاق')),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final result = await api.closePaperOrder(
        orderId: orderId,
        currentPrice: currentPrice,
      );
      final message = result['message'] as String? ?? 'تم الإغلاق';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      await _refreshPositions();
      await _loadClosedOrders();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
      );
    }
  }

  Future<void> _resetAccount() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('تصفير الحساب'),
        content: const Text('سيتم إلغاء جميع الصفقات المفتوحة وإعادة الرصيد إلى 100,000 ج.م. متابعة؟'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('إلغاء')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('تصفير'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await api.resetPaperAccount();
    await _refreshPositions();
    await _loadClosedOrders();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تصفير الحساب — رصيد جديد: 100,000 ج.م')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: AppColors.primary));
    }
    final balance = (_account['virtual_balance'] as num?)?.toDouble() ?? 100000;
    final equity = (_account['total_equity'] as num?)?.toDouble() ?? 100000;
    final pnl = (_account['total_pnl'] as num?)?.toDouble() ?? 0;
    final winRate = (_account['win_rate'] as num?)?.toDouble() ?? 0;
    final trades = _account['total_trades'] as int? ?? 0;

    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // Account header
          _buildAccountHeader(balance, equity, pnl, winRate, trades),
          const SizedBox(height: 12),
          // Order form
          _buildOrderForm(),
          const SizedBox(height: 12),
          // Open positions
          _buildSectionHeader('المراكز المفتوحة', _positions.length),
          const SizedBox(height: 6),
          ..._positions.map(_buildPositionCard),
          const SizedBox(height: 12),
          // Closed orders
          _buildSectionHeader('سجل الصفقات المغلقة', _closedOrders.length),
          const SizedBox(height: 6),
          ..._closedOrders.take(20).map(_buildClosedOrderCard),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildAccountHeader(double balance, double equity, double pnl, double winRate, int trades) {
    final pnlColor = pnl >= 0 ? Colors.green : Colors.red;
    return Card(
      color: AppColors.primaryDark,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.account_balance_wallet, color: Colors.white, size: 20),
                const SizedBox(width: 8),
                const Text('الحساب الورقي', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                const Spacer(),
                TextButton.icon(
                  onPressed: _resetAccount,
                  icon: const Icon(Icons.refresh, color: Colors.white70, size: 16),
                  label: const Text('تصفير', style: TextStyle(color: Colors.white70, fontSize: 12)),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(child: _buildStat('الرصيد', '${balance.toStringAsFixed(0)} ج.م', Colors.white)),
                Expanded(child: _buildStat('صافي القيمة', '${equity.toStringAsFixed(0)} ج.م', Colors.white)),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(child: _buildStat('الربح/الخسارة', '${pnl >= 0 ? '+' : ''}${pnl.toStringAsFixed(0)} ج.م', pnlColor)),
                Expanded(child: _buildStat('نسبة النجاح', '${winRate.toStringAsFixed(1)}%', Colors.white)),
                Expanded(child: _buildStat('الصفقات', '$trades', Colors.white)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStat(String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: Colors.white54, fontSize: 10)),
        const SizedBox(height: 2),
        Text(value, style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.bold)),
      ],
    );
  }

  Widget _buildOrderForm() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('تنفيذ أمر جديد', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            const SizedBox(height: 10),
            // Asset type selector
            Row(
              children: [
                _buildAssetChip('أسهم', 'stock'),
                const SizedBox(width: 6),
                _buildAssetChip('كريبتو', 'crypto'),
                const SizedBox(width: 6),
                _buildAssetChip('ذهب', 'gold'),
              ],
            ),
            const SizedBox(height: 8),
            // Ticker + live price
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: TextField(
                    controller: _tickerCtrl,
                    decoration: const InputDecoration(
                      labelText: 'كود السهم',
                      hintText: 'COMI',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    textCapitalization: TextCapitalization.characters,
                    onChanged: (_) => _fetchLivePrice(),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                    decoration: BoxDecoration(
                      color: _livePrice > 0 ? Colors.green.withValues(alpha: 0.1) : Colors.grey.shade100,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.grey.shade300),
                    ),
                    child: Text(
                      _livePrice > 0 ? 'سعر السوق: ${_livePrice.toStringAsFixed(2)}' : 'سعر السوق: —',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: _livePrice > 0 ? Colors.green : Colors.grey),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            // Shares + entry
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _sharesCtrl,
                    decoration: const InputDecoration(labelText: 'الكمية', isDense: true, border: OutlineInputBorder()),
                    keyboardType: TextInputType.number,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _entryCtrl,
                    decoration: const InputDecoration(labelText: 'سعر التنفيذ', isDense: true, border: OutlineInputBorder()),
                    keyboardType: TextInputType.number,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            // SL + TP
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _stopCtrl,
                    decoration: const InputDecoration(labelText: 'وقف الخسارة', isDense: true, border: OutlineInputBorder()),
                    keyboardType: TextInputType.number,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _targetCtrl,
                    decoration: const InputDecoration(labelText: 'جني الأرباح', isDense: true, border: OutlineInputBorder()),
                    keyboardType: TextInputType.number,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            // BUY / SELL toggle
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: _orderType == 'BUY' ? null : () => setState(() => _orderType = 'BUY'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green,
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: Colors.green,
                    ),
                    child: const Text('شراء'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _orderType == 'SELL' ? null : () => setState(() => _orderType = 'SELL'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.red,
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: Colors.red,
                    ),
                    child: const Text('بيع'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _placing ? null : _placeOrder,
                icon: _placing
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.flash_on, size: 18),
                label: Text(_placing ? 'جاري التنفيذ...' : 'تنفيذ الأمر'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: _orderType == 'BUY' ? Colors.green : Colors.red,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAssetChip(String label, String value) {
    final selected = _assetType == value;
    return GestureDetector(
      onTap: () => setState(() => _assetType = value),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : Colors.grey.shade100,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(label, style: TextStyle(color: selected ? Colors.white : Colors.black54, fontSize: 12, fontWeight: FontWeight.bold)),
      ),
    );
  }

  Widget _buildSectionHeader(String title, int count) {
    return Row(
      children: [
        Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
        const SizedBox(width: 6),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(color: AppColors.primaryContainer, borderRadius: BorderRadius.circular(10)),
          child: Text('$count', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
        ),
      ],
    );
  }

  Widget _buildPositionCard(Map<String, dynamic> p) {
    final ticker = p['ticker'] as String? ?? '';
    final orderType = p['order_type'] as String? ?? 'BUY';
    final shares = (p['shares'] as num?)?.toDouble() ?? 0;
    final entry = (p['entry_price'] as num?)?.toDouble() ?? 0;
    final current = (p['current_price'] as num?)?.toDouble() ?? entry;
    final pnl = (p['unrealized_pnl'] as num?)?.toDouble() ?? 0;
    final pnlPct = (p['unrealized_pnl_pct'] as num?)?.toDouble() ?? 0;
    final pnlColor = pnl >= 0 ? Colors.green : Colors.red;
    final typeColor = orderType == 'BUY' ? Colors.green : Colors.red;

    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(color: typeColor.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(6)),
              child: Text(orderType, style: TextStyle(color: typeColor, fontSize: 10, fontWeight: FontWeight.bold)),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(ticker, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                  Text('$shares @ ${entry.toStringAsFixed(2)} → ${current.toStringAsFixed(2)}', style: const TextStyle(fontSize: 10, color: Colors.grey)),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('${pnl >= 0 ? '+' : ''}${pnl.toStringAsFixed(0)} ج.م', style: TextStyle(color: pnlColor, fontWeight: FontWeight.bold, fontSize: 12)),
                Text('${pnlPct >= 0 ? '+' : ''}${pnlPct.toStringAsFixed(1)}%', style: TextStyle(color: pnlColor, fontSize: 10)),
              ],
            ),
            const SizedBox(width: 4),
            IconButton(
              icon: const Icon(Icons.close, color: Colors.red, size: 18),
              onPressed: () => _closeOrder(p),
              tooltip: 'إغلاق',
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildClosedOrderCard(Map<String, dynamic> p) {
    final ticker = p['ticker'] as String? ?? '';
    final orderType = p['order_type'] as String? ?? 'BUY';
    final pnl = (p['pnl'] as num?)?.toDouble() ?? 0;
    final reason = p['close_reason'] as String? ?? 'MANUAL';
    final pnlColor = pnl >= 0 ? Colors.green : Colors.red;
    final reasonLabel = {'MANUAL': 'يدوي', 'STOP_LOSS': 'وقف', 'TAKE_PROFIT': 'هدف'}[reason] ?? reason;

    return Card(
      margin: const EdgeInsets.only(bottom: 4),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Row(
          children: [
            Text(ticker, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
            const SizedBox(width: 6),
            Text(orderType, style: TextStyle(fontSize: 10, color: orderType == 'BUY' ? Colors.green : Colors.red)),
            const Spacer(),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: Colors.grey.shade200, borderRadius: BorderRadius.circular(4)),
              child: Text(reasonLabel, style: const TextStyle(fontSize: 9)),
            ),
            const SizedBox(width: 8),
            Text('${pnl >= 0 ? '+' : ''}${pnl.toStringAsFixed(0)}', style: TextStyle(color: pnlColor, fontWeight: FontWeight.bold, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}
