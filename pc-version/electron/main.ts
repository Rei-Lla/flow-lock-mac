import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let focusInterval: ReturnType<typeof setInterval> | null = null;
let lockedApps: string[] = [];
let allowedSet = new Set<string>();
let enforcing = false;

// ── Persistent PowerShell process ─────────────────────────────────
let ps: ChildProcess | null = null;
let psReady = false;

// Our own process name to always allow
const ownProcessName = path.basename(process.execPath, '.exe');

function initPowerShell(): Promise<void> {
  return new Promise((resolve, reject) => {
    ps = spawn('powershell.exe', [
      '-NoProfile', '-NoLogo', '-NonInteractive', '-Command', '-',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    ps.on('error', () => reject(new Error('PowerShell unavailable')));

    let initBuf = '';
    const onInit = (chunk: Buffer) => {
      initBuf += chunk.toString();
      if (initBuf.includes('__READY__')) {
        ps!.stdout!.off('data', onInit);
        psReady = true;
        resolve();
      }
    };
    ps.stdout!.on('data', onInit);

    ps.stdin!.write(`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
public class FlowLock {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    public static string FG() {
        try {
            IntPtr h = GetForegroundWindow();
            uint p = 0;
            GetWindowThreadProcessId(h, out p);
            return Process.GetProcessById((int)p).ProcessName;
        } catch { return ""; }
    }
    public static void HideFG() {
        ShowWindow(GetForegroundWindow(), 6);
    }
    public static void Activate(string n) {
        foreach (var p in Process.GetProcessesByName(n)) {
            if (p.MainWindowHandle != IntPtr.Zero) {
                ShowWindow(p.MainWindowHandle, 9);
                SetForegroundWindow(p.MainWindowHandle);
                return;
            }
        }
    }
}
"@
Write-Output "__READY__"
`);

    setTimeout(() => { if (!psReady) reject(new Error('PowerShell init timeout')); }, 15000);
  });
}

function psExec(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    if (!ps || !psReady) { resolve(''); return; }

    const marker = `__END_${Date.now()}__`;
    let buf = '';

    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const idx = buf.indexOf(marker);
      if (idx !== -1) {
        ps!.stdout!.off('data', onData);
        resolve(buf.substring(0, idx).trim());
      }
    };

    ps!.stdout!.on('data', onData);
    ps!.stdin!.write(`${cmd}\nWrite-Output '${marker}'\n`);

    // Timeout safety
    setTimeout(() => {
      ps!.stdout!.off('data', onData);
      resolve('');
    }, 4000);
  });
}

function killPowerShell(): void {
  if (ps) {
    try { ps.kill(); } catch { /* ignore */ }
    ps = null;
    psReady = false;
  }
}

// ── Get running GUI apps ──────────────────────────────────────────
async function getRunningApps(): Promise<{ name: string; bundleId: string; error?: string }[]> {
  if (!psReady) {
    return [{ name: '__error__', bundleId: '', error: 'powershell' }];
  }

  try {
    const raw = await psExec(
      `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ` +
      `Group-Object ProcessName | ForEach-Object { ` +
      `$f = $_.Group[0]; "$($f.ProcessName)|||$($f.MainWindowTitle)" }`
    );

    if (!raw) {
      return [{ name: '__error__', bundleId: '', error: 'no_apps' }];
    }

    return raw
      .split('\n')
      .filter((line) => line.includes('|||'))
      .map((line) => {
        const [name, title] = line.split('|||');
        return { name: name.trim(), bundleId: (title || '').trim() };
      })
      .filter((a) => a.name && a.name !== ownProcessName && a.name !== 'electron');
  } catch {
    return [{ name: '__error__', bundleId: '', error: 'unknown' }];
  }
}

// ── Enforcement ───────────────────────────────────────────────────
async function enforce(): Promise<void> {
  if (enforcing || lockedApps.length === 0 || !psReady) return;
  enforcing = true;

  try {
    const frontApp = await psExec('[FlowLock]::FG()');
    if (!frontApp || allowedSet.has(frontApp)) return;

    // Hide the non-allowed window and activate the first locked app
    ps!.stdin!.write(
      `[FlowLock]::HideFG(); [FlowLock]::Activate('${lockedApps[0]}')\n`
    );
    mainWindow?.webContents.send('focus:blocked', frontApp);
  } finally {
    enforcing = false;
  }
}

function startFocusEnforcement(apps: string[]): void {
  lockedApps = [...apps];
  allowedSet = new Set([...apps, ownProcessName, 'electron', 'explorer']);
  focusInterval = setInterval(enforce, 500);
}

function addToAllowed(newApps: string[]): void {
  for (const a of newApps) {
    allowedSet.add(a);
    if (!lockedApps.includes(a)) lockedApps.push(a);
  }
}

function stopFocusEnforcement(): void {
  if (focusInterval) {
    clearInterval(focusInterval);
    focusInterval = null;
  }
  lockedApps = [];
  allowedSet.clear();
  enforcing = false;
}

// ── Window ────────────────────────────────────────────────────────
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 620,
    title: '心流锁定器',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// ── IPC Handlers ───────────────────────────────────────────────────
ipcMain.handle('apps:getRunning', () => {
  return getRunningApps();
});

ipcMain.handle('lock:start', (_e, apps: string[], _minutes: number) => {
  startFocusEnforcement(apps);
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.setMinimumSize(320, 100);
    mainWindow.setSize(400, 160);
    mainWindow.setResizable(false);
  }
});

ipcMain.handle('lock:addApps', (_e, apps: string[]) => {
  addToAllowed(apps);
});

ipcMain.handle('lock:expandWindow', () => {
  if (mainWindow) {
    mainWindow.setMinimumSize(400, 420);
    mainWindow.setSize(400, 420);
    mainWindow.setResizable(false);
  }
});

ipcMain.handle('lock:collapseWindow', () => {
  if (mainWindow) {
    mainWindow.setMinimumSize(320, 100);
    mainWindow.setSize(400, 160);
    mainWindow.setResizable(false);
  }
});

ipcMain.handle('lock:stop', () => {
  stopFocusEnforcement();
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMinimumSize(520, 620);
    mainWindow.setSize(520, 620);
  }
});

// ── App lifecycle ──────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    await initPowerShell();
  } catch (err) {
    console.error('PowerShell init failed:', err);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  stopFocusEnforcement();
  killPowerShell();
  app.quit();
});
