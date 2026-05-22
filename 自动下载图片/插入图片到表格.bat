@echo off
chcp 65001 >nul
cd /d "%~dp0"
python insert_course_cover_images.py
echo.
pause
