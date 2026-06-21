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

const LINE_STYLE = {
  error:   { color: 'var(--color-text-danger)' },
  warn:    { color: 'var(--color-text-warning)' },
  success: { color: 'var(--color-text-success)', fontWeight: '500' },
  info:    { color: 'var(--color-text-primary)' },
};

const STATUS = {
  running: { label: 'DEPLOYING', bg: 'var(--color-background-info)',    color: 'var(--color-text-info)',    dot: 'var(--color-text-info)',    pulse: true  },
  success: { label: 'SUCCESS',   bg: 'var(--color-background-success)', color: 'var(--color-text-success)', dot: 'var(--color-text-success)', pulse: false },
  failed:  { label: 'FAILED',    bg: 'var(--color-background-danger)',  color: 'var(--color-text-danger)',  dot: 'var(--color-text-danger)',  pulse: false },
  idle:    { label: 'IDLE',      bg: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)', dot: 'var(--color-text-secondary)', pulse: false },
};

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
          setHistory(prev => [msg.deploy, ...prev.filter(d => d.id !== msg.deploy.id)].slice(0,20));
          setSelectedId(msg.deploy.id);
          setElapsed(0);
        }
        if (msg.type === 'log') {
          setHistory(prev => prev.map(d => d.id === msg.deployId ? { ...d, lines: [...(d.lines||[]), msg.line] } : d));
          setCurrent(prev => prev?.id === msg.deployId ? { ...prev, lines: [...(prev.lines||[]), msg.line] } : prev);
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

  const content = (
    <div style={{ padding: inline ? '16px 0 0' : '0' }}>
      <style>{`@keyframes dm-pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      {/* Top bar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'13px', fontWeight:'500', color:'var(--color-text-primary)' }}>Deploy Monitor</span>
          <span style={{ display:'inline-flex', alignItems:'center', gap:'5px', background: connected ? 'var(--color-background-success)' : 'var(--color-background-danger)', color: connected ? 'var(--color-text-success)' : 'var(--color-text-danger)', fontSize:'11px', padding:'3px 10px', borderRadius:'20px', fontWeight:'500' }}>
            <span style={{ width:'6px', height:'6px', borderRadius:'50%', background: connected ? 'var(--color-text-success)' : 'var(--color-text-danger)', display:'inline-block' }} />
            {connected ? 'Connected' : 'Reconnecting...'}
          </span>
          {current && <span style={{ fontSize:'12px', color:'var(--color-text-secondary)' }}>⏱ {formatDuration(elapsed)}</span>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <span style={{ background: sc.bg, color: sc.color, fontSize:'11px', padding:'3px 10px', borderRadius:'20px', fontWeight:'500', display:'inline-flex', alignItems:'center', gap:'5px' }}>
            <span style={{ width:'6px', height:'6px', borderRadius:'50%', background: sc.dot, display:'inline-block', animation: sc.pulse ? 'dm-pulse 1.2s infinite' : 'none' }} />
            {sc.label}
          </span>
          {!inline && onClose && (
            <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--color-text-secondary)', fontSize:'18px', lineHeight:1, padding:'2px 4px' }}>×</button>
          )}
        </div>
      </div>

      {/* Main layout */}
      <div style={{ display:'grid', gridTemplateColumns:'190px 1fr', gap:'12px', alignItems:'start' }}>

        {/* Left: History */}
        <div style={{ background:'var(--color-background-secondary)', border:'0.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-md)', overflow:'hidden' }}>
          <div style={{ padding:'8px 12px', borderBottom:'0.5px solid var(--color-border-tertiary)' }}>
            <span style={{ fontSize:'10px', fontWeight:'500', color:'var(--color-text-secondary)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Deploy History</span>
          </div>
          {history.length === 0 && (
            <div style={{ padding:'20px 12px', fontSize:'11px', color:'var(--color-text-secondary)', textAlign:'center' }}>ยังไม่มี deploy</div>
          )}
          {history.map((d, i) => {
            const isSelected = selectedId === d.id;
            const sc2 = STATUS[d.status] || STATUS.idle;
            return (
              <div key={d.id} onClick={() => setSelectedId(d.id)}
                style={{ padding:'8px 12px', cursor:'pointer', borderLeft: isSelected ? `3px solid ${sc2.dot}` : '3px solid transparent', background: isSelected ? sc2.bg : 'transparent', borderBottom: i < history.length-1 ? '0.5px solid var(--color-border-tertiary)' : 'none' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'5px', marginBottom:'2px' }}>
                  <span style={{ width:'5px', height:'5px', borderRadius:'50%', background: sc2.dot, flexShrink:0 }} />
                  <span style={{ fontSize:'10px', fontWeight:'500', color: sc2.color }}>{sc2.label}</span>
                  {d.durationSec && <span style={{ fontSize:'10px', color:'var(--color-text-secondary)', marginLeft:'auto' }}>{formatDuration(d.durationSec)}</span>}
                </div>
                <div style={{ fontSize:'10px', color:'var(--color-text-secondary)' }}>{formatTime(d.startedAt)}</div>
              </div>
            );
          })}
        </div>

        {/* Right: Log viewer */}
        <div style={{ background:'var(--color-background-secondary)', border:'0.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-md)', overflow:'hidden' }}>
          {selectedDeploy ? (
            <>
              <div style={{ padding:'8px 14px', borderBottom:'0.5px solid var(--color-border-tertiary)', display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
                <span style={{ fontSize:'11px', color:'var(--color-text-secondary)' }}>Started: {formatTime(selectedDeploy.startedAt)}</span>
                {selectedDeploy.finishedAt && <>
                  <span style={{ color:'var(--color-border-tertiary)' }}>·</span>
                  <span style={{ fontSize:'11px', color:'var(--color-text-secondary)' }}>Finished: {formatTime(selectedDeploy.finishedAt)}</span>
                  <span style={{ color:'var(--color-border-tertiary)' }}>·</span>
                  <span style={{ fontSize:'11px', color:'var(--color-text-secondary)' }}>Duration: {formatDuration(selectedDeploy.durationSec)}</span>
                </>}
                <span style={{ marginLeft:'auto', fontSize:'10px', color:'var(--color-text-secondary)' }}>{selectedDeploy.lines?.length || 0} lines</span>
              </div>
              <div ref={logRef} style={{ padding:'10px 14px', fontFamily:'var(--font-mono)', fontSize:'11px', lineHeight:'1.7', maxHeight:'400px', overflowY:'auto' }}>
                {(selectedDeploy.lines || []).map((line, i) => (
                  <div key={i} style={{ display:'flex', gap:'10px', marginBottom:'1px' }}>
                    <span style={{ color:'var(--color-text-secondary)', minWidth:'24px', textAlign:'right', flexShrink:0, fontSize:'10px', paddingTop:'2px' }}>{i+1}</span>
                    <span style={{ ...(LINE_STYLE[line.level] || LINE_STYLE.info), wordBreak:'break-all', whiteSpace:'pre-wrap' }}>{line.text}</span>
                  </div>
                ))}
                {selectedDeploy.status === 'running' && (
                  <div style={{ display:'flex', gap:'8px', alignItems:'center', marginTop:'6px' }}>
                    <span style={{ color:'var(--color-text-info)', animation:'dm-pulse 1s infinite' }}>▋</span>
                    <span style={{ fontSize:'11px', color:'var(--color-text-secondary)' }}>รอ output...</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ padding:'40px', textAlign:'center', color:'var(--color-text-secondary)', fontSize:'13px' }}>
              เลือก deploy จากด้านซ้ายครับ
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (inline) return content;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={{ width:'900px', maxWidth:'96vw', maxHeight:'85vh', background:'var(--color-background-primary)', borderRadius:'var(--border-radius-lg)', border:'0.5px solid var(--color-border-tertiary)', overflow:'auto', padding:'20px', boxShadow:'0 20px 60px rgba(0,0,0,0.15)' }}>
        {content}
      </div>
    </div>
  );
}
