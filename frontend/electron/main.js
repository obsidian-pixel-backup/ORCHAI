"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
let pythonProcess = null;
// Vite HMR requires 'unsafe-eval' in CSP, which Electron always warns about.
// Suppress in dev — this warning does not appear in packaged builds anyway.
// Must be set at module top-level BEFORE app.whenReady() / BrowserWindow creation.
if (process.env.NODE_ENV !== 'production') {
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}
function createWindow() {
    const isDev = process.env.NODE_ENV !== 'production';
    const win = new electron_1.BrowserWindow({
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
    electron_1.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
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
    }
    else {
        win.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}
function startPythonBackend() {
    // __dirname is frontend/electron during dev compilation, so backend is at ../../backend
    const backendPath = path.join(__dirname, '../../backend');
    pythonProcess = (0, child_process_1.spawn)('python', ['main.py'], {
        cwd: backendPath,
        shell: true
    });
    pythonProcess.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text)
            console.log(`[Python]: ${text}`);
    });
    pythonProcess.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (!text)
            return;
        // Uvicorn and httpx write INFO-level logs to stderr by default.
        // Only flag lines containing actual error/warning keywords as errors.
        const isActualError = /\b(ERROR|CRITICAL|Traceback|Exception|FATAL)\b/i.test(text);
        const isWarning = /\bWARNING\b/i.test(text);
        if (isActualError) {
            console.error(`[Python ERROR]: ${text}`);
        }
        else if (isWarning) {
            console.warn(`[Python WARN]: ${text}`);
        }
        else {
            console.log(`[Python]: ${text}`);
        }
    });
}
function killSwitch() {
    console.log("==== INITIATING HARDWARE SAFETY KILL SWITCH ====");
    // 1. Terminate the Python backend tree
    if (pythonProcess && pythonProcess.pid) {
        console.log(`Killing Python process tree (PID: ${pythonProcess.pid})...`);
        (0, child_process_1.exec)(`taskkill /F /T /PID ${pythonProcess.pid}`);
    }
    // 2. Annihilate Ollama entirely to prevent hardware burnout
    console.log("Hunting down Ollama processes...");
    (0, child_process_1.exec)('taskkill /F /IM ollama.exe /T', (error) => {
        if (error) {
            console.log('Ollama was not running or already terminated.');
        }
        else {
            console.log('Ollama process explicitly killed 100% dead.');
        }
    });
}
electron_1.app.whenReady().then(() => {
    startPythonBackend();
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    killSwitch();
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    killSwitch();
});
process.on('uncaughtException', () => {
    killSwitch();
    process.exit(1);
});
