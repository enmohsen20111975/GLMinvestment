#!/bin/bash
# Audit script: find code references for each empty table
# Searches in src/ vps-service/ scripts/ for SQL keywords referencing each table

SEARCH_DIRS=(/home/z/my-project/src /home/z/my-project/vps-service /home/z/my-project/scripts /home/z/my-project/data_engine)

# Tables to audit (format: db:table)
TABLES=(
  # stocks.db empty tables
  "stocks.db:cached_analysis"
  "stocks.db:conjunction_patterns"
  "stocks.db:context_logs"
  "stocks.db:daily_analytics_summary"
  "stocks.db:egksco_price_history"
  "stocks.db:error_logs"
  "stocks.db:feature_usage"
  "stocks.db:financial_obligations"
  "stocks.db:financial_transactions"
  "stocks.db:indicator_trust_scores"
  "stocks.db:indicator_weights"
  "stocks.db:learned_lessons"
  "stocks.db:maestro_personas"
  "stocks.db:morning_reports"
  "stocks.db:news"
  "stocks.db:news_items"
  "stocks.db:obligation_payments"
  "stocks.db:outcome_logs"
  "stocks.db:page_views"
  "stocks.db:paper_trades"
  "stocks.db:pending_settlements"
  "stocks.db:regime_indicator_weights"
  "stocks.db:scraping_status"
  "stocks.db:stock_adaptive_profiles"
  "stocks.db:stocks_backup"
  "stocks.db:telegram_images"
  "stocks.db:telegram_messages"
  "stocks.db:telegram_recommendations"
  "stocks.db:ticker_performance"
  "stocks.db:tracked_channels"
  "stocks.db:trading_lessons"
  "stocks.db:trading_rules"
  "stocks.db:user_sessions"
  # predictions.db empty tables
  "predictions.db:CachedAnalysis"
  "predictions.db:ExpertTrackRecord"
  "predictions.db:TechnicalIndicator"
  "predictions.db:aiPrediction"
  "predictions.db:analysis_engine_status"
  "predictions.db:analysis_jobs"
  "predictions.db:cached_analysis"
  "predictions.db:hunter_pick_tracking"
  "predictions.db:prediction_lessons"
  "predictions.db:prediction_outcomes"
  "predictions.db:prediction_outcomes_old"
  "predictions.db:reports"
  "predictions.db:sniper_performance"
  "predictions.db:telegram_news"
  "predictions.db:telegram_signals"
  "predictions.db:trade_journal_entries"
  "predictions.db:trade_journal_reflections"
  # auth.db empty tables
  "auth.db:Account"
  "auth.db:ExpertTrackRecord"
  "auth.db:Post"
  "auth.db:Session"
  "auth.db:UserSubscription"
  "auth.db:VerificationToken"
  "auth.db:optimized_parameters"
  "auth.db:platform_recommendations"
  "auth.db:user_trades"
  # data_engine.db empty tables
  "data_engine.db:egksco_stocks"
  "data_engine.db:egx_fundamentals"
  # intraday.db empty tables
  "intraday.db:intraday_prices"
  # news.db empty tables
  "news.db:news_api_keys"
)

OUT=/tmp/audit-table-refs.txt
> "$OUT"

for entry in "${TABLES[@]}"; do
  db="${entry%%:*}"
  tbl="${entry##*:}"
  echo "" >> "$OUT"
  echo "==============================================" >> "$OUT"
  echo "TABLE: $db -> $tbl" >> "$OUT"
  echo "==============================================" >> "$OUT"
  for dir in "${SEARCH_DIRS[@]}"; do
    # Match SQL patterns: FROM table, INTO table, UPDATE table, JOIN table, CREATE TABLE [IF NOT EXISTS] table
    # Use word-boundary-ish patterns; case insensitive
    rg -i -n --no-heading -g '!*.md' -g '!*.json' -g '!*.txt' \
      -e "(\bFROM\b\s+\"?${tbl}\"?[\s,;])" \
      -e "(\bINTO\b\s+\"?${tbl}\"?[\s,(])" \
      -e "(\bUPDATE\b\s+\"?${tbl}\"?\s)" \
      -e "(\bJOIN\b\s+\"?${tbl}\"?)" \
      -e "(\bCREATE\s+TABLE\b(\s+IF\s+NOT\s+EXISTS)?\s+\"?${tbl}\"?)" \
      -e "(\bDROP\s+TABLE\b(\s+IF\s+EXISTS)?\s+\"?${tbl}\"?)" \
      -e "(\bDELETE\s+FROM\b\s+\"?${tbl}\"?)" \
      -e "(\bINSERT\s+OR\s+(REPLACE|IGNORE)\s+INTO\b\s+\"?${tbl}\"?)" \
      -e "(\bALTER\s+TABLE\b\s+\"?${tbl}\"?)" \
      "$dir" 2>/dev/null >> "$OUT"
  done
done

wc -l "$OUT"
echo "DONE. Results in $OUT"
