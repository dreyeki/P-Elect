@echo off
chcp 65001 >nul
title 更新 CI 設定
cd /d "%~dp0"

echo.
echo   更新 GitHub Actions 的測試設定
echo   ------------------------------------------------
echo   把 tools\ci-check.yml 複製到 .github\workflows\check.yml
echo.

if not exist "tools\ci-check.yml" (
  echo   [失敗] 找不到 tools\ci-check.yml
  echo   請確認這個 bat 放在 p-election 資料夾的最外層。
  echo.
  pause
  exit /b 1
)

if not exist ".github\workflows" (
  echo   .github\workflows 不存在，先建立資料夾...
  mkdir ".github\workflows" 2>nul
)

if exist ".github\workflows\check.yml" (
  copy /y ".github\workflows\check.yml" ".github\workflows\check.yml.bak" >nul
  echo   舊的設定已備份成 check.yml.bak
)

copy /y "tools\ci-check.yml" ".github\workflows\check.yml" >nul
if errorlevel 1 (
  echo.
  echo   [失敗] 複製不成功。可能是檔案被其他程式開著，
  echo   或者這個資料夾沒有寫入權限。
  echo.
  pause
  exit /b 1
)

echo   [完成] .github\workflows\check.yml 已更新
echo.
echo   現在 CI 會跑這幾個步驟：
echo.
findstr /c:"- name:" ".github\workflows\check.yml"
echo.
echo   接下來 push 到 GitHub 就會自動跑這些測試。
echo.
pause
