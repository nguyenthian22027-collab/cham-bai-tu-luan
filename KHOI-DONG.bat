@echo off
chcp 65001 >nul
title EduCenter — Hệ thống Chấm bài Tự luận Word & AI

echo.
echo ================================================================
echo    EDUCENTER — HỆ THỐNG CHẤM BÀI TỰ LUẬN TỪ WORD VÀ AI GEMINI
echo ================================================================
echo.

:: 1. Kiểm tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [LỖI] Máy tính của bạn chưa cài đặt Node.js!
    echo Vui lòng tải và cài đặt Node.js (bản LTS) tại: https://nodejs.org
    echo Sau khi cài đặt xong, hãy mở lại file này.
    echo.
    pause
    exit /b 1
)

:: 2. Kiểm tra node_modules
if not exist "node_modules\" (
    echo [THÔNG BÁO] Phát hiện lần đầu khởi chạy, đang cài đặt thư viện cần thiết...
    echo Quá trình này có thể mất 1-2 phút, vui lòng chờ...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [LỖI] Cài đặt thư viện thất bại! Vui lòng kiểm tra lại kết nối mạng.
        pause
        exit /b 1
    )
    echo.
    echo [THÀNH CÔNG] Đã cài đặt xong thư viện!
    echo.
)

:: 3. Khởi chạy ứng dụng và tự động mở trình duyệt
echo [1/2] Đang khởi động máy chủ Web...
echo [2/2] Trình duyệt web sẽ tự động mở trang ứng dụng ngay bây giờ...
echo.
echo ----------------------------------------------------------------
echo   Địa chỉ web: http://localhost:5173
echo   (Khi muốn tắt ứng dụng, bạn chỉ cần bấm Ctrl + C hoặc đóng cửa sổ này)
echo ----------------------------------------------------------------
echo.

call npm run dev -- --open

if %errorlevel% neq 0 (
    echo.
    echo [LỖI] Ứng dụng đã dừng với mã lỗi %errorlevel%.
    pause
)
