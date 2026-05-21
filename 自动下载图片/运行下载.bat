@echo off
chcp 65001 >nul
cd /d "%~dp0"
python download_course_covers.py
echo.
pause
