@echo off
REM War Room dev launcher — keep this file in the repository root (next to package.json).
REM If you moved the repo, edit this path instead of relying on %%~dp0:
REM cd /d C:\Users\markb\warroom

cd /d "%~dp0"
set "WAR_ROOM_ROOT=%~dp0"

REM WR-Engineer Phase 5: reuse Ollama if installed. Never starts a second War Room process.
REM Never downloads a model.
where ollama >nul 2>&1
if %ERRORLEVEL%==0 (
  curl -s --max-time 2 http://127.0.0.1:11434/api/tags >nul 2>&1
  if errorlevel 1 (
    echo WR-Engineer: starting existing Ollama runtime (no model download).
    start "" /b ollama serve
  )
) else (
  echo WR-Engineer: Ollama not installed — local engine stays UNAVAILABLE until Commander installs it.
)

REM Open default browser shortly after; dev server runs in this window with logs.
start /b cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000"

pnpm dev
