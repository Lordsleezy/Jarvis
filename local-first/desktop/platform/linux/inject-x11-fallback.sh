#!/usr/bin/env bash
# Fallback when AT-SPI / pyatspi is unavailable: X11 clipboard + Ctrl+V.
set -euo pipefail
PAYLOAD="$1"
if [[ ! -f "$PAYLOAD" ]]; then
  exit 1
fi
if command -v xclip >/dev/null 2>&1; then
  xclip -selection clipboard < "$PAYLOAD"
elif command -v xsel >/dev/null 2>&1; then
  xsel --clipboard < "$PAYLOAD"
else
  exit 5
fi
sleep 0.15
if command -v xdotool >/dev/null 2>&1; then
  xdotool key --clearmodifiers ctrl+v
else
  exit 6
fi
exit 0
