@echo off
REM start-Lumina.bat — launches LuminaLauncher.exe (the primary entry point).
REM Double-click this from Explorer to start Lumina.

set "LAUNCHER=%~dp0src\launcher\publish\LuminaLauncher.exe"

if not exist "%LAUNCHER%" (
  echo [ERROR] LuminaLauncher.exe not found at:
  echo   %LAUNCHER%
  echo.
  echo Build it first:
  echo   cd src\launcher
  echo   dotnet publish -c Release -r win-x64 --self-contained false
  pause
  exit /b 1
)

start "" "%LAUNCHER%"
exit /b 0
