import { app, BrowserWindow, session } from 'electron';
import * as path from 'path';
import { spawn, exec } from 'child_process';

let pythonProcess: any = null;

// Vite HMR requires 'unsafe-eval' in CSP, which Electron always warns about.
// Suppress in dev — this warning does not appear in packaged builds anyway.
// Must be set at module top-level BEFORE app.whenReady() / BrowserWindow creation.
if (process.env.NODE_ENV !== 'production') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

function createWindow() {
  const isDev = process.env.NODE_ENV !== 'production';

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // ── Content-Security-Policy ──
  // Set a proper CSP to silence the Electron security warning.
  // In dev mode we need to allow the Vite dev server, backend API, and eval for HMR.
  // In production this tightens down to 'self' only.
  const cspHeader = isDev
    ? [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self' http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*",
        "img-src 'self' data: blob:",
      ].join('; ')
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self' http://127.0.0.1:8000 ws://127.0.0.1:8000 http://127.0.0.1:8000 ws://127.0.0.1:8000 http://localhost:11434",
        "img-src 'self' data: blob:",
      ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspHeader],
      },
    });
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    // DevTools remains enabled for debugging (can be opened manually via Ctrl+Shift+I), but does not auto-open.
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function startPythonBackend() {
  // __dirname is frontend/electron during dev compilation, so backend is at ../../backend
  const backendPath = path.join(__dirname, '../../backend');
  
  pythonProcess = spawn('python', ['main.py'], {
    cwd: backendPath,
    shell: true
  });

  pythonProcess.stdout.on('data', (data: any) => {
    const text = data.toString().trim();
    if (text) console.log(`[Python]: ${text}`);
  });
  
  pythonProcess.stderr.on('data', (data: any) => {
    const text = data.toString().trim();
    if (!text) return;
    // Uvicorn and httpx write INFO-level logs to stderr by default.
    // Only flag lines containing actual error/warning keywords as errors.
    const isActualError = /\b(ERROR|CRITICAL|Traceback|Exception|FATAL)\b/i.test(text);
    const isWarning = /\bWARNING\b/i.test(text);
    if (isActualError) {
      console.error(`[Python ERROR]: ${text}`);
    } else if (isWarning) {
      console.warn(`[Python WARN]: ${text}`);
    } else {
      console.log(`[Python]: ${text}`);
    }
  });
}

function killSwitch() {
  console.log("==== INITIATING HARDWARE SAFETY KILL SWITCH ====");
  
  // 1. Terminate the Python backend tree
  if (pythonProcess && pythonProcess.pid) {
    console.log(`Killing Python process tree (PID: ${pythonProcess.pid})...`);
    exec(`taskkill /F /T /PID ${pythonProcess.pid}`);
  }

  // 2. Annihilate Ollama entirely to prevent hardware burnout
  console.log("Hunting down Ollama processes...");
  exec('taskkill /F /IM ollama.exe /T', (error) => {
    if (error) {
      console.log('Ollama was not running or already terminated.');
    } else {
      console.log('Ollama process explicitly killed 100% dead.');
    }
  });
}

app.whenReady().then(() => {
  startPythonBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  killSwitch();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  killSwitch();
});

process.on('uncaughtException', () => {
  killSwitch();
  process.exit(1);
});

