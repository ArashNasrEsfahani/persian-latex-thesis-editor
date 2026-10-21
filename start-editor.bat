@echo off
rem RTL LaTeX Live Editor launcher.  Usage: start-editor.bat [project folder] [extra server.py options]
rem With no argument the bundled example project is opened.
title RTL LaTeX Live Editor
cd /d "%~dp0"
set PY=python
where python >nul 2>nul || set PY=py
where %PY% >nul 2>nul || (
  echo Python 3.9+ was not found. Install it or add it to PATH.
  pause
  exit /b 1
)
if "%~1"=="" (
  %PY% server.py --root example --open
) else (
  %PY% server.py --root "%~1" --open %2 %3 %4 %5 %6
)
if errorlevel 1 pause
