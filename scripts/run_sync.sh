#!/bin/bash
cd ~/GLMinvestment
source .venv/bin/activate
echo "🔄 Running full sync..."
python3 data_engine/sync.py
echo "✅ Sync complete!"
