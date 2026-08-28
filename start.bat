@echo off
chcp 65001 >nul
title 選舉人生：福爾摩沙
cd /d "%~dp0"

set PORT=8080

echo.
echo   選舉人生：福爾摩沙
echo   正在啟動本機伺服器...
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:%PORT%/
  echo   伺服器已啟動，瀏覽器應該會自動打開。
  echo   關掉這個視窗就會停止伺服器。
  echo.
  py -3 -m http.server %PORT%
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:%PORT%/
  echo   伺服器已啟動，瀏覽器應該會自動打開。
  echo   關掉這個視窗就會停止伺服器。
  echo.
  python -m http.server %PORT%
  goto :eof
)

where npx >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:%PORT%/
  echo   伺服器已啟動，瀏覽器應該會自動打開。
  echo   關掉這個視窗就會停止伺服器。
  echo.
  npx --yes http-server -p %PORT% -c-1
  goto :eof
)

echo   找不到 Python 或 Node，沒辦法啟動伺服器。
echo.
echo   請改用單檔版本：直接打開 dist 資料夾裡的
echo   「選舉人生.html」，那一份可以雙擊執行。
echo.
pause
