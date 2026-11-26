#!/usr/bin/env bash
# 生成含 embed/node_modules 的分发包（npm pack 会强制排除 node_modules）。
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty; commit first (pack.sh archives HEAD, not the working tree)." >&2
  exit 1
fi
head_version=$(git show HEAD:package.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))")
if [ "$head_version" != "$version" ]; then
  echo "error: HEAD package.json is $head_version but working tree is $version; commit first." >&2
  exit 1
fi
out="dist/dsh-context-hub-${version}.tgz"
mkdir -p dist
git archive --format=tar --prefix=package/ "${1:-HEAD}" | gzip -6 > "$out"
bytes=$(stat -c %s "$out")
sha=$(sha256sum "$out" | cut -d' ' -f1)
echo "built $out"
echo "files: $(tar -tzf "$out" | grep -vc '/$')  bytes: $bytes  sha256: $sha"
