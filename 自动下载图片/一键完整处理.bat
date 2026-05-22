@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo Step 1/3: Download course cover images
echo ========================================
python download_course_covers.py
echo.
pause
if errorlevel 1 goto failed

echo.
echo ========================================
echo Step 2/3: Convert line breaks to ^<p^> tags
echo ========================================
python normalize_csv_paragraphs.py
echo.
pause
if errorlevel 1 goto failed

echo.
echo ========================================
echo Step 3/3: Insert images into Excel
echo ========================================
python insert_course_cover_images.py
echo.
pause
if errorlevel 1 goto failed

echo.
echo ========================================
echo All steps completed
echo ========================================
echo.
pause
exit /b 0

:failed
echo.
echo ========================================
echo Stopped: the previous step failed. Please check the message above.
echo ========================================
echo.
pause
exit /b 1
