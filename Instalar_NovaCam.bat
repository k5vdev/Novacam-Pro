@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title NovaCam Pro - Instalador Automático

:: 1. Verificación y auto-elevación a Administrador
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo [i] Solicitando permisos de Administrador para registrar driver y accesos...
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin_novacam.vbs"
    echo UAC.ShellExecute "cmd.exe", "/c ""%~f0""", "", "runas", 1 >> "%temp%\getadmin_novacam.vbs"
    "%temp%\getadmin_novacam.vbs"
    del "%temp%\getadmin_novacam.vbs"
    exit /B
)

pushd "%CD%"
CD /D "%~dp0"

echo ================================================================
echo               NovaCam Pro - Instalador Automático
echo ================================================================
echo.

:: 2. Comprobar Python
echo [1/4] Verificando instalación de Python 3...
python --version >nul 2>&1
if %errorlevel% NEQ 0 (
    echo.
    echo [ERROR] No se detectó Python en el sistema.
    echo Por favor descarga e instala Python 3.10+ desde:
    echo https://www.python.org/downloads/
    echo Recuerda marcar la casilla "Add Python to PATH" durante la instalación.
    echo.
    pause
    exit /B 1
)
for /f "tokens=*" %%v in ('python --version') do echo [OK] %%v detectado.
echo.

:: 3. Instalar librerías Python requeridas
echo [2/4] Instalando paquetes de Python (requirements.txt)...
python -m pip install -r requirements.txt --quiet --disable-pip-version-check
if %errorlevel% NEQ 0 (
    echo [i] Reintentando con salida detallada...
    python -m pip install -r requirements.txt
)
echo [OK] Dependencias instaladas correctamente.
echo.

:: 3a. scrcpy + adb oficiales (no se redistribuyen en el repositorio)
if not exist "bin\scrcpy.exe" (
    echo [i] Descargando scrcpy y adb oficiales desde GitHub...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\get_scrcpy.ps1"
    if !errorlevel! NEQ 0 (
        echo [!] No se pudo descargar scrcpy. Descargalo de https://github.com/Genymobile/scrcpy/releases
        echo     y copia su contenido a la carpeta bin\
    ) else (
        echo [OK] scrcpy y adb instalados en bin\
    )
) else (
    echo [OK] scrcpy encontrado en bin\scrcpy.exe
)
echo.

:: 3b. Comprobar FFmpeg (bin\ffmpeg.exe o PATH)
if exist "bin\ffmpeg.exe" (
    echo [OK] FFmpeg encontrado en bin\ffmpeg.exe
) else (
    where ffmpeg >nul 2>&1
    if !errorlevel! NEQ 0 (
        echo [!] FFmpeg no encontrado. Copia ffmpeg.exe a la carpeta bin\ o instalalo con:
        echo     winget install Gyan.FFmpeg
    ) else (
        echo [OK] FFmpeg encontrado en el PATH.
    )
)
echo.

:: 4. Registrar driver DirectShow (NovaCam Virtual Camera)
echo [3/4] Registrando driver de cámara virtual DirectShow...
if exist "driver\UnityCaptureFilter64.dll" (
    regsvr32 /s "driver\UnityCaptureFilter32.dll" "/i:UnityCaptureName=NovaCam Virtual Camera" "/i:UnityCaptureDevices=4"
    regsvr32 /s "driver\UnityCaptureFilter64.dll" "/i:UnityCaptureName=NovaCam Virtual Camera" "/i:UnityCaptureDevices=4"
    echo [OK] DirectShow Virtual Camera registrado exitosamente.
) else (
    echo [!] Carpeta driver no encontrada. Saltando registro.
)
echo.

:: 5. Crear accesos directos en Escritorio y Menú Inicio
echo [4/4] Creando accesos directos en Escritorio y Menú Inicio...
set "TARGET_EXE=%~dp0NovaCam_Pro.exe"
set "ICON_FILE=%~dp0icon.ico"
set "APP_DIR=%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$sc = $ws.CreateShortcut(\"$desktop\NovaCam Pro.lnk\"); " ^
  "$sc.TargetPath = '%TARGET_EXE%'; " ^
  "$sc.WorkingDirectory = '%APP_DIR%'; " ^
  "if (Test-Path '%ICON_FILE%') { $sc.IconLocation = '%ICON_FILE%'; } " ^
  "$sc.Description = 'NovaCam Pro - Cámara Web y Micrófono HD'; " ^
  "$sc.Save(); " ^
  "$programs = [Environment]::GetFolderPath('Programs'); " ^
  "$scp = $ws.CreateShortcut(\"$programs\NovaCam Pro.lnk\"); " ^
  "$scp.TargetPath = '%TARGET_EXE%'; " ^
  "$scp.WorkingDirectory = '%APP_DIR%'; " ^
  "if (Test-Path '%ICON_FILE%') { $scp.IconLocation = '%ICON_FILE%'; } " ^
  "$scp.Description = 'NovaCam Pro'; " ^
  "$scp.Save();"

echo [OK] Acceso directo 'NovaCam Pro' creado en tu Escritorio y Menú Inicio.
echo.
echo ================================================================
echo           ¡INSTALACIÓN COMPLETADA CON ÉXITO!
echo ================================================================
echo.
echo Puedes iniciar NovaCam Pro en cualquier momento haciendo doble clic
echo en el icono 'NovaCam Pro' en tu Escritorio.
echo.
set /p RUN_CHOICE="¿Deseas abrir NovaCam Pro ahora mismo? (S/N): "
if /i "%RUN_CHOICE%"=="S" (
    start "" "%TARGET_EXE%"
)
