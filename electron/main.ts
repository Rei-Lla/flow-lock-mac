import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { execSync, exec } from 'child_process';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let focusInterval: ReturnType<typeof setInterval> | null = null;
let lockedApps: string[] = [];
let allowedSet = new Set<string>();
let enforcing = false;

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

// ── Get running GUI apps via AppleScript ───────────────────────────
function getRunningApps(): { name: string; bundleId: string; error?: string }[] {
  try {
    const script = `
      set appList to ""
      tell application "System Events"
        set procs to every process whose background only is false
        repeat with p in procs
          set appList to appList & name of p & "|||" & bundle identifier of p & "\\n"
        end repeat
      end tell
      return appList
    `;
    const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    if (!result) {
      return [{ name: '__error__', bundleId: '', error: 'no_apps' }];
    }

    return result
      .split('\n')
      .filter((line) => line.includes('|||'))
      .map((line) => {
        const [name, bundleId] = line.split('|||');
        return { name: name.trim(), bundleId: (bundleId || '').trim() };
      })
      .filter((a) => a.name && a.name !== '心流锁定器');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not allowed') || msg.includes('1002') || msg.includes('assistive')) {
      return [{ name: '__error__', bundleId: '', error: 'permission' }];
    }
    return [{ name: '__error__', bundleId: '', error: msg }];
  }
}

// ── Enforcement: hide non-allowed apps, switch back ───────────────
function enforce(): void {
  if (enforcing || lockedApps.length === 0) return;
  enforcing = true;

  // Single fast AppleScript: get frontmost app name
  exec(
    `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`,
    { timeout: 3000 },
    (err, stdout) => {
      try {
        if (err || !stdout) return;
        const frontApp = stdout.trim();
        if (!frontApp || allowedSet.has(frontApp)) return;

        // Hide the non-allowed app and switch to first locked app
        const hideCmd = `osascript -e 'tell application "System Events" to set visible of process "${frontApp.replace(/'/g, "'\\''").replace(/"/g, '\\"')}" to false'`;
        const activateCmd = `osascript -e 'tell application "${lockedApps[0].replace(/'/g, "'\\''")}" to activate'`;
        exec(hideCmd);
        exec(activateCmd);

        mainWindow?.webContents.send('focus:blocked', frontApp);
      } finally {
        enforcing = false;
      }
    },
  );
}

function startFocusEnforcement(apps: string[]): void {
  lockedApps = [...apps];
  allowedSet = new Set([...apps, '心流锁定器']);
  focusInterval = setInterval(enforce, 400);
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
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopFocusEnforcement();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
