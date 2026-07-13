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
// Give the app a real identity (window title, taskbar, About box) instead of the
// default package name "frontend".
const APP_NAME = 'KLYDIS';
electron_1.app.setName(APP_NAME);
/**
 * Build the application menu. Standard editing/view items use built-in roles
 * (guaranteed to work). KLYDIS-specific items send an IPC message to the renderer,
 * which App.tsx listens for (see the `menu:*` handlers there).
 */
function buildAppMenu(win) {
    const send = (channel) => () => win.webContents.send(channel);
    const template = [
        {
            label: 'File',
            submenu: [
                { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: send('menu:new-chat') },
                { type: 'separator' },
                { label: 'Model Library…', accelerator: 'CmdOrCtrl+Shift+M', click: send('menu:open-model-library') },
                { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: send('menu:open-settings') },
                { type: 'separator' },
                { role: 'quit' },
            ],
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
            ],
        },
        {
            label: 'View',
            submenu: [
                { label: 'Toggle Theme (Light/Dark)', accelerator: 'CmdOrCtrl+Shift+L', click: send('menu:toggle-theme') },
                { type: 'separator' },
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                { role: 'close' },
            ],
        },
        {
            role: 'help',
            submenu: [
                {
                    label: 'About KLYDIS',
                    click: () => {
                        electron_1.dialog.showMessageBox(win, {
                            type: 'info',
                            title: 'About KLYDIS',
                            message: 'KLYDIS',
                            detail: 'Autonomous agent orchestration wrapper.\n' +
                                'Electron + React frontend · Python FastAPI backend · local LLMs via Ollama.\n\n' +
                                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
                            buttons: ['OK'],
                        });
                    },
                },
                {
                    label: 'GitHub Repository',
                    click: () => { electron_1.shell.openExternal('https://github.com/obsidian-pixel-backup/KLYDIS'); },
                },
            ],
        },
    ];
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
}
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
        title: APP_NAME,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    // Keep the window/taskbar title as "KLYDIS" — otherwise the page's <title>
    // (or Vite) can override it.
    win.on('page-title-updated', (e) => e.preventDefault());
    win.setTitle(APP_NAME);
    // Install the KLYDIS application menu.
    buildAppMenu(win);
    // Ask before shutting down — let the user decide whether to also stop Ollama,
    // instead of always force-killing it (it may be used by other apps).
    win.on('close', (e) => {
        if (quitDecision !== 'pending')
            return; // choice already made — allow close
        e.preventDefault();
        const choice = electron_1.dialog.showMessageBoxSync(win, {
            type: 'question',
            buttons: ['Cancel', 'Quit — keep Ollama running', 'Quit & stop Ollama'],
            defaultId: 2,
            cancelId: 0,
            noLink: true,
            title: 'Quit KLYDIS?',
            message: 'Quit KLYDIS?',
            detail: 'The KLYDIS Python backend will stop. Do you also want to stop the local '
                + 'Ollama server? (Stopping it frees GPU/RAM, but will affect anything else using Ollama.)',
        });
        if (choice === 0)
            return; // Cancel — keep the window open
        quitDecision = choice === 2 ? 'quit-kill' : 'quit-keep';
        killSwitch(quitDecision === 'quit-kill');
        win.close(); // re-fires 'close'; now quitDecision !== 'pending' so it proceeds
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
    pythonProcess = (0, child_process_1.spawn)('python', ['-u', 'main.py'], {
        cwd: backendPath,
        shell: true,
        env: { ...process.env, PYTHONUNBUFFERED: "1" }
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
// Tracks the user's quit choice so we don't show the confirm dialog twice and
// don't stop Ollama unless they asked us to.
let quitDecision = 'pending';
function killSwitch(killOllama) {
    console.log(`==== SHUTDOWN (stop Ollama: ${killOllama}) ====`);
    // 1. Terminate the Python backend tree (always — it belongs to this app).
    if (pythonProcess && pythonProcess.pid) {
        console.log(`Killing Python process tree (PID: ${pythonProcess.pid})...`);
        (0, child_process_1.exec)(`taskkill /F /T /PID ${pythonProcess.pid}`);
    }
    // 2. Optionally stop Ollama (frees GPU/RAM) — only when the user chose to,
    //    since they may be using Ollama for other apps.
    if (killOllama) {
        console.log("Stopping Ollama processes...");
        (0, child_process_1.exec)('taskkill /F /IM ollama.exe /T', (error) => {
            if (error) {
                console.log('Ollama was not running or already terminated.');
            }
            else {
                console.log('Ollama stopped.');
            }
        });
    }
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
    // The window 'close' handler already ran the shutdown (with the user's choice).
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    // Safety net for quit paths that bypass the window close dialog (e.g. OS logoff).
    // Stop the backend, but don't stop Ollama unless the user explicitly chose to.
    if (quitDecision === 'pending') {
        killSwitch(false);
    }
});
process.on('uncaughtException', () => {
    // Crash safety: stop everything (including Ollama) to avoid runaway GPU load.
    killSwitch(true);
    process.exit(1);
});
