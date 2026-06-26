import React, { useState, useEffect, useRef, useCallback } from 'react';

const WEBHOOK_URL = 'http://10.101.87.126:9000';
const HEALTH_URL  = 'http://10.101.87.126:4000/health';
const POLL_MS     = 2000;

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

function Dot({ ok }) {
  return <span style={{ width:'5px', height:'5px', borderRadius:'50%', background: ok ? '#0F6E56' : '#c0392b', display:'inline-block', flexShrink:0 }} />;
}

function Bar({ pct }) {
  const c = pct > 85 ? '#c0392b' : pct > 65 ? '#856404' : '#0F6E56';
  return (
    <div style={{ background:'#f0f0f0', borderRadius:'20px', height:'3px', overflow:'hidden', margin:'3px 0' }}>
      <div style={{ height:'100%', borderRadius:'20px', background:c, width:`${Math.min(pct||0,100)}%` }} />
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
  const [deploying, setDeploying]   = useState(false);
  const logRef   = useRef(null);
  const timerRef = useRef(null);

  const scrollBottom = useCallback(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, []);

  // Poll /status every 2s
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`${WEBHOOK_URL}/status`);
        const data = await r.json();
        if (cancelled) return;
        setConnected(true);
        setHistory(data.history || []);
        setCurrent(data.current || null);
        if (data.current) {
          setSelectedId(data.current.id);
          setTimeout(scrollBottom, 50);
        } else if (!selectedId && data.history?.length) {
          setSelectedId(data.history[0].id);
        }
      } catch {
        if (!cancelled) setConnected(false);
      }
    };
    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(iv); };
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

  // Poll /health every 30s
  useEffect(() => {
    const fetch_ = async () => {
      try { const r = await fetch(HEALTH_URL); setHealth(await r.json()); }
      catch { setHealth(null); }
    };
    fetch_();
    const iv = setInterval(fetch_, 30000);
    return () => clearInterval(iv);
  }, []);

  // Trigger deploy
  const handleDeploy = async () => {
    if (deploying || current) return;
    setDeploying(true);
    try {
      await fetch(`${WEBHOOK_URL}/`, { method: 'POST' });
    } catch { }
    setDeploying(false);
  };

  const selectedDeploy = selectedId ? (history.find(d => d.id === selectedId) || current) : current || (history[0] || null);
  const statusKey = current ? 'running' : selectedDeploy?.status || 'idle';
  const sc = STATUS[statusKey] || STATUS.idle;
  const lines = selectedDeploy?.lines || [];
  const errorCount = lines.filter(l => l.level === 'error').length;
  const warnCount  = lines.filter(l => l.level === 'warn').length;

  const S = {
    sectionLabel: { padding:'6px 10px', borderBottom:'0.5px solid #e0e0e0', flexShrink:0 },
    sectionText: { fontSize:'9px', fontWeight:'500', color:'#888', textTransform:'uppercase', letterSpacing:'0.05em' },
    row: { padding:'7px 10px', borderBottom:'0.5px solid #e0e0e0', background:'white', flexShrink:0 },
    rowTitle: { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'2px' },
    label: { display:'flex', alignItems:'center', gap:'4px' },
    name: { fontSize:'10px', fontWeight:'500', color:'#1a3a5c' },
    sub: { fontSize:'9px', color:'#aaa', paddingLeft:'9px' },
  };

  const content = (
    <div style={{ display:'flex', flexDirection:'column', height: inline ? '100vh' : '100%', background:'white', borderRadius:'8px', overflow:'hidden', border:'0.5px solid #e0e0e0' }}>
      <style>{`@keyframes dm-pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      {/* Header */}
      <div style={{ padding:'8px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'0.5px solid #e0e0e0', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'12px', fontWeight:'500', color:'#1a3a5c' }}>Deploy Monitor</span>
          <span style={{ display:'inline-flex', alignItems:'center', gap:'4px', background: connected ? '#EAF3DE' : '#FCEBEB', color: connected ? '#0F6E56' : '#791F1F', fontSize:'10px', padding:'2px 8px', borderRadius:'20px', fontWeight:'500' }}>
            <span style={{ width:'5px', height:'5px', borderRadius:'50%', background: connected ? '#0F6E56' : '#c0392b', display:'inline-block' }} />
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          {current && <span style={{ fontSize:'11px', color:'#888' }}>⏱ {formatDuration(elapsed)}</span>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <button
            onClick={handleDeploy}
            disabled={!!current || deploying || !connected}
            style={{ fontSize:'10px', padding:'3px 12px', borderRadius:'20px', border:'none', cursor: (current || deploying || !connected) ? 'not-allowed' : 'pointer', background: (current || deploying || !connected) ? '#e0e0e0' : '#185FA5', color: (current || deploying || !connected) ? '#aaa' : 'white', fontWeight:'500' }}>
            {current ? 'Deploying...' : '🚀 Deploy'}
          </button>
          <span style={{ background:sc.bg, color:sc.color, fontSize:'10px', padding:'2px 8px', borderRadius:'20px', fontWeight:'500', display:'inline-flex', alignItems:'center', gap:'4px' }}>
            <span style={{ width:'5px', height:'5px', borderRadius:'50%', background:sc.dot, display:'inline-block', animation: sc.pulse ? 'dm-pulse 1.2s infinite' : 'none' }} />
            {sc.label}
          </span>
          {!inline && onClose && <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#888', fontSize:'18px', lineHeight:1 }}>×</button>}
        </div>
      </div>

      {/* 3-col body */}
      <div style={{ display:'grid', gridTemplateColumns:'150px 1fr 190px', flex:1, overflow:'hidden', minHeight:0 }}>

        {/* Col 1: History */}
        <div style={{ borderRight:'0.5px solid #e0e0e0', display:'flex', flexDirection:'column', overflow:'hidden', background:'white' }}>
          <div style={S.sectionLabel}><span style={S.sectionText}>History</span></div>
          <div style={{ overflowY:'auto', flex:1 }}>
            {history.length === 0 && <div style={{ padding:'16px 10px', fontSize:'10px', color:'#aaa', textAlign:'center' }}>ยังไม่มี deploy</div>}
            {history.map((d, i) => {
              const isSel = selectedId === d.id;
              const sc2 = STATUS[d.status] || STATUS.idle;
              return (
                <div key={d.id} onClick={() => setSelectedId(d.id)}
                  style={{ padding:'6px 10px', cursor:'pointer', borderLeft: isSel ? `2px solid ${sc2.dot}` : '2px solid transparent', background: isSel ? sc2.bg : 'transparent', borderBottom: i < history.length-1 ? '0.5px solid #f0f0f0' : 'none' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:'1px' }}>
                    <span style={{ width:'4px', height:'4px', borderRadius:'50%', background:sc2.dot }} />
                    <span style={{ fontSize:'9px', fontWeight:'500', color:sc2.color }}>{sc2.label}</span>
                    {d.durationSec && <span style={{ fontSize:'9px', color:'#aaa', marginLeft:'auto' }}>{formatDuration(d.durationSec)}</span>}
                  </div>
                  <div style={{ fontSize:'9px', color:'#aaa' }}>{formatTime(d.startedAt)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Col 2: Log */}
        <div style={{ display:'flex', flexDirection:'column', overflow:'hidden', background:'white', borderRight:'0.5px solid #e0e0e0' }}>
          {selectedDeploy ? (
            <>
              <div style={{ padding:'6px 12px', borderBottom:'0.5px solid #e0e0e0', display:'flex', alignItems:'center', gap:'8px', background:'#f8f9fa', flexShrink:0 }}>
                <span style={{ fontSize:'10px', color:'#888' }}>Started: {formatTimeFull(selectedDeploy.startedAt)}</span>
                {selectedDeploy.finishedAt && <>
                  <span style={{ color:'#ddd' }}>·</span>
                  <span style={{ fontSize:'10px', color:'#888' }}>{formatDuration(selectedDeploy.durationSec)}</span>
                </>}
                <div style={{ marginLeft:'auto', display:'flex', gap:'8px' }}>
                  {errorCount > 0 && <span style={{ fontSize:'10px', color:'#791F1F' }}>✕ {errorCount}</span>}
                  {warnCount  > 0 && <span style={{ fontSize:'10px', color:'#856404' }}>⚠ {warnCount}</span>}
                  <span style={{ fontSize:'10px', color:'#aaa' }}>{lines.length} lines</span>
                </div>
              </div>
              <div ref={logRef} style={{ flex:1, overflowY:'auto', fontFamily:'Consolas,Monaco,"Courier New",monospace', fontSize:'10px', lineHeight:'1.8' }}>
                {lines.map((line, i) => {
                  const ls = getLineStyle(line.level);
                  return (
                    <div key={i} style={{ display:'flex', background:ls.bg }}>
                      <span style={{ color:'#ccc', minWidth:'28px', textAlign:'right', paddingRight:'8px', flexShrink:0, fontSize:'9px', paddingTop:'2px', userSelect:'none', borderRight:'0.5px solid #eee', marginRight:'8px', background:'#f8f9fa' }}>{i+1}</span>
                      <span style={{ color:ls.color, fontWeight:ls.fontWeight||'400', wordBreak:'break-all', whiteSpace:'pre-wrap', paddingRight:'8px' }}>{line.text}</span>
                    </div>
                  );
                })}
                {selectedDeploy.status === 'running' && (
                  <div style={{ display:'flex', gap:'8px', alignItems:'center', padding:'4px 10px' }}>
                    <span style={{ color:'#185FA5', animation:'dm-pulse 1s infinite' }}>▋</span>
                    <span style={{ fontSize:'10px', color:'#aaa' }}>รอ output...</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#aaa', fontSize:'12px' }}>เลือก deploy จากด้านซ้ายครับ</div>
          )}
        </div>

        {/* Col 3: Status Panel */}
        <div style={{ display:'flex', flexDirection:'column', background:'#f8f9fa', overflow:'hidden' }}>
          <div style={S.sectionLabel}><span style={S.sectionText}>Services</span></div>

          <div style={S.row}>
            <div style={S.rowTitle}>
              <div style={S.label}><Dot ok={connected} /><span style={S.name}>Webhook</span></div>
              <span style={{ fontSize:'9px', color: connected ? '#0F6E56' : '#c0392b' }}>{connected ? 'Connected' : 'Down'}</span>
            </div>
            <div style={S.sub}>:9000</div>
          </div>

          <div style={S.row}>
            <div style={S.rowTitle}>
              <div style={S.label}><Dot ok={!!health} /><span style={S.name}>Backend API</span></div>
              <span style={{ fontSize:'9px', color: health ? '#0F6E56' : '#c0392b' }}>{health ? 'Running' : 'Down'}</span>
            </div>
            <div style={S.sub}>:4000{health ? ` · ${formatDuration(health.uptime)}` : ''}</div>
          </div>

          <div style={S.row}>
            <div style={S.rowTitle}>
              <div style={S.label}><Dot ok={health?.db?.status === 'ok'} /><span style={S.name}>Database</span></div>
              <span style={{ fontSize:'9px', color: health?.db?.status === 'ok' ? '#0F6E56' : '#c0392b' }}>
                {health?.db?.status === 'ok' ? `${health.db.latency}ms` : 'Error'}
              </span>
            </div>
            <div style={S.sub}>PostgreSQL 17</div>
          </div>

          <div style={S.row}>
            <div style={S.rowTitle}>
              <span style={S.name}>Git</span>
              {health?.git?.branch && <span style={{ fontSize:'9px', background:'#E6F1FB', color:'#185FA5', padding:'1px 5px', borderRadius:'20px' }}>{health.git.branch}</span>}
            </div>
            <div style={{ fontSize:'9px', color:'#aaa', fontFamily:'monospace' }}>{health?.git?.commit || '-'} · {health?.git?.author || '-'}</div>
          </div>

          <div style={S.row}>
            <div style={S.rowTitle}>
              <div style={S.label}><Dot ok={history[0]?.status === 'success'} /><span style={S.name}>Last Deploy</span></div>
              <span style={{ fontSize:'9px', color: history[0]?.status === 'success' ? '#0F6E56' : '#c0392b', fontWeight:'500' }}>
                {history[0] ? history[0].status.toUpperCase() : '-'}
              </span>
            </div>
            <div style={S.sub}>{history[0] ? `${formatTime(history[0].startedAt)} · ${formatDuration(history[0].durationSec)}` : '-'}</div>
          </div>

          <div style={{ ...S.sectionLabel, marginTop:'auto' }}><span style={S.sectionText}>Resources</span></div>

          <div style={S.row}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'1px' }}>
              <span style={S.name}>RAM</span>
              <span style={{ fontSize:'10px', fontWeight:'500', color: (health?.ram?.pct||0) > 85 ? '#c0392b' : '#1a3a5c' }}>{health?.ram?.pct ?? '-'}%</span>
            </div>
            <Bar pct={health?.ram?.pct} />
            <div style={S.sub}>{health ? `${health.ram.used} MB / ${health.ram.total} MB` : '-'}</div>
          </div>

          <div style={{ ...S.row, flex:1, borderBottom:'none' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'1px' }}>
              <span style={S.name}>CPU</span>
              <span style={{ fontSize:'10px', fontWeight:'500', color: (health?.cpu?.pct||0) > 85 ? '#c0392b' : '#1a3a5c' }}>{health?.cpu?.pct ?? '-'}%</span>
            </div>
            <Bar pct={health?.cpu?.pct} />
            <div style={S.sub}>Uptime: {health ? formatDuration(health.uptime) : '-'}</div>
          </div>
        </div>
      </div>
    </div>
  );

  if (inline) return content;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={{ width:'940px', maxWidth:'96vw', height:'90vh', display:'flex', flexDirection:'column' }}>
        {content}
      </div>
    </div>
  );
}