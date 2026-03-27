@echo off
cd /d "%~dp0"
echo Starting Video Chat Server...
node server\server.js
pause
