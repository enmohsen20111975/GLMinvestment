/**
 * 😈 تقويم الشيطان (Devil's Calendar)
 *
 * الأحداث الجاية اللي هتحرك السوق:
 * - اجتماعات CBE
 * - مواسم الأرباح
 * - الموسمية (رمضان، يناير، ديسمبر)
 * - أحداث ماكرو عالمية (Fed, ECB)
 */

import type { CalendarEvent, DevilsCalendar } from './types';
import { getSeasonality } from './regime-engine';

// ==================== الأحداث الماكرو المعروفة ====================
// تواريخ تقريبية (CBE بيعلنها قبلها بشهر)

function generateUpcomingEvents(): CalendarEvent[] {
  const now = new Date();
  const events: CalendarEvent[] = [];

  // ============ اجتماعات CBE (كل ~6 أسابيع) ============
  // CBE MPC meetings 2026 (تقريبية)
  const cbeDates = [
    '2026-06-25', '2026-08-06', '2026-09-17', '2026-10-29',
    '2026-12-10', '2027-01-21', '2027-03-04', '2027-04-15',
  ];

  for (const date of cbeDates) {
    const eventDate = new Date(date);
    const daysUntil = Math.ceil((eventDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (daysUntil < -7) continue; // skip past events

    events.push({
      id: `cbe-${date}`,
      date,
      title: `اجتماع البنك المركزي المصري (CBE MPC)`,
      category: 'cbe',
      importance: 'high',
      daysUntil,
      expectedImpact: 'قرار الفائدة — البنوك والديون العالية بتتحرك',
      devilPlay: daysUntil > 0 && daysUntil <= 3
        ? 'قبل CBE بيومين: باع بنوك، اشترِ سندات. لو خفض → اشترِ ESRS و ORWE'
        : 'انتظر — السوق بيتسعر القرار قبل ما يحصل',
      affectedTickers: ['COMI', 'CIEB', 'ETEL', 'TMGH', 'ORAS', 'SWDY', 'ESRS'],
    });
  }

  // ============ مواسم الأرباح ============
  // ربع 1: مارس-أبريل, ربع 2: مايو-يونيو, ربع 3: أغسطس-سبتمبر, ربع 4: نوفمبر-ديسمبر
  const earningsSeasons = [
    { start: '2026-03-01', end: '2026-04-15', quarter: 'Q4 2025 + FY2025' },
    { start: '2026-05-15', end: '2026-06-15', quarter: 'Q1 2026' },
    { start: '2026-08-15', end: '2026-09-15', quarter: 'Q2 2026' },
    { start: '2026-11-15', end: '2026-12-15', quarter: 'Q3 2026' },
  ];

  for (const season of earningsSeasons) {
    const startDate = new Date(season.start);
    const daysUntil = Math.ceil((startDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (daysUntil < -30) continue;

    events.push({
      id: `earnings-${season.start}`,
      date: season.start,
      title: `موسم نتائج ${season.quarter}`,
      category: 'earnings',
      importance: 'medium',
      daysUntil,
      expectedImpact: 'تذبذب عالي — الأسهم بتتحرك حسب النتائج',
      devilPlay: 'اشترِ الأسهم اللي نزلت 15-20% قبل التقرير (قمة التشاؤم). ابتعد عن اللي طالعوا كتير',
      affectedTickers: ['ALL'],
    });
  }

  // ============ الموسمية ============
  const seasonality = getSeasonality(now);
  events.push({
    id: `seasonality-${now.getMonth() + 1}`,
    date: now.toISOString().slice(0, 10),
    title: seasonality.factorName,
    category: 'seasonality',
    importance: seasonality.strength > 0.6 ? 'medium' : 'low',
    daysUntil: 0,
    expectedImpact: seasonality.description,
    devilPlay: seasonality.effect === 'caution'
      ? '⚠️ احذر — الحركات ممكن تكون مش حقيقية'
      : seasonality.effect === 'positive'
      ? '🟢 الموسمية في صفك'
      : seasonality.effect === 'negative'
      ? '🔴 الموسمية ضدك — قلل المخاطرة'
      : '⚪ موسمية محايدة',
    affectedTickers: ['ALL'],
  });

  // ============ أحداث Fed (كل 6 أسابيع تقريباً) ============
  const fedDates = [
    '2026-07-29', '2026-09-16', '2026-11-04', '2026-12-16',
  ];
  for (const date of fedDates) {
    const eventDate = new Date(date);
    const daysUntil = Math.ceil((eventDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (daysUntil < -7) continue;

    events.push({
      id: `fed-${date}`,
      date,
      title: 'اجتماع الفيدرالي الأمريكي (FOMC)',
      category: 'macro',
      importance: 'medium',
      daysUntil,
      expectedImpact: 'تأثير على الدولار والأسواق الناشئة',
      devilPlay: 'لو Fed خفض → الدولار ينزل → EGX بيستفيد. لو رفع → العكس',
      affectedTickers: ['COMI', 'ETEL', 'SWDY', 'ESRS'],
    });
  }

  // ترتيب حسب الأقرب
  events.sort((a, b) => a.daysUntil - b.daysUntil);

  return events;
}

// ==================== التقويم الكامل ====================

export function getDevilsCalendar(): DevilsCalendar {
  const events = generateUpcomingEvents();

  const upcomingWeek = events.filter(e => e.daysUntil >= 0 && e.daysUntil <= 7);
  const upcomingMonth = events.filter(e => e.daysUntil >= 0 && e.daysUntil <= 30);

  // اللعب المقترح
  const proposedPlays: string[] = [];

  const cbeEvent = upcomingMonth.find(e => e.category === 'cbe');
  if (cbeEvent) {
    proposedPlays.push(`📅 قبل CBE (${cbeEvent.daysUntil} يوم): باع بنوك، اشترِ سندات. لو خفض → ESRS و ORWE`);
  }

  const earningsEvent = upcomingMonth.find(e => e.category === 'earnings');
  if (earningsEvent) {
    proposedPlays.push(`📊 في موسم الأرباح: اشترِ اللي نزل 20% قبل التقرير (قمة التشاؤم). ابتعد عن اللي طالعوا كتير`);
  }

  const seasonality = getSeasonality();
  if (seasonality.effect === 'caution') {
    proposedPlays.push(`⚠️ ${seasonality.factorName}: ${seasonality.description}. قلل المخاطرة`);
  } else if (seasonality.effect === 'positive') {
    proposedPlays.push(`🟢 ${seasonality.factorName}: ${seasonality.description}. الموسمية معاك`);
  }

  if (proposedPlays.length === 0) {
    proposedPlays.push('⚪ مفيش أحداث كبيرة قريبة — السوق عرضي. العب بحذر');
  }

  return {
    events,
    upcomingWeek,
    upcomingMonth,
    proposedPlays,
  };
}

// ==================== الأحداث القادمة لسهم معين ====================

export function getUpcomingEventsForTicker(ticker: string): CalendarEvent[] {
  const calendar = getDevilsCalendar();
  return calendar.events.filter(e => e.affectedTickers.includes(ticker) || e.affectedTickers.includes('ALL'));
}
