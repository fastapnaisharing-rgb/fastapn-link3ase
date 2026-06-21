import React, { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL      = 'ws://10.101.87.126:9001';
const HEALTH_URL  = 'http://10.101.87.126:4000/health';

function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
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
  running: { label:'DEPLOYING', bg:'#E6F1FB', color:'#185FA5', dot:'#185FA5', pulse:true  },
  success: { label:'SUCCESS',   bg:'#EAF3DE', color:'#0F6E56', dot:'#0F6E56', pulse:false },
  failed:  { label:'FAILED',    bg:'#FCEBEB', color:'#791F1F', dot:'#c0392b', pulse:false },
  idle:    { label:'IDLE',      bg:'#f0f0f0', color:'#888',    dot:'#888',    pulse:false },
};

function getLineStyle(level) {
  switch (level) {
    case 'error':   return { color:'#791F1F', bg:'#FCEBEB' };
    case 'warn':    return { color:'#856404', bg:'#FFF8E1' };
    case 'success': return { color:'#0F6E56', bg:'#EAF3DE', fontWeight:'500' };
    default:        return { color:'#1a3a5c', bg:'transparent' };
  }
}

function StatusDot({ ok }) {
  return <span style={{ width:'6px', height:'6px', borderRadius:'50%', background: ok ? '#0F6E56' : '#c0392b', display:'inline-block', flexShrink:0 }} />;
}

function ProgressBar({ pct, color }) {
  const c = pct > 85 ? '#c0392b' : pct > 65 ? '#856404' : color || '#0F6E56';
  return (
    <div style={{ background:'#f0f0f0', borderRadius:'20px', height:'4px', overflow:'hidden', margin:'4px 0' }}>
      <div style={{ height:'100%', borderRadius:'20px', background:c, width:`${Math.min(pct,100)}%` }} />
    </div>
  );
}

export default function DeployMonitor({ inline = false, onClose }) {
  const [history, setHistory]       = useState([]);
  const [current, setCurrent]       = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [connected, setConnected]   = useState(false);
  const [elapsed, setElapsed]       = useState(0);
  const [health, setHealth]         = useState(null);
  const logRef   = useRef(null);
  const wsRef    = useRef(null);
  const timerRef = useRef(null);

  const scrollBottom = useCallback(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, []);

  // WebSocket
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
          setHistory(prev => prev.map(d => d.id === msg.deployId ? { ...d, lines:[...(d.lines||[]),msg.line] } : d));
          setCurrent(prev => prev?.id === msg.deployId ? { ...prev, lines:[...(prev.lines||[]),msg.line] } : prev);
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

  // Elapsed timer
  useEffect(() => {
    clearInterval(timerRef.current);
    if (current?.status === 'running') {
      timerRef.current = setInterval(() => {
        setElapsed(Math.round((Date.now() - new Date(current.startedAt).getTime()) / 1000));
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [current]);

  // Health polling
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const r = await fetch(HEALTH_URL);
        const d = await r.json();
        setHealth(d);
      } catch { setHealth(null); }
    };
    fetchHealth();
    const iv = setInterval(fetchHealth, 30000);
    return () => clearInterval(iv);
  }, []);

  const selectedDeploy = selectedId ? (history.find(d => d.id === selectedId) || current) : null;
  const statusKey = current ? 'running' : selectedDeploy?.status || 'idle';
  const sc = STATUS[statusKey] || STATUS.idle;
  const lines = selectedDeploy?.lines || [];
  const errorCount = lines.filter(l => l.level === 'error').length;
  const warnCount  = lines.filter(l => l.level === 'warn').length;

  const content = (
    <div style={{ display:'flex', flexDirection:'column', height: inline ? 'calc(100vh - 160px)' : '100%', background:'#f0f2f5', borderRadius:'8px', overflow:'hidden' }}>
      <style>{`@keyframes dm-pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      {/* Header */}
      <div style={{ padding:'10px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', background:'white', borderBottom:'0.5px solid #e0e0e0', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'13px', fontWeight:'500', color:'#1a3a5c' }}>Deploy Monitor</span>
          <span style={{ display:'inline-flex', alignItems:'center', gap:'5px', background: connected ? '#EAF3DE' : '#FCEBEB', color: connected ? '#0F6E56' : '#791F1F', fontSize:'11px', padding:'3px 10px', borderRadius:'20px', fontWeight:'500' }}>
            <span style={{ width:'6px', height:'6px', borderRadius:'50%', background: connected ? '#0F6E56' : '#c0392b', display:'inline-block' }} />
            {connected ? 'Connected' : 'Reconnecting...'}
          </span>
          {current && <span style={{ fontSize:'12px', color:'#888' }}>⏱ {formatDuration(elapsed)}</span>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <span style={{ background:sc.bg, color:sc.color, fontSize:'11px', padding:'3px 10px', borderRadius:'20px', fontWeight:'500', display:'inline-flex', alignItems:'center', gap:'5px' }}>
            <span style={{ width:'6px', height:'6px', borderRadius:'50%', background:sc.dot, display:'inline-block', animation: sc.pulse ? 'dm-pulse 1.2s infinite' : 'none' }} />
            {sc.label}
          </span>
          {!inline && onClose && <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#888', fontSize:'18px', lineHeight:1 }}>×</button>}
        </div>
      </div>

      {/* History + Log */}
      <div style={{ display:'grid', gridTemplateColumns:'160px 1fr', flex:1, overflow:'hidden', minHeight:0 }}>

        {/* History */}
        <div style={{ background:'white', borderRight:'0.5px solid #e0e0e0', display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'7px 12px', borderBottom:'0.5px solid #e0e0e0', flexShrink:0 }}>
            <span style={{ fontSize:'10px', fontWeight:'500', color:'#888', textTransform:'uppercase', letterSpacing:'0.05em' }}>History</span>
          </div>
          <div style={{ overflowY:'auto', flex:1 }}>
            {history.length === 0 && <div style={{ padding:'20px 12px', fontSize:'11px', color:'#aaa', textAlign:'center' }}>ยังไม่มี deploy</div>}
            {history.map((d, i) => {
              const isSelected = selectedId === d.id;
              const sc2 = STATUS[d.status] || STATUS.idle;
              return (
                <div key={d.id} onClick={() => setSelectedId(d.id)}
                  style={{ padding:'7px 12px', cursor:'pointer', borderLeft: isSelected ? `2px solid ${sc2.dot}` : '2px solid transparent', background: isSelected ? sc2.bg : 'transparent', borderBottom: i < history.length-1 ? '0.5px solid #f0f0f0' : 'none' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:'2px' }}>
                    <span style={{ width:'4px', height:'4px', borderRadius:'50%', background:sc2.dot }} />
                    <span style={{ fontSize:'10px', fontWeight:'500', color:sc2.color }}>{sc2.label}</span>
                    {d.durationSec && <span style={{ fontSize:'10px', color:'#aaa', marginLeft:'auto' }}>{formatDuration(d.durationSec)}</span>}
                  </div>
                  <div style={{ fontSize:'10px', color:'#aaa' }}>{formatTime(d.startedAt)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Log */}
        <div style={{ display:'flex', flexDirection:'column', background:'white', overflow:'hidden' }}>
          {selectedDeploy ? (
            <>
              <div style={{ padding:'7px 14px', borderBottom:'0.5px solid #e0e0e0', display:'flex', alignItems:'center', gap:'8px', background:'#f8f9fa', flexShrink:0 }}>
                <span style={{ fontSize:'10px', color:'#888' }}>Started: {formatTimeFull(selectedDeploy.startedAt)}</span>
                {selectedDeploy.finishedAt && <>
                  <span style={{ color:'#ddd' }}>·</span>
                  <span style={{ fontSize:'10px', color:'#888' }}>Finished: {formatTimeFull(selectedDeploy.finishedAt)}</span>
                  <span style={{ color:'#ddd' }}>·</span>
                  <span style={{ fontSize:'10px', color:'#888' }}>{formatDuration(selectedDeploy.durationSec)}</span>
                </>}
                <div style={{ marginLeft:'auto', display:'flex', gap:'8px' }}>
                  {errorCount > 0 && <span style={{ fontSize:'10px', color:'#791F1F' }}>✕ {errorCount}</span>}
                  {warnCount  > 0 && <span style={{ fontSize:'10px', color:'#856404' }}>⚠ {warnCount}</span>}
                  <span style={{ fontSize:'10px', color:'#aaa' }}>{lines.length} lines</span>
                </div>
              </div>
              <div ref={logRef} style={{ flex:1, overflowY:'auto', fontFamily:'Consolas,Monaco,"Courier New",monospace', fontSize:'11px', lineHeight:'1.8' }}>
                {lines.map((line, i) => {
                  const ls = getLineStyle(line.level);
                  return (
                    <div key={i} style={{ display:'flex', background:ls.bg, minHeight:'20px' }}>
                      <span style={{ color:'#ccc', minWidth:'40px', textAlign:'right', paddingRight:'12px', flexShrink:0, fontSize:'10px', paddingTop:'2px', userSelect:'none', borderRight:'0.5px solid #eee', marginRight:'12px', background:'#f8f9fa' }}>{i+1}</span>
                      <span style={{ color:ls.color, fontWeight:ls.fontWeight||'400', wordBreak:'break-all', whiteSpace:'pre-wrap', paddingRight:'12px' }}>{line.text}</span>
                    </div>
                  );
                })}
                {selectedDeploy.status === 'running' && (
                  <div style={{ display:'flex', gap:'8px', alignItems:'center', padding:'6px 14px' }}>
                    <span style={{ color:'#185FA5', animation:'dm-pulse 1s infinite' }}>▋</span>
                    <span style={{ fontSize:'11px', color:'#aaa' }}>รอ output...</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#aaa', fontSize:'13px' }}>เลือก deploy จากด้านซ้ายครับ</div>
          )}
        </div>
      </div>

      {/* Status Cards */}
      <div style={{ padding:'10px', background:'#f0f2f5', borderTop:'0.5px solid #e0e0e0', flexShrink:0 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'8px', marginBottom:'8px' }}>

          {/* Webhook */}
          <div style={{ background:'white', border:'0.5px solid #e0e0e0', borderRadius:'8px', padding:'10px 12px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'5px', marginBottom:'4px' }}>
              <StatusDot ok={connected} />
              <span style={{ fontSize:'11px', fontWeight:'500', color:'#1a3a5c' }}>Webhook</span>
            </div>
            <div style={{ fontSize:'10px', color:'#888' }}>:9000 · :9001</div>
            <div style={{ fontSize:'10px', color: connected ? '#0F6E56' : '#c0392b', marginTop:'2px' }}>{connected ? 'Connected' : 'Disconnected'}</div>
          </div>

          {/* Backend */}
          <div style={{ background:'white', border:'0.5px solid #e0e0e0', borderRadius:'8px', padding:'10px 12px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'5px', marginBottom:'4px' }}>
              <StatusDot ok={!!health} />
              <span style={{ fontSize:'11px', fontWeight:'500', color:'#1a3a5c' }}>Backend API</span>
            </div>
            <div style={{ fontSize:'10px', color:'#888' }}>:4000{health ? ` · ${formatDuration(health.uptime)}` : ''}</div>
            <div style={{ fontSize:'10px', color: health ? '#0F6E56' : '#c0392b', marginTop:'2px' }}>{health ? 'Running' : 'Down'}</div>
          </div>

          {/* Database */}
          <div style={{ background:'white', border:'0.5px solid #e0e0e0', borderRadius:'8px', padding:'10px 12px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'5px', marginBottom:'4px' }}>
              <StatusDot ok={health?.db?.status === 'ok'} />
              <span style={{ fontSize:'11px', fontWeight:'500', color:'#1a3a5c' }}>Database</span>
            </div>
            <div style={{ fontSize:'10px', color:'#888' }}>PostgreSQL 17</div>
            <div style={{ fontSize:'10px', color: health?.db?.status === 'ok' ? '#0F6E56' : '#c0392b', marginTop:'2px' }}>
              {health?.db?.status === 'ok' ? `Connected · ${health.db.latency}ms` : 'Error'}
            </div>
          </div>

          {/* Git */}
          <div style={{ background:'white', border:'0.5px solid #e0e0e0', borderRadius:'8px', padding:'10px 12px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'5px', marginBottom:'4px' }}>
              <span style={{ fontSize:'11px', fontWeight:'500', color:'#1a3a5c' }}>Git</span>
              {health?.git?.branch && <span style={{ fontSize:'9px', background:'#E6F1FB', color:'#185FA5', padding:'1px 6px', borderRadius:'20px' }}>{health.git.branch}</span>}
            </div>
            <div style={{ fontSize:'10px', color:'#888', fontFamily:'monospace' }}>{health?.git?.commit || '-'} · {health?.git?.author || '-'}</div>
            <div style={{ fontSize:'10px', color:'#888', marginTop:'2px' }}>{health?.git?.message || '-'}</div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'8px' }}>

          {/* RAM */}
          <div style={{ background:'white', border:'0.5px solid #e0e0e0', borderRadius:'8px', padding:'10px 12px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'2px' }}>
              <span style={{ fontSize:'11px', fontWeight:'500', color:'#1a3a5c' }}>RAM</span>
              <span style={{ fontSize:'11px', fontWeight:'500', color: health?.ram?.pct > 85 ? '#c0392b' : '#1a3a5c' }}>{health?.ram?.pct ?? '-'}%</span>
            </div>
            <ProgressBar pct={health?.ram?.pct ?? 0} />
            <div style={{ fontSize:'10px', color:'#888' }}>{health ? `${health.ram.used} MB / ${health.ram.total} MB` : '-'}</div>
          </div>

          {/* CPU */}
          <div style={{ background:'white', border:'0.5px solid #e0e0e0', borderRadius:'8px', padding:'10px 12px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'2px' }}>
              <span style={{ fontSize:'11px', fontWeight:'500', color:'#1a3a5c' }}>CPU</span>
              <span style={{ fontSize:'11px', fontWeight:'500', color: health?.cpu?.pct > 85 ? '#c0392b' : '#1a3a5c' }}>{health?.cpu?.pct ?? '-'}%</span>
            </div>
            <ProgressBar pct={health?.cpu?.pct ?? 0} />
            <div style={{ fontSize:'10px', color:'#888' }}>Uptime: {health ? formatDuration(health.uptime) : '-'}</div>
          </div>

          {/* Last Deploy */}
          <div style={{ background:'white', border:'0.5px solid #e0e0e0', borderRadius:'8px', padding:'10px 12px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'5px', marginBottom:'4px' }}>
              {history[0] && <StatusDot ok={history[0].status === 'success'} />}
              <span style={{ fontSize:'11px', fontWeight:'500', color:'#1a3a5c' }}>Last Deploy</span>
            </div>
            <div style={{ fontSize:'10px', color:'#888' }}>{history[0] ? `${formatTime(history[0].startedAt)} · ${formatDuration(history[0].durationSec)}` : '-'}</div>
            <div style={{ fontSize:'10px', color: history[0]?.status === 'success' ? '#0F6E56' : '#c0392b', marginTop:'2px', fontWeight:'500' }}>
              {history[0] ? history[0].status.toUpperCase() : '-'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (inline) return content;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={{ width:'900px', maxWidth:'96vw', height:'90vh', display:'flex', flexDirection:'column' }}>
        {content}
      </div>
    </div>
  );
}
