#!/usr/bin/env bash
# 生成含 embed/node_modules 的分发包（npm pack 会强制排除 node_modules）。
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
out="dist/dsh-context-hub-${version}.tgz"
mkdir -p dist
git archive --format=tar --prefix=package/ "${1:-HEAD}" | gzip -6 > "$out"
bytes=$(stat -c %s "$out")
sha=$(sha256sum "$out" | cut -d' ' -f1)
echo "built $out"
echo "files: $(tar -tzf "$out" | grep -vc '/$')  bytes: $bytes  sha256: $sha"
