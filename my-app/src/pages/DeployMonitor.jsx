import React, { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = 'ws://10.101.87.126:9001';

function formatDuration(sec) {
  if (!sec) return '';
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function formatTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function formatTimeFull(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

const STATUS = {
  running: { label: 'DEPLOYING', bg: '#E6F1FB', color: '#185FA5', dot: '#185FA5', pulse: true  },
  success: { label: 'SUCCESS',   bg: '#EAF3DE', color: '#0F6E56', dot: '#0F6E56', pulse: false },
  failed:  { label: 'FAILED',    bg: '#FCEBEB', color: '#791F1F', dot: '#c0392b', pulse: false },
  idle:    { label: 'IDLE',      bg: '#f0f0f0', color: '#888',    dot: '#888',    pulse: false },
};

function getLineStyle(level) {
  switch (level) {
    case 'error':   return { color: '#791F1F', bg: '#FCEBEB' };
    case 'warn':    return { color: '#856404', bg: '#FFF8E1' };
    case 'success': return { color: '#0F6E56', bg: '#EAF3DE', fontWeight: '500' };
    default:        return { color: '#1a3a5c', bg: 'transparent' };
  }
}

export default function DeployMonitor({ inline = false, onClose }) {
  const [history, setHistory]       = useState([]);
  const [current, setCurrent]       = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [connected, setConnected]   = useState(false);
  const [elapsed, setElapsed]       = useState(0);
  const logRef   = useRef(null);
  const wsRef    = useRef(null);
  const timerRef = useRef(null);

  const scrollBottom = useCallback(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen  = () => setConnected(true);
      ws.onclose = () => { setConnected(false); setTimeout(connect, 3000); };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'init') {
          setHistory(msg.history || []);
          setCurrent(msg.current || null);
          if (msg.current) setSelectedId(msg.current.id);
          else if (msg.history?.length) setSelectedId(msg.history[0].id);
        }
        if (msg.type === 'deploy_start') {
          setCurrent(msg.deploy);
          setHistory(prev => [msg.deploy, ...prev.filter(d => d.id !== msg.deploy.id)].slice(0, 20));
          setSelectedId(msg.deploy.id);
          setElapsed(0);
        }
        if (msg.type === 'log') {
          setHistory(prev => prev.map(d => d.id === msg.deployId ? { ...d, lines: [...(d.lines || []), msg.line] } : d));
          setCurrent(prev => prev?.id === msg.deployId ? { ...prev, lines: [...(prev.lines || []), msg.line] } : prev);
          setTimeout(scrollBottom, 50);
        }
        if (msg.type === 'deploy_end') {
          setCurrent(null);
          setHistory(prev => prev.map(d => d.id === msg.deploy.id ? msg.deploy : d));
        }
      };
    };
    connect();
    return () => { wsRef.current?.close(); clearInterval(timerRef.current); };
  }, [scrollBottom]);

  useEffect(() => {
    clearInterval(timerRef.current);
    if (current?.status === 'running') {
      timerRef.current = setInterval(() => {
        setElapsed(Math.round((Date.now() - new Date(current.startedAt).getTime()) / 1000));
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [current]);

  const selectedDeploy = selectedId ? (history.find(d => d.id === selectedId) || current) : null;
  const statusKey = current ? 'running' : selectedDeploy?.status || 'idle';
  const sc = STATUS[statusKey] || STATUS.idle;

  const lines = selectedDeploy?.lines || [];
  const errorCount = lines.filter(l => l.level === 'error').length;
  const warnCount  = lines.filter(l => l.level === 'warn').length;

  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', height: inline ? 'calc(100vh - 160px)' : '100%', background: '#f0f2f5', borderRadius: '8px', padding: '12px', gap: '10px' }}>
      <style>{`@keyframes dm-pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>Deploy Monitor</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: connected ? '#EAF3DE' : '#FCEBEB', color: connected ? '#0F6E56' : '#791F1F', fontSize: '11px', padding: '3px 10px', borderRadius: '20px', fontWeight: '500' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: connected ? '#0F6E56' : '#c0392b', display: 'inline-block' }} />
            {connected ? 'Connected' : 'Reconnecting...'}
          </span>
          {current && <span style={{ fontSize: '12px', color: '#888' }}>⏱ {formatDuration(elapsed)}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ background: sc.bg, color: sc.color, fontSize: '11px', padding: '3px 10px', borderRadius: '20px', fontWeight: '500', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: sc.dot, display: 'inline-block', animation: sc.pulse ? 'dm-pulse 1.2s infinite' : 'none' }} />
            {sc.label}
          </span>
          {!inline && onClose && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: '18px', lineHeight: 1 }}>×</button>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: '10px', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* History */}
        <div style={{ background: '#ffffff', border: '0.5px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 12px', borderBottom: '0.5px solid #e0e0e0', flexShrink: 0 }}>
            <span style={{ fontSize: '10px', fontWeight: '500', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Deploy History</span>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {history.length === 0 && (
              <div style={{ padding: '20px 12px', fontSize: '11px', color: '#aaa', textAlign: 'center' }}>ยังไม่มี deploy</div>
            )}
            {history.map((d, i) => {
              const isSelected = selectedId === d.id;
              const sc2 = STATUS[d.status] || STATUS.idle;
              return (
                <div key={d.id} onClick={() => setSelectedId(d.id)}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderLeft: isSelected ? `2px solid ${sc2.dot}` : '2px solid transparent', background: isSelected ? sc2.bg : 'transparent', borderBottom: i < history.length - 1 ? '0.5px solid #f0f0f0' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: sc2.dot, flexShrink: 0 }} />
                    <span style={{ fontSize: '10px', fontWeight: '500', color: sc2.color }}>{sc2.label}</span>
                    {d.durationSec && <span style={{ fontSize: '10px', color: '#aaa', marginLeft: 'auto' }}>{formatDuration(d.durationSec)}</span>}
                  </div>
                  <div style={{ fontSize: '10px', color: '#aaa' }}>{formatTime(d.startedAt)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Log viewer */}
        <div style={{ background: '#ffffff', border: '0.5px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {selectedDeploy ? (
            <>
              {/* Meta bar */}
              <div style={{ padding: '8px 14px', borderBottom: '0.5px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', flexShrink: 0, background: '#f8f9fa' }}>
                <span style={{ fontSize: '11px', color: '#888' }}>Started: {formatTimeFull(selectedDeploy.startedAt)}</span>
                {selectedDeploy.finishedAt && <>
                  <span style={{ color: '#ddd' }}>·</span>
                  <span style={{ fontSize: '11px', color: '#888' }}>Finished: {formatTimeFull(selectedDeploy.finishedAt)}</span>
                  <span style={{ color: '#ddd' }}>·</span>
                  <span style={{ fontSize: '11px', color: '#888' }}>Duration: {formatDuration(selectedDeploy.durationSec)}</span>
                </>}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {errorCount > 0 && <span style={{ fontSize: '11px', color: '#791F1F' }}>✕ {errorCount}</span>}
                  {warnCount > 0  && <span style={{ fontSize: '11px', color: '#856404' }}>⚠ {warnCount}</span>}
                  <span style={{ fontSize: '10px', color: '#aaa' }}>{lines.length} lines</span>
                </div>
              </div>

              {/* Log lines */}
              <div ref={logRef} style={{ flex: 1, overflowY: 'auto', fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: '11px', lineHeight: '1.8' }}>
                {lines.map((line, i) => {
                  const ls = getLineStyle(line.level);
                  return (
                    <div key={i} style={{ display: 'flex', background: ls.bg, minHeight: '20px' }}>
                      <span style={{ color: '#ccc', minWidth: '40px', textAlign: 'right', paddingRight: '12px', flexShrink: 0, fontSize: '10px', paddingTop: '2px', userSelect: 'none', borderRight: '0.5px solid #eee', marginRight: '12px', background: '#f8f9fa' }}>{i + 1}</span>
                      <span style={{ color: ls.color, fontWeight: ls.fontWeight || '400', wordBreak: 'break-all', whiteSpace: 'pre-wrap', paddingRight: '12px' }}>{line.text}</span>
                    </div>
                  );
                })}
                {selectedDeploy.status === 'running' && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '6px 14px' }}>
                    <span style={{ color: '#185FA5', animation: 'dm-pulse 1s infinite' }}>▋</span>
                    <span style={{ fontSize: '11px', color: '#aaa' }}>รอ output...</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: '13px' }}>
              เลือก deploy จากด้านซ้ายครับ
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (inline) return content;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={{ width: '900px', maxWidth: '96vw', height: '85vh', background: '#f0f2f5', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column' }}>
        {content}
      </div>
    </div>
  );
}