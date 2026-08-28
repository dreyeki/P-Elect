#!/usr/bin/env bash
# 啟動本機伺服器並打開瀏覽器（macOS / Linux）
cd "$(dirname "$0")" || exit 1
PORT=8080
OPEN=$( command -v xdg-open || command -v open )

echo
echo "  選舉人生：福爾摩沙"
echo "  正在啟動本機伺服器..."
echo

if command -v python3 >/dev/null; then
  [ -n "$OPEN" ] && ( sleep 1; "$OPEN" "http://localhost:$PORT/" ) &
  echo "  關掉這個視窗或按 Ctrl+C 就會停止伺服器。"; echo
  exec python3 -m http.server "$PORT"
elif command -v npx >/dev/null; then
  [ -n "$OPEN" ] && ( sleep 2; "$OPEN" "http://localhost:$PORT/" ) &
  exec npx --yes http-server -p "$PORT" -c-1
else
  echo "  找不到 Python 或 Node。"
  echo "  請改用單檔版本：直接打開 dist/選舉人生.html。"
fi
