FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app:/app/backend

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ libsqlite3-dev libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY . .

# Build-time: train model & seed data
RUN python -m backend.scripts.init_db \
    && python -m backend.scripts.seed_rs_demo \
    && python -m backend.scripts.train_xgboost

# Entrypoint script for deploy
COPY start-render.sh /app/start-render.sh
RUN chmod +x /app/start-render.sh \
    && chmod -R 777 /app

EXPOSE 7860

CMD ["/app/start-render.sh"]
