@echo off
chcp 65001 >nul
rem Double-click wrapper: runs start_teaching_agent.ps1 with ExecutionPolicy Bypass.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_teaching_agent.ps1"
pause
