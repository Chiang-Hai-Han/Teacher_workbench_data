@echo off
chcp 65001 >nul
cd /d "%~dp0"
python normalize_csv_paragraphs.py
echo.
pause
