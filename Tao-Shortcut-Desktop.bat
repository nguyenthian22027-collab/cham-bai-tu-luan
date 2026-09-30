@echo off
chcp 65001 >nul
title Tạo phím tắt EduCenter ra màn hình Desktop

echo.
echo ================================================================
echo    TẠO BIỂU TƯỢNG (SHORTCUT) RA MÀN HÌNH CHÍNH (DESKTOP)
echo ================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$sc = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\EduCenter - Chấm Bài Tự Luận.lnk'); " ^
  "$sc.TargetPath = '%~dp0KHOI-DONG.bat'; " ^
  "$sc.WorkingDirectory = '%~dp0'; " ^
  "$sc.Description = 'Khởi động ứng dụng EduCenter Chấm bài tự luận'; " ^
  "$sc.Save()"

if %errorlevel% equ 0 (
    echo [THÀNH CÔNG] Đã tạo biểu tượng "EduCenter - Chấm Bài Tự Luận" trên màn hình Desktop!
    echo Từ nay bạn chỉ cần ra màn hình chính, nhấp đúp vào biểu tượng đó để mở ứng dụng.
) else (
    echo [THÔNG BÁO] Không thể tạo shortcut tự động. Bạn có thể nhấn chuột phải vào file KHOI-DONG.bat chọn "Send to -> Desktop (create shortcut)".
)

echo.
pause
