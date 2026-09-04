#!/bin/bash
# Copy PWA files to Android assets folder
# Run this before building the APK

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PWA_DIR="$SCRIPT_DIR/../votex-mobile"
ASSETS_DIR="$SCRIPT_DIR/app/src/main/assets"

echo "Copying PWA files to Android assets..."

# Clean assets
rm -rf "$ASSETS_DIR"/*
mkdir -p "$ASSETS_DIR/css" "$ASSETS_DIR/js" "$ASSETS_DIR/icons" "$ASSETS_DIR/wasm"

# Copy core files
cp "$PWA_DIR/index.html" "$ASSETS_DIR/"
cp "$PWA_DIR/manifest.json" "$ASSETS_DIR/"
cp "$PWA_DIR/sw.js" "$ASSETS_DIR/"

# Copy CSS
cp "$PWA_DIR/css/style.css" "$ASSETS_DIR/css/"

# Copy JS (excluding server.cjs)
for f in "$PWA_DIR"/js/*.js; do
  cp "$f" "$ASSETS_DIR/js/"
done

# Copy WASM analysis core
cp "$PWA_DIR"/wasm/votex_wasm.js "$ASSETS_DIR/wasm/" 2>/dev/null
cp "$PWA_DIR"/wasm/votex_wasm_bg.wasm "$ASSETS_DIR/wasm/" 2>/dev/null

# Copy icons
cp "$PWA_DIR/icons/icon.svg" "$ASSETS_DIR/icons/" 2>/dev/null
cp "$PWA_DIR/icons/icon-192.png" "$ASSETS_DIR/icons/" 2>/dev/null
cp "$PWA_DIR/icons/icon-512.png" "$ASSETS_DIR/icons/" 2>/dev/null

echo "Done! Assets copied to: $ASSETS_DIR"
ls -la "$ASSETS_DIR"