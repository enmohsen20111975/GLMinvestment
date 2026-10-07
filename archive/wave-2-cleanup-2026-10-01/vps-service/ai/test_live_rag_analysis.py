#!/usr/bin/env python3
import sys
from pathlib import Path
import json

_AI_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_AI_DIR))

from decision_engine import DecisionEngine
from glm_finance_agent import GLMFinanceAgent

print("=== Running Live RAG Analysis Test with glm-fast ===")

agent = GLMFinanceAgent()
if not agent.is_available():
    print("❌ Error: Ollama is offline. Make sure the service is running.")
    sys.exit(1)

db_engine = DecisionEngine()
ticker = "CIB"
indicators = agent._fetch_indicators(ticker)

if not indicators:
    print(f"❌ Error: No indicators found for {ticker} in database.")
    # Fallback mock indicators
    indicators = {
        "rsi": 42.0,
        "macd": "-0.15",
        "maestro_score": 68,
        "recommendation": "buy",
        "price": 12.50,
        "volume_ratio": 1.5,
        "pe_ratio": 9.5
    }

print(f"\n1. Found indicators for {ticker}:")
print(json.dumps(indicators, indent=2))

print(f"\n2. Fetching historical stories...")
stories = db_engine.find_similar_stories(
    ticker=ticker,
    current_rsi=indicators.get("rsi", 50.0),
    current_recommendation=indicators.get("recommendation", "buy"),
    limit=3
)
print(f"   Fetched {len(stories)} stories.")

print("\n3. Building Prompt & Querying glm-fast...")
prompt = db_engine.build_rag_prompt(ticker, indicators, stories)

# Query model
start_time = sys.time() if hasattr(sys, 'time') else None
import time
t0 = time.time()
response_raw = agent.call_fast(prompt, max_tokens=500, temperature=0.2)  # QWEN-UNIFY
t1 = time.time()

print(f"\n4. Raw AI Response (took {t1-t0:.1f}s):")
print("-" * 60)
print(response_raw)
print("-" * 60)

print("\n5. Parsing JSON Response...")
parsed = agent._parse_json_response(response_raw)
print(json.dumps(parsed, indent=2, ensure_ascii=False))

print("\n=== Live Test Completed! ===")
