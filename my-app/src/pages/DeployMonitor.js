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
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

const LINE_COLOR = {
  error:   '#FF6B6B',
  warn:    '#FFD93D',
  success: '#6BCB77',
  info:    '#C9D1D9',
};

const STATUS_CONFIG = {
  running: { label: 'DEPLOYING', bg: '#1a3a5c', color: '#5DCAA5', dot: '#5DCAA5', pulse: true  },
  success: { label: 'SUCCESS',   bg: '#0d2b1e', color: '#6BCB77', dot: '#6BCB77', pulse: false },
  failed:  { label: 'FAILED',    bg: '#2b0d0d', color: '#FF6B6B', dot: '#FF6B6B', pulse: false },
  idle:    { label: 'IDLE',      bg: '#161b22', color: '#8b949e', dot: '#8b949e', pulse: false },
};

export default function DeployMonitor({ onClose, inline = false }) {
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
          setHistory(prev => prev.map(d => d.id === msg.deployId ? { ...d, lines: [...d.lines, msg.line] } : d));
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
  const sc = STATUS_CONFIG[statusKey] || STATUS_CONFIG.idle;

  return (
    <div style={ inline ? { display:'flex', flex:1, height:'100%' } : { position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000 }}
    onMouseDown={e => { if (!inline && e.target === e.currentTarget) onClose?.(); }}>
      <div style={{ width:'900px', maxWidth:'96vw', height:'85vh', background:'#0d1117', borderRadius:'12px', display:'flex', flexDirection:'column', overflow:'hidden', border:'1px solid #30363d', boxShadow:'0 24px 64px rgba(0,0,0,0.6)', fontFamily:"'Consolas','Monaco','Courier New',monospace" }}>

        {/* Header */}
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #21262d', display:'flex', alignItems:'center', gap:'12px', flexShrink:0, background:'#161b22' }}>
          <span style={{ fontSize:'15px', fontWeight:'600', color:'#e6edf3' }}>🚀 Deploy Monitor</span>
          <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
            <div style={{ width:'8px', height:'8px', borderRadius:'50%', background: connected?'#6BCB77':'#FF6B6B', boxShadow: connected?'0 0 6px #6BCB77':'none' }} />
            <span style={{ fontSize:'11px', color: connected?'#6BCB77':'#FF6B6B' }}>{connected ? 'Connected' : 'Reconnecting...'}</span>
          </div>
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'8px' }}>
            {current && <span style={{ fontSize:'12px', color:'#8b949e' }}>⏱ {formatDuration(elapsed)}</span>}
            <div style={{ display:'flex', alignItems:'center', gap:'6px', background:sc.bg, border:`1px solid ${sc.dot}33`, borderRadius:'20px', padding:'4px 12px' }}>
              <div style={{ width:'7px', height:'7px', borderRadius:'50%', background:sc.dot, boxShadow: sc.pulse?`0 0 8px ${sc.dot}`:'none', animation: sc.pulse?'pulse 1.2s infinite':'none' }} />
              <span style={{ fontSize:'11px', fontWeight:'600', color:sc.color, letterSpacing:'0.08em' }}>{sc.label}</span>
            </div>
            <button onClick={onClose} style={{ background:'none', border:'none', color:'#8b949e', cursor:'pointer', fontSize:'18px', lineHeight:1, padding:'2px 6px' }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

          {/* History */}
          <div style={{ width:'220px', flexShrink:0, borderRight:'1px solid #21262d', overflowY:'auto', background:'#161b22' }}>
            <div style={{ padding:'10px 12px 6px', fontSize:'10px', color:'#8b949e', fontWeight:'600', letterSpacing:'0.08em', textTransform:'uppercase' }}>Deploy History</div>
            {history.length === 0 && <div style={{ padding:'20px 12px', fontSize:'11px', color:'#484f58', textAlign:'center' }}>ยังไม่มี deploy</div>}
            {history.map(d => {
              const isSelected = selectedId === d.id;
              const sc2 = STATUS_CONFIG[d.status] || STATUS_CONFIG.idle;
              return (
                <div key={d.id} onClick={() => setSelectedId(d.id)}
                  style={{ padding:'10px 12px', cursor:'pointer', borderLeft: isSelected?`3px solid ${sc2.dot}`:'3px solid transparent', background: isSelected?'#1c2128':'transparent', borderBottom:'1px solid #21262d21' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'3px' }}>
                    <div style={{ width:'6px', height:'6px', borderRadius:'50%', background:sc2.dot, flexShrink:0 }} />
                    <span style={{ fontSize:'10px', color:sc2.color, fontWeight:'600' }}>{sc2.label}</span>
                    {d.durationSec && <span style={{ fontSize:'10px', color:'#484f58', marginLeft:'auto' }}>{formatDuration(d.durationSec)}</span>}
                  </div>
                  <div style={{ fontSize:'10px', color:'#8b949e' }}>{formatTime(d.startedAt)}</div>
                </div>
              );
            })}
          </div>

          {/* Log viewer */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            {selectedDeploy ? (
              <>
                <div style={{ padding:'8px 16px', borderBottom:'1px solid #21262d', display:'flex', alignItems:'center', gap:'8px', flexShrink:0, background:'#161b22' }}>
                  <span style={{ fontSize:'11px', color:'#8b949e' }}>Started: {formatTime(selectedDeploy.startedAt)}</span>
                  {selectedDeploy.finishedAt && <>
                    <span style={{ color:'#30363d' }}>·</span>
                    <span style={{ fontSize:'11px', color:'#8b949e' }}>Finished: {formatTime(selectedDeploy.finishedAt)}</span>
                    <span style={{ color:'#30363d' }}>·</span>
                    <span style={{ fontSize:'11px', color:'#8b949e' }}>Duration: {formatDuration(selectedDeploy.durationSec)}</span>
                  </>}
                  <span style={{ marginLeft:'auto', fontSize:'10px', color:'#484f58' }}>{selectedDeploy.lines?.length||0} lines</span>
                </div>
                <div ref={logRef} style={{ flex:1, overflowY:'auto', padding:'12px 16px', background:'#0d1117', scrollbarWidth:'thin', scrollbarColor:'#30363d #0d1117' }}>
                  {(selectedDeploy.lines||[]).map((line, i) => (
                    <div key={i} style={{ display:'flex', gap:'12px', marginBottom:'2px', fontSize:'12px', lineHeight:'1.6' }}>
                      <span style={{ color:'#484f58', flexShrink:0, fontSize:'10px', paddingTop:'2px' }}>{String(i+1).padStart(3,' ')}</span>
                      <span style={{ color: LINE_COLOR[line.level]||'#C9D1D9', wordBreak:'break-all', whiteSpace:'pre-wrap' }}>{line.text}</span>
                    </div>
                  ))}
                  {selectedDeploy.status === 'running' && (
                    <div style={{ display:'flex', gap:'8px', alignItems:'center', marginTop:'8px' }}>
                      <span style={{ color:'#5DCAA5', fontSize:'12px', animation:'blink 1s infinite' }}>▋</span>
                      <span style={{ color:'#484f58', fontSize:'11px' }}>รอ output...</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:'12px' }}>
                <div style={{ fontSize:'32px' }}>🚀</div>
                <div style={{ fontSize:'13px', color:'#484f58' }}>เลือก deploy จากด้านซ้าย</div>
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
        @keyframes blink  { 0%,100%{opacity:1}50%{opacity:0} }
      `}</style>
    </div>
  );
}