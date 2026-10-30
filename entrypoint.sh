#!/bin/bash
set -e

DATA_DIR="/data"
DB_FILE="backend/jkn_fraud.db"
MODEL_FILE="backend/ml_models/xgboost_risk.pkl"
VECTOR_DIR="backend/ml_models/vector_index"
UPLOADS_DIR="backend/uploads"

mkdir -p backend/uploads/rs_responses
mkdir -p backend/ml_models/vector_index

persist_file() {
    local src="$1"
    local dest="$DATA_DIR/$(basename "$src")"

    if [ ! -f "$dest" ] && [ -f "$src" ]; then
        echo "[persist] Copying $src → $dest"
        cp "$src" "$dest"
    fi

    if [ -d "$DATA_DIR" ]; then
        rm -f "$src"
        ln -sf "$dest" "$src"
        echo "[persist] Symlinked $src → $dest"
    fi
}

persist_dir() {
    local src="$1"
    local dest="$DATA_DIR/$(basename "$src")"

    if [ ! -d "$dest" ] && [ -d "$src" ]; then
        echo "[persist] Copying directory $src → $dest"
        cp -r "$src" "$dest"
    fi

    if [ -d "$DATA_DIR" ]; then
        rm -rf "$src"
        ln -sf "$dest" "$src"
        echo "[persist] Symlinked $src → $dest"
    fi
}

if [ -d "$DATA_DIR" ]; then
    echo "=== Persistent volume detected at $DATA_DIR ==="
    persist_file "$DB_FILE"
    persist_file "backend/jkn_fraud.db-wal"
    persist_file "backend/jkn_fraud.db-shm"
    persist_file "$MODEL_FILE"
    persist_dir  "$VECTOR_DIR"
    persist_dir  "$UPLOADS_DIR"
else
    echo "=== No persistent volume, using ephemeral storage ==="
fi

# Ingest regulations jika vector store belum tersedia (dijalankan di background agar server web langsung aktif)
if [ ! -f "backend/ml_models/vector_index/chroma.sqlite3" ] && [ ! -f "$DATA_DIR/vector_index/chroma.sqlite3" ]; then
    echo "=== Vector index belum ada, memulai ekstraksi regulasi di background... ==="
    python -m backend.scripts.ingest_regulations > /tmp/ingest.log 2>&1 &
fi

echo "=== Starting KlaimGuard AI ==="
exec uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-8000}"
