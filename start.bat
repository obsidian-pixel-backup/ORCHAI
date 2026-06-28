@echo off
echo ==========================================
echo    Starting ORCHAI Orchestration Wrapper  
echo    (Hardware Safety Kill Switch Enabled)
echo ==========================================
echo.

:: Store the project root directory
set "ORCHAI_ROOT=%~dp0"

:: ===== Step 0: Bootstrap Ollama if not running =====
echo [1/4] Checking Ollama service status...
netstat -ano | findstr ":11434" | findstr "LISTENING" >nul 2>&1
if ERRORLEVEL 1 (
    echo Starting Ollama background server...
    start /B ollama serve >nul 2>&1
    :: Wait a moment for server initialization
    timeout /t 3 /nobreak >nul
) else (
    echo Ollama server is already running.
)
echo.

:: ===== Step 1: Python Backend Dependencies =====
echo [2/4] Verifying Python Requirements...
pushd "%ORCHAI_ROOT%backend"
pip install -r requirements.txt >nul 2>&1
if ERRORLEVEL 1 (
    echo WARNING: Some Python packages may have failed to install.
    echo Continuing anyway...
)
popd

:: ===== Step 2: Frontend Dependencies =====
echo [3/4] Checking Frontend Dependencies...
pushd "%ORCHAI_ROOT%frontend"

:: Only run npm install if node_modules doesn't exist
if not exist "node_modules" (
    echo Installing frontend dependencies for first time...
    call npm install --no-audit --no-fund
)

:: Check if Electron binary is properly installed
if not exist "node_modules\electron\dist\electron.exe" (
    echo Electron binary not found. Installing...
    
    :: Try the normal npm postinstall script first
    set "ELECTRON_SKIP_BINARY_DOWNLOAD="
    call node node_modules\electron\install.js 2>nul
    
    :: If that didn't work, check again and try PowerShell fallback
    if not exist "node_modules\electron\dist\electron.exe" (
        echo [Fallback] Using PowerShell to download Electron binary...
        
        :: Read the electron version from package.json  
        for /f "tokens=2 delims=:, " %%v in ('findstr "version" "node_modules\electron\package.json"') do (
            set "ELECTRON_VERSION=%%~v"
            goto :got_version
        )
        :got_version
        echo Downloading Electron v%ELECTRON_VERSION%...
        
        powershell -ExecutionPolicy Bypass -Command ^
            "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
            "Invoke-WebRequest -Uri 'https://github.com/electron/electron/releases/download/v%ELECTRON_VERSION%/electron-v%ELECTRON_VERSION%-win32-x64.zip' -OutFile 'electron_download.zip'; " ^
            "if (Test-Path 'node_modules\electron\dist') { Remove-Item 'node_modules\electron\dist' -Recurse -Force }; " ^
            "Expand-Archive -Path 'electron_download.zip' -DestinationPath 'node_modules\electron\dist' -Force; " ^
            "Remove-Item 'electron_download.zip' -Force"
    )
)

:: Ensure path.txt is correct (this is what broke us before)
if exist "node_modules\electron\dist\electron.exe" (
    <nul set /p ="electron.exe"> "node_modules\electron\path.txt"
    echo Electron binary verified OK.
) else (
    echo ==========================================
    echo ERROR: Failed to install Electron binary.
    echo Please run: cd frontend ^&^& npm install
    echo ==========================================
    pause
    goto :cleanup
)

:: ===== Step 3: Kill any zombie processes on port 5173 =====
echo [4/4] Launching ORCHAI Application...

:: Kill anything on port 5173
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173" ^| findstr "LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Launch the app
call npm run electron:dev

:cleanup
echo.
echo ==========================================
echo Application Closed. Running Kill Switch...
echo ==========================================

:: Kill Python backend
taskkill /F /IM python.exe /T 2>nul

:: Kill Ollama to prevent hardware burnout
taskkill /F /IM ollama.exe /T 2>nul
echo All processes terminated. Hardware safe.

popd
