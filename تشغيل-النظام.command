#!/bin/bash
# انقر نقرًا مزدوجًا لتشغيل Printing gate ERP على جهاز Mac للتجربة.
# لا يحتاج تثبيت أي شيء: يحمّل Node.js وقاعدة البيانات داخل مجلد المشروع (يحتاج إنترنت أول مرة فقط).
cd "$(dirname "$0")" || exit 1
set -e
NODE_VER="v22.11.0"
need_node=1
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge 20 ] && need_node=0
fi
if [ $need_node -eq 1 ]; then
  if [ ! -x ".runtime/node/bin/node" ]; then
    arch=$(uname -m); [ "$arch" = "arm64" ] || arch="x64"
    echo "▶ تحميل Node.js (مرة واحدة فقط)…"
    mkdir -p .runtime
    curl -fL --progress-bar "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-darwin-${arch}.tar.gz" | tar -xz -C .runtime
    rm -rf .runtime/node && mv ".runtime/node-${NODE_VER}-darwin-${arch}" .runtime/node
  fi
  export PATH="$PWD/.runtime/node/bin:$PATH"
fi
if [ ! -d node_modules/embedded-postgres ]; then
  echo "▶ تحميل مكتبات النظام (مرة واحدة فقط، بضع دقائق)…"
  npm install --no-audit --no-fund
fi
node scripts/launcher.mjs
echo
read -r -p "اضغط Enter لإغلاق النافذة…"
