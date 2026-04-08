import { useState, useEffect, useRef, useCallback } from 'react';

interface AppInfo {
  name: string;
  bundleId: string;
  error?: string;
}

type Phase = 'setup' | 'locked' | 'addApps';

const EMERGENCY_PHRASE = '我确认要解锁';

const C = {
  bg: '#2b1b2e',
  card: '#3a2340',
  border: '#5a3d5e',
  borderActive: '#e88ca5',
  accent: '#e88ca5',
  accentBg: 'rgba(232,140,165,0.12)',
  text: '#f0dde3',
  textDim: 'rgba(240,221,227,0.5)',
  danger: '#d44a6a',
  success: '#7dcda0',
  input: '#321e36',
};

export default function App() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [appError, setAppError] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [minutes, setMinutes] = useState(30);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastBlocked, setLastBlocked] = useState('');
  const [showEmergency, setShowEmergency] = useState(false);
  const [emergencyInput, setEmergencyInput] = useState('');
  const [addPickerApps, setAddPickerApps] = useState<AppInfo[]>([]);
  const [addPickerSelected, setAddPickerSelected] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshApps = useCallback(async () => {
    const list = await window.api.getRunningApps();
    if (list.length === 1 && list[0].name === '__error__') {
      setAppError(list[0].error || 'unknown');
      setApps([]);
    } else {
      setAppError('');
      setApps(list);
    }
  }, []);

  useEffect(() => { refreshApps(); }, [refreshApps]);

  useEffect(() => {
    const cleanup = window.api.onBlocked((appName) => {
      setLastBlocked(appName);
      setTimeout(() => setLastBlocked(''), 2000);
    });
    return cleanup;
  }, []);

  const toggleApp = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const startLock = async () => {
    if (selected.size === 0) return;
    const appNames = Array.from(selected);
    const totalSeconds = minutes * 60;
    await window.api.startLock(appNames, minutes);
    setRemainingSeconds(totalSeconds);
    setElapsedSeconds(0);
    setPhase('locked');
    timerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) { unlock(); return 0; }
        return prev - 1;
      });
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
  };

  const unlock = useCallback(async () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    await window.api.stopLock();
    setPhase('setup');
    setShowEmergency(false);
    setEmergencyInput('');
    setAddPickerApps([]);
    setAddPickerSelected(new Set());
    refreshApps();
  }, [refreshApps]);

  const openAddApps = useCallback(async () => {
    await window.api.expandWindow();
    const list = await window.api.getRunningApps();
    const validList = (list.length === 1 && list[0].name === '__error__') ? [] : list;
    setAddPickerApps(validList.filter((a) => !selected.has(a.name)));
    setAddPickerSelected(new Set());
    setPhase('addApps');
  }, [selected]);

  const confirmAddApps = useCallback(async () => {
    if (addPickerSelected.size > 0) {
      const newApps = Array.from(addPickerSelected);
      await window.api.addApps(newApps);
      setSelected((prev) => {
        const next = new Set(prev);
        newApps.forEach((a) => next.add(a));
        return next;
      });
    }
    await window.api.collapseWindow();
    setPhase('locked');
    setAddPickerApps([]);
    setAddPickerSelected(new Set());
  }, [addPickerSelected]);

  const cancelAddApps = useCallback(async () => {
    await window.api.collapseWindow();
    setPhase('locked');
    setAddPickerApps([]);
    setAddPickerSelected(new Set());
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  // ── Locked: emergency unlock ───────────────────────────────────
  if (phase === 'locked' && showEmergency) {
    const matches = emergencyInput === EMERGENCY_PHRASE;
    return (
      <div style={{ padding: 16, height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: C.bg }}>
        <div style={{ fontSize: '0.8rem', color: C.textDim, marginBottom: 8, textAlign: 'center' }}>
          输入「{EMERGENCY_PHRASE}」解锁
        </div>
        <input
          value={emergencyInput}
          onChange={(e) => setEmergencyInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches) unlock();
            if (e.key === 'Escape') setShowEmergency(false);
          }}
          autoFocus
          style={{
            width: '100%', padding: '6px 10px',
            border: `1px solid ${matches ? C.success : C.border}`,
            borderRadius: 6, background: C.input, color: C.text,
            fontSize: '0.85rem', textAlign: 'center', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'center' }}>
          <button onClick={() => setShowEmergency(false)} style={smallBtnStyle}>返回</button>
          <button
            onClick={() => { if (matches) unlock(); }}
            disabled={!matches}
            style={{
              ...smallBtnStyle,
              background: matches ? C.danger : C.card,
              color: matches ? '#fff' : C.textDim,
              borderColor: matches ? C.danger : C.border,
            }}
          >
            解锁
          </button>
        </div>
      </div>
    );
  }

  // ── Locked: add apps picker ─────────────────────────────────────
  if (phase === 'addApps') {
    return (
      <div style={{ padding: 16, height: '100vh', display: 'flex', flexDirection: 'column', background: C.bg }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: '0.85rem', color: C.text, fontWeight: 600 }}>增加应用</span>
          <span style={{ fontSize: '1rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: C.accent }}>
            {formatTime(remainingSeconds)}
          </span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', marginBottom: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {addPickerApps.map((a) => {
              const sel = addPickerSelected.has(a.name);
              return (
                <button
                  key={a.name}
                  onClick={() => {
                    setAddPickerSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(a.name)) next.delete(a.name); else next.add(a.name);
                      return next;
                    });
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 10px',
                    border: `1px solid ${sel ? C.borderActive : C.border}`,
                    borderRadius: 8,
                    background: sel ? C.accentBg : C.card,
                    color: C.text, cursor: 'pointer',
                    fontSize: '0.8rem', textAlign: 'left', width: '100%',
                  }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: 4,
                    border: `2px solid ${sel ? C.accent : C.border}`,
                    background: sel ? C.accent : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.65rem', color: '#fff', flexShrink: 0,
                  }}>
                    {sel ? '✓' : ''}
                  </span>
                  <span style={{ flex: 1 }}>{a.bundleId || a.name}</span>
                  <span style={{ fontSize: '0.6rem', color: C.textDim }}>{a.name}</span>
                </button>
              );
            })}
            {addPickerApps.length === 0 && (
              <div style={{ textAlign: 'center', padding: 20, color: C.textDim, fontSize: '0.8rem' }}>
                没有其他运行中的应用
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={cancelAddApps} style={{ ...smallBtnStyle, flex: 1, padding: '8px 0', textAlign: 'center' }}>
            取消
          </button>
          <button
            onClick={confirmAddApps}
            disabled={addPickerSelected.size === 0}
            style={{
              flex: 1, padding: '8px 0', border: 'none', borderRadius: 6,
              background: addPickerSelected.size > 0 ? C.accent : C.card,
              color: addPickerSelected.size > 0 ? '#fff' : C.textDim,
              fontSize: '0.8rem', fontWeight: 600,
              cursor: addPickerSelected.size > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            加入 ({addPickerSelected.size})
          </button>
        </div>
      </div>
    );
  }

  // ── Locked: compact timer bar ──────────────────────────────────
  if (phase === 'locked') {
    return (
      <div style={{ padding: '10px 16px', height: '100vh', display: 'flex', flexDirection: 'column', gap: 8, background: C.bg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: C.accent }}>
            {formatTime(remainingSeconds)}
          </div>
          <div style={{ flex: 1, fontSize: '0.7rem', color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {Array.from(selected).join(' + ')}
          </div>
          {lastBlocked && (
            <div style={{ fontSize: '0.65rem', color: C.danger, whiteSpace: 'nowrap' }}>{lastBlocked}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <div style={{ fontSize: '0.6rem', color: C.textDim, flex: 1, display: 'flex', alignItems: 'center' }}>
            锁定中 · {selected.size} 个应用
          </div>
          <button
            onClick={openAddApps}
            style={{ ...smallBtnStyle, fontSize: '0.65rem', padding: '3px 8px' }}
          >
            增加应用
          </button>
          <button
            onClick={() => { setEmergencyInput(''); setShowEmergency(true); }}
            style={{ ...smallBtnStyle, fontSize: '0.65rem', padding: '3px 8px', opacity: 0.4 }}
          >
            解锁
          </button>
        </div>
      </div>
    );
  }

  // ── Setup view ─────────────────────────────────────────────────
  return (
    <div style={{ padding: 20, height: '100vh', display: 'flex', flexDirection: 'column', background: C.bg }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: C.accent, margin: 0 }}>
          心流强制锁定器
        </h1>
        <p style={{ fontSize: '0.75rem', color: C.textDim, marginTop: 4 }}>
          锁定指定应用，屏蔽一切干扰，进入心流状态
        </p>
      </div>

      <div style={{ flex: 1, overflow: 'auto', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: '0.8rem', color: C.textDim }}>运行中的应用</span>
          <button onClick={refreshApps} style={{ ...smallBtnStyle, fontSize: '0.7rem' }}>刷新</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {apps.map((a) => {
            const sel = selected.has(a.name);
            return (
              <button
                key={a.name}
                onClick={() => toggleApp(a.name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px',
                  border: `1px solid ${sel ? C.borderActive : C.border}`,
                  borderRadius: 8,
                  background: sel ? C.accentBg : C.card,
                  color: C.text, cursor: 'pointer',
                  fontSize: '0.85rem', textAlign: 'left', width: '100%',
                }}
              >
                <span style={{
                  width: 18, height: 18, borderRadius: 4,
                  border: `2px solid ${sel ? C.accent : C.border}`,
                  background: sel ? C.accent : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.7rem', color: '#fff', flexShrink: 0,
                }}>
                  {sel ? '✓' : ''}
                </span>
                <span style={{ flex: 1 }}>{a.bundleId || a.name}</span>
                <span style={{ fontSize: '0.65rem', color: C.textDim }}>{a.name}</span>
              </button>
            );
          })}
          {apps.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20, color: appError ? C.danger : C.textDim, fontSize: '0.8rem' }}>
              {appError === 'powershell' ? (
                <>
                  <div style={{ marginBottom: 8 }}>PowerShell 初始化失败</div>
                  <div style={{ fontSize: '0.7rem', color: C.textDim }}>
                    请确保系统中已安装 PowerShell，然后重启应用
                  </div>
                </>
              ) : appError ? (
                <>
                  <div style={{ marginBottom: 8 }}>获取应用列表失败</div>
                  <div style={{ fontSize: '0.7rem', color: C.textDim }}>{appError}</div>
                </>
              ) : (
                '加载中...'
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: '0.85rem', color: C.text }}>锁定时长</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {[15, 30, 60, 90, 120].map((m) => (
              <button
                key={m}
                onClick={() => setMinutes(m)}
                style={{
                  padding: '4px 10px', borderRadius: 6,
                  border: `1px solid ${minutes === m ? C.borderActive : C.border}`,
                  background: minutes === m ? C.accentBg : 'transparent',
                  color: minutes === m ? C.accent : C.text,
                  cursor: 'pointer', fontSize: '0.75rem',
                }}
              >
                {m}分
              </button>
            ))}
          </div>
          <input
            type="number" value={minutes} min={1} max={480}
            placeholder="自定义时间"
            onChange={(e) => setMinutes(Math.max(1, parseInt(e.target.value) || 1))}
            style={{
              width: 80, padding: '4px 6px',
              border: `1px solid ${C.border}`, borderRadius: 6,
              background: C.input, color: C.text,
              fontSize: '0.8rem', textAlign: 'center',
            }}
          />
          <span style={{ fontSize: '0.75rem', color: C.textDim }}>分</span>
        </div>

        <button
          onClick={startLock}
          disabled={selected.size === 0}
          style={{
            width: '100%', padding: '10px 0', border: 'none', borderRadius: 8,
            background: selected.size > 0 ? C.accent : C.card,
            color: selected.size > 0 ? '#fff' : C.textDim,
            fontSize: '0.95rem', fontWeight: 600,
            cursor: selected.size > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          开始锁定 ({selected.size} 个应用, {minutes} 分钟)
        </button>
      </div>
    </div>
  );
}

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  border: '1px solid #5a3d5e',
  borderRadius: 5,
  background: 'transparent',
  color: '#f0dde3',
  cursor: 'pointer',
  fontSize: '0.75rem',
};
