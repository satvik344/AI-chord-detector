@echo off
cd /d "%~dp0"
python run_server.py
if errorlevel 1 pause
