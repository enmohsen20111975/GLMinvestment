import type * as React from 'react';
import { formatCurrency, formatNumber } from './helpers';
import type { Position, Transaction, EGXStock } from './types';

/* ============================================================
 * SimulationView — Report Section
 * Hidden DOM tree used by html2pdf for PDF export. Kept out of the
 * main render flow so it does not bloat the visible DOM or the
 * React tree during normal use.
 * ============================================================ */

interface ReportSectionProps {
  marketNameAr: string;
  balance: number;
  portfolioValue: number;
  totalPnL: number;
  tradeCount: number;
  currencyLabel: string;
  positions: Position[];
  transactions: Transaction[];
  stocks: EGXStock[];
}

export function ReportSection({
  marketNameAr,
  balance,
  portfolioValue,
  totalPnL,
  tradeCount,
  currencyLabel,
  positions,
  transactions,
  stocks,
}: ReportSectionProps) {
  return (
    <div className="hidden" dir="rtl" style={{ fontFamily: 'Arial, sans-serif', padding: '20px', color: '#333' }}>
      <div style={{ textAlign: 'center', marginBottom: '30px', borderBottom: '3px solid #10b981', paddingBottom: '15px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1f2937', margin: 0 }}>
          محاكاة التداول الافتراضي — {marketNameAr}
        </h2>
        <p style={{ fontSize: '14px', color: '#666', margin: '5px 0 0' }}>
          تقرير الأداء - تم الإنشاء: {new Date().toLocaleDateString('ar-EG')}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
        <div style={{ background: '#f0fdf4', padding: '12px', borderRadius: '8px' }}>
          <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>الرصيد النقدي</p>
          <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '5px 0 0' }}>{formatCurrency(balance, currencyLabel)}</p>
        </div>
        <div style={{ background: '#eff6ff', padding: '12px', borderRadius: '8px' }}>
          <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>قيمة المحفظة</p>
          <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '5px 0 0' }}>{formatCurrency(portfolioValue, currencyLabel)}</p>
        </div>
        <div style={{ background: totalPnL >= 0 ? '#f0fdf4' : '#fef2f2', padding: '12px', borderRadius: '8px' }}>
          <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>إجمالي الربح/الخسارة</p>
          <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '5px 0 0', color: totalPnL >= 0 ? '#059669' : '#dc2626' }}>
            {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL, currencyLabel)}
          </p>
        </div>
        <div style={{ background: '#fffbeb', padding: '12px', borderRadius: '8px' }}>
          <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>عدد الصفقات</p>
          <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '5px 0 0' }}>{tradeCount}</p>
        </div>
      </div>

      <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px', borderBottom: '1px solid #e5e7eb', paddingBottom: '5px' }}>الأصول المحتفظ بها</h2>
      {positions.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={thStyle}>السهم</th>
              <th style={thStyle}>العدد</th>
              <th style={thStyle}>متوسط التكلفة</th>
              <th style={thStyle}>السعر الحالي</th>
              <th style={thStyle}>الربح/الخسارة</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const stock = stocks.find((s) => s.ticker === pos.ticker);
              if (!stock) return null;
              const pnl = (stock.price - pos.avgCost) * pos.shares;
              return (
                <tr key={pos.ticker}>
                  <td style={tdStyle}>{stock.name_ar}</td>
                  <td style={tdStyle}>{pos.shares}</td>
                  <td style={tdStyle}>{formatNumber(pos.avgCost)}</td>
                  <td style={tdStyle}>{formatNumber(stock.price)}</td>
                  <td style={{ ...tdStyle, color: pnl >= 0 ? '#059669' : '#dc2626' }}>
                    {pnl >= 0 ? '+' : ''}{formatCurrency(pnl, currencyLabel)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p style={{ color: '#999', marginBottom: '20px' }}>لا توجد أصول محتفظ بها</p>
      )}

      <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px', borderBottom: '1px solid #e5e7eb', paddingBottom: '5px' }}>آخر المعاملات</h2>
      {transactions.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={thStyle}>التاريخ</th>
              <th style={thStyle}>النوع</th>
              <th style={thStyle}>السهم</th>
              <th style={thStyle}>العدد</th>
              <th style={thStyle}>السعر</th>
              <th style={thStyle}>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {[...transactions].reverse().slice(0, 20).map((tx) => (
              <tr key={tx.id}>
                <td style={{ ...tdStyle, fontSize: '11px' }}>
                  {new Date(tx.date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td style={{ ...tdStyle, color: tx.type === 'buy' ? '#059669' : '#dc2626' }}>
                  {tx.type === 'buy' ? 'شراء' : 'بيع'}
                </td>
                <td style={tdStyle}>{tx.ticker}</td>
                <td style={tdStyle}>{tx.shares}</td>
                <td style={tdStyle}>{formatNumber(tx.price)}</td>
                <td style={tdStyle}>{formatCurrency(tx.total, currencyLabel)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ color: '#999' }}>لا توجد معاملات بعد</p>
      )}

      <div style={{ marginTop: '30px', textAlign: 'center', fontSize: '12px', color: '#999', borderTop: '1px solid #e5e7eb', paddingTop: '10px' }}>
        هذا التقرير تم إنشاؤه تلقائياً من محاكاة التداول الافتراضي<br />
        جميع الأرقام افتراضية ولا تمثل صفقات حقيقية
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px',
  textAlign: 'right',
  border: '1px solid #e5e7eb',
};

const tdStyle: React.CSSProperties = {
  padding: '8px',
  border: '1px solid #e5e7eb',
};
