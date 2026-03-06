@echo off
setlocal
echo =======================================
echo     Starting UNO Game: NEOUNOv2
echo =======================================

echo [System] Starting UNO Backend...
start cmd /k "cd server && npm start"

echo [System] Starting UNO Frontend...
npm run dev

pause
