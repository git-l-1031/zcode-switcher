@echo off
taskkill /f /im explorer.exe
timeout /t 2 /nobreak >nul
del /a /q "%LocalAppData%\IconCache.db" 2>nul
del /a /q "%LocalAppData%\Microsoft\Windows\Explorer\iconcache*" 2>nul
del /a /q "%LocalAppData%\Microsoft\Windows\Explorer\thumbcache*" 2>nul
start explorer.exe
