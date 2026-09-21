@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo 找不到 Electron 运行时：node_modules\electron\dist\electron.exe
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "."
