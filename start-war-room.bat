@echo off
REM War Room dev launcher — keep this file in the repository root (next to package.json).
REM If you moved the repo, edit this path instead of relying on %%~dp0:
REM cd /d C:\Users\markb\warroom

cd /d "%~dp0"
set "WAR_ROOM_ROOT=%~dp0"

REM Open default browser shortly after; dev server runs in this window with logs.
start /b cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000"

pnpm dev
