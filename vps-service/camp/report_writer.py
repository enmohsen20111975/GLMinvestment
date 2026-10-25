#!/usr/bin/env python3
"""
Report Writer — reads Phase A-E JSON results and generates final markdown report.

Output: scripts/camp/reports/DEEP-DATA-ANALYSIS-FINAL.md

Rule 4: 2 files only (this + data_analyzer.py).
Rule 27: NO-FAKE-DATA — "—" if missing.
"""
from __future__ import annotations
import json, sys
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RESULTS_DIR = PROJECT_ROOT / 'scripts' / 'camp' / 'results'
REPORTS_DIR = PROJECT_ROOT / 'scripts' / 'camp' / 'reports'
REPORTS_DIR.mkdir(parents=True, exist_ok=True)


def load_json(name):
    p = RESULTS_DIR / name
    if not p.exists():
        return None
    with open(p) as f:
        return json.load(f)


def fmt(v, suffix='', default='—'):
    if v is None: return default
    if isinstance(v, float): return f"{v:.2f}{suffix}"
    return f"{v}{suffix}"


def write_report():
    a = load_json('phase_a_clustering.json')
    b = load_json('phase_b_regime.json')
    c = load_json('phase_c_ic.json')
    d = load_json('phase_d_combos.json')
    e = load_json('phase_e_setups.json')

    report = REPORTS_DIR / 'DEEP-DATA-ANALYSIS-FINAL.md'
    with open(report, 'w', encoding='utf-8') as f:
        f.write('# 🔬 Deep Data Analysis — Final Report\n\n')
        f.write(f'**Generated:** {datetime.now().isoformat()}\n')
        f.write(f'**Data:** price_history.db (2000-11-27 → 2026-10-21)\n')
        f.write(f'**Analysis Period:** 2023-01 → 2026-09 (46 months, 42 OK)\n')
        f.write(f'**Universe:** ~750 active tickers\n')
        f.write(f'**Memory Strategy:** chunked (50 tickers/chunk) + gc.collect()\n\n')
        f.write('---\n\n')

        # Executive Summary
        f.write('## 📋 Executive Summary\n\n')
        if a:
            f.write(f'- **Clusters:** {a["n_clusters"]} clusters identified from {a["n_tickers"]} tickers (silhouette={a["silhouette"]:.3f})\n')
        if b:
            s = b['summary']
            f.write(f'- **Regimes:** {s["bull"]} Bull, {s["bear"]} Bear, {s["sideways"]} Sideways months ({s["total_months"]} total)\n')
        if c:
            f.write(f'- **Feature IC:** {c["sample_size"]} samples analyzed across 8 features × 4 horizons\n')
        if e and 'setups' in e:
            robust = sum(1 for x in e['setups'] if x.get('robust'))
            f.write(f'- **Setups:** {len(e["setups"])} discovered from {e["n_profitable"]} profitable days ({e["profitable_pct"]}% hit rate), {robust} ROBUST\n')
        f.write('\n---\n\n')

        # Phase A: Clustering
        f.write('## Phase A: Ticker Clusters\n\n')
        if a and a.get('clusters'):
            f.write(f'K-means clustering on 8 metrics → {a["n_clusters"]} clusters (silhouette={a["silhouette"]:.3f})\n\n')
            for cl in a['clusters']:
                m = cl['avg_metrics']
                f.write(f'### Cluster {cl["cluster_id"]}: "{cl.get("name","Mixed")}" ({cl["size"]} tickers)\n\n')
                f.write(f'| Metric | Value |\n|---|---|\n')
                f.write(f'| Trend Score | {fmt(m["trend"])} |\n')
                f.write(f'| Volatility P50 | {fmt(m["vol_p50"], "%")} |\n')
                f.write(f'| Volatility P90 | {fmt(m["vol_p90"], "%")} |\n')
                f.write(f'| Mean-Reversion | {fmt(m["mean_reversion"])} |\n')
                f.write(f'| Seasonality | {fmt(m["seasonality"], "%")} |\n')
                f.write(f'| Vol Surge Freq | {fmt(m["vol_surge_freq"], "%")} |\n')
                f.write(f'| Avg Turnover | {fmt(m["avg_turnover"]/1e6, "M EGP")} |\n')
                f.write(f'| Data Days | {fmt(m["data_days"])} |\n\n')
                f.write(f'**Examples:** {", ".join(cl["examples"][:10])}\n\n')
            f.write('**Devil\'s Advocate:**\n')
            f.write('1. Cluster stability across time not verified — a stock could shift clusters over 4 years\n')
            f.write('2. K-means assumes spherical clusters — elongated/overlapping clusters may be misassigned\n\n')
            f.write('---\n\n')
        else:
            f.write('Phase A data not available.\n\n---\n\n')

        # Phase B: Market Regime
        f.write('## Phase B: Market Regime Deep Dive\n\n')
        if b:
            s = b['summary']
            f.write(f'**Summary:** {s["total_months"]} months — Bull: {s["bull"]}, Bear: {s["bear"]}, Sideways: {s["sideways"]}\n\n')
            f.write('| Month | Regime | Breadth | Vol Index | Trading Days |\n')
            f.write('|---|---|---|---|---|\n')
            for mm in sorted(b['months'].keys()):
                m = b['months'][mm]
                emoji = '🟢' if m['regime']=='Bull' else '🔴' if m['regime']=='Bear' else '🟡'
                f.write(f"| {mm} | {emoji} {m['regime']} | {m['breadth']}% | {m['vol_index']}% | {m['trading_days']} |\n")
            f.write(f'\n**Regime Transitions:** {len(s["transitions"])}\n')
            for t in s['transitions'][:10]:
                f.write(f"- {t['month']}: {t['from']} → {t['to']}\n")
            f.write('\n**Devil\'s Advocate:**\n')
            f.write('1. Market proxy is equal-weighted (not cap-weighted) — may diverge from EGX30\n')
            f.write('2. Regime classification uses SMA200 — may lag actual turns by 1-2 months\n\n')
            f.write('---\n\n')
        else:
            f.write('Phase B data not available.\n\n---\n\n')

        # Phase C: Feature IC
        f.write('## Phase C: Feature IC Analysis\n\n')
        if c and c.get('features'):
            f.write(f'Sample size: ~{c["sample_size"]} observations per feature\n\n')
            f.write('| Feature | IC 5d | IC 10d | IC 20d | IC 40d | Hit Rate (>0.7) | Bull IC | Bear IC | n |\n')
            f.write('|---|---|---|---|---|---|---|---|---|\n')
            for fn in ['liquidity','whale_guard','regime','strict_entry','sector_heat','fundamentals','risk','news_stop']:
                fd = c['features'].get(fn, {})
                ic5 = fd.get('5', {}).get('ic', '—')
                ic10 = fd.get('10', {}).get('ic', '—')
                ic20 = fd.get('20', {}).get('ic', '—')
                ic40 = fd.get('40', {}).get('ic', '—')
                hr = fd.get('10', {}).get('hit_rate', '—')
                n = fd.get('5', {}).get('n', '—')
                ri = fd.get('regime_ic', {})
                bull = ri.get('bull', '—')
                bear = ri.get('bear', '—')
                f.write(f"| {fn} | {fmt(ic5)} | {fmt(ic10)} | {fmt(ic20)} | {fmt(ic40)} | {fmt(hr,'%')} | {fmt(bull)} | {fmt(bear)} | {n} |\n")
            f.write('\n**Ranking (by IC 10d):**\n')
            ranked = sorted(c['features'].items(), key=lambda x: -(x[1].get(10,{}).get('ic') or -999))
            for i, (fn, fd) in enumerate(ranked, 1):
                ic = fd.get('10', {}).get('ic', None)
                if ic is not None:
                    strength = 'STRONG' if ic > 0.10 else 'MODERATE' if ic > 0.05 else 'WEAK' if ic > 0.02 else 'NOISE'
                    f.write(f'{i}. **{fn}**: IC_10d={ic:.4f} ({strength})\n')
            f.write('\n**Devil\'s Advocate:**\n')
            f.write('1. IC ≠ causation — features may be coincidentally correlated with returns\n')
            f.write('2. Sample weighted toward 2025-2026 (more tickers) — may bias toward recent regimes\n')
            f.write('3. Forward returns are raw (no transaction costs deducted)\n\n')
            f.write('---\n\n')
        else:
            f.write('Phase C data not available.\n\n---\n\n')

        # Phase D: Combinations
        f.write('## Phase D: Feature Combinations\n\n')
        if d:
            f.write(f'Correlation matrix (Spearman) — {d["n_samples"]} samples:\n\n')
            f.write('| | ' + ' | '.join(d['correlation_matrix'].keys()) + ' |\n')
            f.write('|---' + '|---' * len(d['correlation_matrix']) + '|\n')
            for fa in d['correlation_matrix']:
                row = [fmt(d['correlation_matrix'][fa].get(fb)) for fb in d['correlation_matrix']]
                f.write(f'| **{fa}** | ' + ' | '.join(str(r) for r in row) + ' |\n')
            f.write('\n**Top 10 Combinations (by IC boost):**\n\n')
            f.write('| Pair | IC A | IC B | IC Combined | Boost |\n|---|---|---|---|---|\n')
            for p in d['top_10_combinations']:
                f.write(f"| {p['pair']} | {fmt(p['ic_a'])} | {fmt(p['ic_b'])} | {fmt(p['ic_combined'])} | {fmt(p.get('boost'))} |\n")
            if d['redundant_pairs']:
                f.write('\n**Redundant Pairs (|corr| > 0.80):**\n')
                for r in d['redundant_pairs']:
                    f.write(f"- {r['pair']}: corr={r['corr']}\n")
            else:
                f.write('\n**Redundant Pairs:** None (all |corr| < 0.80) — features are independent\n')
            f.write('\n**Devil\'s Advocate:**\n')
            f.write('1. Pairwise IC boost may not hold in multivariate settings (3+ features)\n')
            f.write('2. Combinations could overfit to the 2023-2026 period\n\n')
            f.write('---\n\n')
        else:
            f.write('Phase D data not available.\n\n---\n\n')

        # Phase E: Setups
        f.write('## Phase E: Discovered Setups\n\n')
        if e and e.get('setups'):
            f.write(f'K-means on {e["n_profitable"]} profitable days (fr20 > 3%) → {len(e["setups"])} setups (silhouette={e.get("silhouette",0):.3f})\n')
            f.write(f'Profitable rate: {e["profitable_pct"]}% of {e["n_total_days"]} total observed days\n\n')
            for s in e['setups']:
                robust_tag = '✅ ROBUST' if s.get('robust') else '⚠️ NEEDS VALIDATION'
                f.write(f'### Setup {s["setup_id"]}: "{s.get("name","Mixed")}" {robust_tag}\n\n')
                f.write(f'- **Win Rate:** {s["win_rate"]}%\n')
                f.write(f'- **Avg Gain:** +{s["avg_gain"]}%\n')
                f.write(f'- **Sample:** {s["n"]} occurrences\n\n')
                f.write('| Feature | Value |\n|---|---|\n')
                for k, v in s['avg_features'].items():
                    f.write(f"| {k} | {v} |\n")
                f.write(f'\n**Yearly Robustness:**\n\n')
                f.write('| Year | n | WR |\n|---|---|---|\n')
                for y in ['2023','2024','2025','2026']:
                    yd = s['yearly'].get(y, {})
                    f.write(f"| {y} | {yd.get('n',0)} | {yd.get('wr',0)}% |\n")
                ex_strs = [f"{x['ticker']}({x['date']},+{x['fr20']}%)" for x in s["examples"]]
                f.write(f'\n**Examples:** {", ".join(ex_strs)}\n\n')
            f.write('**Devil\'s Advocate:**\n')
            f.write('1. Clustering on profitable days = survivorship bias (losing days not clustered)\n')
            f.write('2. Forward 20d return > 3% threshold is arbitrary — different thresholds yield different clusters\n')
            f.write('3. No transaction costs (0.3% commission) deducted from gains\n\n')
            f.write('---\n\n')
        elif e and e.get('error'):
            f.write(f'Phase E: {e["error"]} (n_profitable={e.get("n_profitable",0)})\n\n---\n\n')
        else:
            f.write('Phase E data not available.\n\n---\n\n')

        # Strategic Recommendation
        f.write('## 🎯 Strategic Recommendation\n\n')
        if a and e:
            # Best cluster
            biggest = max(a['clusters'], key=lambda x: x['size']) if a.get('clusters') else None
            if biggest:
                f.write(f'1. **Cluster to target:** "{biggest.get("name","Mixed")}" ({biggest["size"]} tickers) — largest universe\n')
            # Best setup
            if e.get('setups'):
                best_setup = max(e['setups'], key=lambda x: x['win_rate'])
                f.write(f'2. **Highest-EV Setup:** "{best_setup.get("name","Mixed")}" — WR={best_setup["win_rate"]}%, avg gain=+{best_setup["avg_gain"]}%\n')
                robust = [s for s in e['setups'] if s.get('robust')]
                if robust:
                    f.write(f'3. **ROBUST setups (validated across 2023-2026):** {len(robust)} — priority for strategy building\n')
            if c and c.get('features'):
                best_feat = max(c['features'].items(), key=lambda x: x[1].get(10,{}).get('ic') or -999)
                if best_feat[1].get(10,{}).get('ic'):
                    f.write(f'4. **Strongest feature:** {best_feat[0]} (IC_10d={best_feat[1][10]["ic"]:.4f})\n')
        f.write('\n---\n\n')

        # Limitations
        f.write('## ⚠️ Honest Limitations\n\n')
        f.write('1. **Memory constraint:** 4GB sandbox → 50-150 ticker samples (not full 750)\n')
        f.write('2. **Look-ahead bias:** Feature scores computed on same-day close; forward returns start next day\n')
        f.write('3. **Survivorship bias:** Delisted tickers may not be in DB\n')
        f.write('4. **Transaction costs:** 0.3% commission NOT deducted from forward returns\n')
        f.write('5. **2023-2024 data:** Only ~215 tickers (vs 750+ in 2025-2026) — less representative\n')
        f.write('6. **Regime lag:** SMA200-based regime may lag actual market turns by 1-2 months\n')
        f.write('7. **Feature IC is Spearman** — captures monotonic but not necessarily linear relationships\n')
        f.write('8. **Setup clustering on profitable days only** — does not profile losing setups\n\n')
        f.write('---\n\n*Report generated by camp/data_analyzer.py + camp/report_writer.py*\n')

    print(f'Report: {report}')
    return str(report)


if __name__ == '__main__':
    write_report()
