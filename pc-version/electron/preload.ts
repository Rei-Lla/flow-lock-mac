import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getRunningApps: () => ipcRenderer.invoke('apps:getRunning'),
  startLock: (apps: string[], minutes: number) =>
    ipcRenderer.invoke('lock:start', apps, minutes),
  stopLock: () => ipcRenderer.invoke('lock:stop'),
  addApps: (apps: string[]) => ipcRenderer.invoke('lock:addApps', apps),
  expandWindow: () => ipcRenderer.invoke('lock:expandWindow'),
  collapseWindow: () => ipcRenderer.invoke('lock:collapseWindow'),
  onBlocked: (callback: (appName: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, appName: string) => callback(appName);
    ipcRenderer.on('focus:blocked', handler);
    return () => ipcRenderer.removeListener('focus:blocked', handler);
  },
});
