#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ -f embed.pid ] && kill -0 "$(cat embed.pid)" 2>/dev/null; then
  kill "$(cat embed.pid)" && rm -f embed.pid && echo "已停止"
else
  echo "未在运行"; rm -f embed.pid
fi
