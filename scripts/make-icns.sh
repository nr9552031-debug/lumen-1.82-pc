#!/bin/bash
# Builds build/icon.icns from build/icon.png (macOS only: uses sips + iconutil). The source PNG is 256 px, so it is upscaled.
set -euo pipefail
cd "$(dirname "$0")/.."
SET=build/icon.iconset; rm -rf "$SET"; mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s build/icon.png --out "$SET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) build/icon.png --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o build/icon.icns
rm -rf "$SET"; echo "wrote build/icon.icns"
