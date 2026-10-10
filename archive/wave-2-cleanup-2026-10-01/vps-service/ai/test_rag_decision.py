#!/usr/bin/env python3
import sys
from pathlib import Path
import json

_AI_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_AI_DIR))

from decision_engine import DecisionEngine
from glm_finance_agent import GLMFinanceAgent

print("=== Testing RAG Decision Prompt Builder ===")

db_engine = DecisionEngine()
agent = GLMFinanceAgent()

ticker = "CIB"
# Mock indicators
indicators = {
    "rsi": 42.5,
    "macd": "MACD Negative but showing divergence",
    "maestro_score": 68,
    "recommendation": "buy",
    "price": 12.50,
    "volume_ratio": 1.4,
    "pe_ratio": 9.8
}

print(f"\n1. Fetching similar stories for {ticker} (RSI={indicators['rsi']})...")
stories = db_engine.find_similar_stories(
    ticker=ticker,
    current_rsi=indicators["rsi"],
    current_recommendation=indicators["recommendation"],
    limit=3
)

print(f"   Found {len(stories)} stories.")
for idx, s in enumerate(stories, 1):
    print(f"   Story {idx} ({s['pattern_type']}) on {s['date']}: {s['text'][:120]}...")

print("\n2. Building RAG Prompt...")
prompt = db_engine.build_rag_prompt(ticker, indicators, stories)
print("Prompt:")
print("-" * 60)
print(prompt)
print("-" * 60)
