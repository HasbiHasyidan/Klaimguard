#!/bin/bash
set -e

DATA_DIR="/data"
DB_FILE="backend/jkn_fraud.db"
MODEL_FILE="backend/ml_models/xgboost_risk.pkl"
VECTOR_DIR="backend/ml_models/vector_index"
UPLOADS_DIR="backend/uploads"

mkdir -p backend/uploads/rs_responses

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
    persist_file "$MODEL_FILE"
    persist_dir  "$VECTOR_DIR"
    persist_dir  "$UPLOADS_DIR"
else
    echo "=== No persistent volume, using ephemeral storage ==="
fi

echo "=== Starting KlaimGuard AI ==="
exec uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-8000}"

