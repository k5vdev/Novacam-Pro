@echo off
:: Self-elevation check
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Solicitando permisos de administrador...
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "cmd.exe", "/c ""%~f0""", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs"
    del "%temp%\getadmin.vbs"
    exit /B
)

pushd "%CD%"
CD /D "%~dp0"
echo Desinstalando NovaCam Virtual Camera...
regsvr32 /s /u "UnityCaptureFilter64.dll"
regsvr32 /s /u "UnityCaptureFilter32.dll"
echo Desinstalacion completada.
timeout /t 2 >nul
