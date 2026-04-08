interface AppInfo {
  name: string;
  bundleId: string;
  error?: string;
}

interface LockFocusApi {
  getRunningApps(): Promise<AppInfo[]>;
  startLock(apps: string[], minutes: number): Promise<void>;
  stopLock(): Promise<void>;
  addApps(apps: string[]): Promise<void>;
  expandWindow(): Promise<void>;
  collapseWindow(): Promise<void>;
  onBlocked(callback: (appName: string) => void): () => void;
}

declare global {
  interface Window {
    api: LockFocusApi;
  }
}

export {};
