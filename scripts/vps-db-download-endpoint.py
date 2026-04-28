"""
egxpy-bridge - DB Download API Endpoint
Add this to your VPS Python FastAPI/Flask server to serve DB files for Hostinger sync.

This allows Hostinger to download fresh DB files via HTTP instead of SCP.
"""

import os
from flask import Flask, send_file, jsonify

app = Flask(__name__)

# DB directory on VPS
DB_DIR = os.environ.get("DB_DIR", "/root/egxpy-bridge/data")

# Allowed DB files for download (security: no path traversal)
ALLOWED_FILES = {
    "custom": "custom.db",
    "egx_investment": "egx_investment.db",
}


@app.route("/api/download-db", methods=["GET"])
def download_db():
    """Download a DB file from the VPS."""
    file_key = request.args.get("file", "")
    
    if file_key not in ALLOWED_FILES:
        return jsonify({"error": "Invalid file parameter", "allowed": list(ALLOWED_FILES.keys())}), 400
    
    filename = ALLOWED_FILES[file_key]
    filepath = os.path.join(DB_DIR, filename)
    
    if not os.path.exists(filepath):
        return jsonify({"error": f"File {filename} not found on VPS"}), 404
    
    return send_file(
        filepath,
        as_attachment=True,
        download_name=filename,
        mimetype="application/x-sqlite3"
    )


@app.route("/api/db-status", methods=["GET"])
def db_status():
    """Return info about available DB files on the VPS."""
    status = {}
    for key, filename in ALLOWED_FILES.items():
        filepath = os.path.join(DB_DIR, filename)
        if os.path.exists(filepath):
            size_mb = os.path.getsize(filepath) / (1024 * 1024)
            mod_time = os.path.getmtime(filepath)
            from datetime import datetime
            status[key] = {
                "exists": True,
                "size_mb": round(size_mb, 1),
                "last_modified": datetime.fromtimestamp(mod_time).isoformat(),
            }
        else:
            status[key] = {"exists": False}
    
    return jsonify(status)


# --- If using FastAPI instead of Flask ---
"""
from fastapi import FastAPI
from fastapi.responses import FileResponse
import os

app = FastAPI()

DB_DIR = os.environ.get("DB_DIR", "/root/egxpy-bridge/data")
ALLOWED_FILES = {
    "custom": "custom.db",
    "egx_investment": "egx_investment.db",
}

@app.get("/api/download-db")
async def download_db(file: str):
    if file not in ALLOWED_FILES:
        return {"error": "Invalid file"}
    filepath = os.path.join(DB_DIR, ALLOWED_FILES[file])
    if not os.path.exists(filepath):
        return {"error": "File not found"}
    return FileResponse(filepath, filename=ALLOWED_FILES[file])

@app.get("/api/db-status")
async def db_status():
    # ... same logic
    pass
"""
