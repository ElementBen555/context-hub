#!/usr/bin/env bash
# 启动本地 embedding 服务（后台，日志在 embed.log，PID 在 embed.pid）
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-11434}"
MODEL="${EMBED_MODEL:-Xenova/bge-small-zh-v1.5}"
if [ -f embed.pid ] && kill -0 "$(cat embed.pid)" 2>/dev/null; then
  echo "已在运行（pid $(cat embed.pid)）"; exit 0
fi
HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}" PORT="$PORT" EMBED_MODEL="$MODEL" \
  nohup node server.mjs >> embed.log 2>&1 &
echo $! > embed.pid
for i in $(seq 1 60); do
  if curl -sf --max-time 1 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "启动成功：http://127.0.0.1:${PORT} （model=$MODEL）"; exit 0
  fi
  sleep 0.5
done
echo "启动超时，看 embed.log" >&2; exit 1
