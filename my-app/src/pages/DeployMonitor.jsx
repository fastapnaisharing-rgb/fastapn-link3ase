import React, { useState, useEffect, useRef, useCallback } from 'react';
import Chart from 'chart.js/auto';

const WEBHOOK_URL = 'http://10.101.87.126:9000';
// webhook.js รัน WebSocket server แยกที่ port 9001 (คนละ port จาก HTTP :9000)
// เดิม frontend เคยต่อ EventSource ไปที่ :9000/events ซึ่งไม่มี route นี้อยู่จริง
// ใน backend เลย (มีแต่ /status, POST /) ทำให้ Disconnected ตลอด แก้เป็น WS แทน
const WEBHOOK_WS_URL = 'ws://10.101.87.126:9001';
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
  // MARKER_DEPLOYMONITOR_SYSTEM_LOG
  const [logSubTab, setLogSubTab] = useState('deploy'); // 'deploy' | 'cpu' | 'ram'
  const [cpuLog, setCpuLog] = useState([]);
  const [ramLog, setRamLog] = useState([]);

  useEffect(() => {
    if (logSubTab === 'cpu' && cpuLog.length === 0) {
      authFetch('/system/cpu-history?hours=24').then(rows => setCpuLog(Array.isArray(rows) ? rows.slice().reverse() : [])).catch(err => console.error('CPU log fetch error:', err));
    }
    if (logSubTab === 'ram' && ramLog.length === 0) {
      authFetch('/system/ram-history?hours=24').then(rows => setRamLog(Array.isArray(rows) ? rows.slice().reverse() : [])).catch(err => console.error('RAM log fetch error:', err));
    }
  }, [logSubTab]);
  const logRef   = useRef(null);
  const timerRef = useRef(null);

  const scrollBottom = useCallback(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, []);

  // Deploy events via WebSocket (ตรงกับ backend webhook.js ที่รัน WS บน :9001)
  // เดิมใช้ EventSource ไปที่ :9000/events ซึ่งไม่มี route นี้จริง เปลี่ยนมาใช้ WS
  // ให้ตรงกับที่ backend ส่งจริง พร้อม manual reconnect (WebSocket ไม่ auto-reconnect
  // เหมือน EventSource ต้องทำเอง)
  useEffect(() => {
    let ws;
    let retryTimer;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(WEBHOOK_WS_URL);

      ws.onopen = () => setConnected(true);

      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }

        if (msg.type === 'init') {
          // ข้อมูล ณ ตอนที่เพิ่ง connect เข้ามา (กันพลาด event ตอนปิดหน้าอยู่)
          setHistory(msg.history || []);
          setCurrent(msg.current || null);
          if (msg.current) {
            setSelectedId(msg.current.id);
            setTimeout(scrollBottom, 50);
          } else if (!selectedId && msg.history?.length) {
            setSelectedId(msg.history[0].id);
          }
        }

        if (msg.type === 'deploy_start') {
          setCurrent(msg.deploy);
          setHistory(h => [msg.deploy, ...h].slice(0, 20));
          setSelectedId(msg.deploy.id);
          setTimeout(scrollBottom, 50);
        }

        if (msg.type === 'log') {
          setCurrent(c => (c && c.id === msg.deployId) ? { ...c, lines: [...c.lines, msg.line] } : c);
          setHistory(h => h.map(d => d.id === msg.deployId ? { ...d, lines: [...d.lines, msg.line] } : d));
          setTimeout(scrollBottom, 50);
        }

        if (msg.type === 'deploy_end' && msg.deploy) {
          setCurrent(null);
          setHistory(h => h.map(d => d.id === msg.deploy.id ? msg.deploy : d));
        }
      };

      ws.onerror = () => {
        setConnected(false);
      };

      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) retryTimer = setTimeout(connect, 3000); // reconnect เอง ทุก 3 วิ
      };
    };

    connect();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
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
    // MARKER_DEPLOYMONITOR_HEALTH_ERROR_LOG
    const fetch_ = async () => {
      try { const r = await fetch(HEALTH_URL); setHealth(await r.json()); }
      catch (err) {
        console.error('[Deploy Monitor] Health check failed (อาจเป็น CORS/Network — Backend อาจไม่ได้ Down จริง):', err.message);
        setHealth(null);
      }
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
    <div style={{ display:'flex', flexDirection:'column', height: '100%', background:'white', borderRadius:'8px', overflow:'hidden', border:'0.5px solid #e0e0e0' }}>
      <style>{`@keyframes dm-pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      {/* Header */}
      <div style={{ padding:'8px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'0.5px solid #e0e0e0', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'12px', fontWeight:'500', color:'#1a3a5c' }}>System Log</span>
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

      {/* Sub-tab bar: Deploy Log / CPU Log / RAM Log */}
      <div style={{ display:'flex', gap:'2px', padding:'0 14px', borderBottom:'0.5px solid #e0e0e0', flexShrink:0, background:'white' }}>
        {[['deploy','Deploy Log'],['cpu','CPU Log'],['ram','RAM Log']].map(([key,label]) => (
          <button key={key} onClick={() => setLogSubTab(key)}
            style={{ padding:'7px 12px', border:'none', background:'transparent', color: logSubTab===key ? '#1a3a5c' : '#888', fontSize:'11px', fontWeight: logSubTab===key ? '500' : '400', cursor:'pointer', borderBottom: logSubTab===key ? '2px solid #1a3a5c' : '2px solid transparent', marginBottom:'-1px' }}>
            {label}
          </button>
        ))}
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
          {logSubTab === 'deploy' && (selectedDeploy ? (
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
          ))}

          {logSubTab === 'cpu' && (
            <div style={{ flex:1, overflowY:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'11px' }}>
                <thead>
                  <tr style={{ background:'#fafaf8' }}>
                    <th style={{ textAlign:'left', padding:'8px 14px', color:'#999', fontWeight:500, borderBottom:'0.5px solid #eee' }}>เวลา</th>
                    <th style={{ textAlign:'left', padding:'8px 14px', color:'#999', fontWeight:500, borderBottom:'0.5px solid #eee' }}>CPU</th>
                    <th style={{ textAlign:'left', padding:'8px 14px', color:'#999', fontWeight:500, borderBottom:'0.5px solid #eee' }}>Top Process</th>
                    <th style={{ textAlign:'left', padding:'8px 14px', color:'#999', fontWeight:500, borderBottom:'0.5px solid #eee' }}>หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {cpuLog.length === 0 && <tr><td colSpan={4} style={{ padding:'20px', textAlign:'center', color:'#aaa' }}>ยังไม่มีข้อมูล</td></tr>}
                  {cpuLog.map((row, i) => {
                    const isSpike = row.cpu_pct >= 70;
                    const topProc = (row.top_processes || [])[0]?.Name;
                    return (
                      <tr key={i}>
                        <td style={{ padding:'7px 14px', color:'#555', borderBottom:'0.5px solid #f3f3f0' }}>{formatTimeFull(row.recorded_at)}</td>
                        <td style={{ padding:'7px 14px', borderBottom:'0.5px solid #f3f3f0', color: isSpike ? '#791F1F' : '#27500A', fontWeight:600 }}>{row.cpu_pct}%</td>
                        <td style={{ padding:'7px 14px', color:'#888', borderBottom:'0.5px solid #f3f3f0' }}>{topProc || '\u2014'}</td>
                        <td style={{ padding:'7px 14px', borderBottom:'0.5px solid #f3f3f0' }}>{isSpike && <span style={{ background:'#FCEBEB', color:'#791F1F', padding:'1px 6px', borderRadius:'8px', fontSize:'10px' }}>Spike</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {logSubTab === 'ram' && (
            <div style={{ flex:1, overflowY:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'11px' }}>
                <thead>
                  <tr style={{ background:'#fafaf8' }}>
                    <th style={{ textAlign:'left', padding:'8px 14px', color:'#999', fontWeight:500, borderBottom:'0.5px solid #eee' }}>เวลา</th>
                    <th style={{ textAlign:'left', padding:'8px 14px', color:'#999', fontWeight:500, borderBottom:'0.5px solid #eee' }}>RAM</th>
                    <th style={{ textAlign:'left', padding:'8px 14px', color:'#999', fontWeight:500, borderBottom:'0.5px solid #eee' }}>Top Process</th>
                    <th style={{ textAlign:'left', padding:'8px 14px', color:'#999', fontWeight:500, borderBottom:'0.5px solid #eee' }}>หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {ramLog.length === 0 && <tr><td colSpan={4} style={{ padding:'20px', textAlign:'center', color:'#aaa' }}>ยังไม่มีข้อมูล</td></tr>}
                  {ramLog.map((row, i) => {
                    const isSpike = row.ram_pct >= 75;
                    const topProc = (row.top_processes || [])[0]?.Name;
                    return (
                      <tr key={i}>
                        <td style={{ padding:'7px 14px', color:'#555', borderBottom:'0.5px solid #f3f3f0' }}>{formatTimeFull(row.recorded_at)}</td>
                        <td style={{ padding:'7px 14px', borderBottom:'0.5px solid #f3f3f0', color: isSpike ? '#791F1F' : '#27500A', fontWeight:600 }}>{row.ram_pct}%</td>
                        <td style={{ padding:'7px 14px', color:'#888', borderBottom:'0.5px solid #f3f3f0' }}>{topProc || '\u2014'}</td>
                        <td style={{ padding:'7px 14px', borderBottom:'0.5px solid #f3f3f0' }}>{isSpike && <span style={{ background:'#FCEBEB', color:'#791F1F', padding:'1px 6px', borderRadius:'8px', fontSize:'10px' }}>Spike</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
// ═══════════════════════════════════════════════════════════════
// RAM Dashboard — แยกออกมาจาก DeployMonitor ตามที่ตกลงกันไว้
// ═══════════════════════════════════════════════════════════════

const API_BASE = 'http://10.101.87.126:4000/api';

function authFetch(path, opts = {}) {
  const token = sessionStorage.getItem('fastapn_token');
  return fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  }).then(r => r.json());
}

function RamDonut({ orphanRamMb, usedMb, totalMb, backendRamMb }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const otherMb = Math.max(0, usedMb - orphanRamMb - backendRamMb);
    const freeMb = Math.max(0, totalMb - usedMb);

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: 'doughnut',
      data: {
        labels: ['powershell orphan', 'ระบบอื่น', 'backend', 'ว่าง'],
        datasets: [{
          data: [orphanRamMb, otherMb, backendRamMb, freeMb],
          backgroundColor: ['#eda100', '#898781', '#008300', '#f1efe8'],
          borderWidth: 3,
          borderColor: '#fcfcfb',
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '76%', plugins: { legend: { display: false } } },
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [orphanRamMb, usedMb, totalMb, backendRamMb]);

  return <canvas ref={canvasRef} />;
}

// ── High-risk process names ที่ต้องการ track แยกใน Stacked Area ──
const HIGH_RISK_PROCS = ['pgAdmin4', 'powershell', 'sqlservr', 'MsMpEng', 'SentinelAgent'];
const HIGH_RISK_COLORS = {
  pgAdmin4:      { bg: 'rgba(235,104,52,0.18)',  border: 'rgba(235,104,52,0.55)' },
  powershell:    { bg: 'rgba(230,168,23,0.18)',   border: 'rgba(230,168,23,0.55)' },
  sqlservr:      { bg: 'rgba(232,123,164,0.15)',  border: 'rgba(232,123,164,0.5)' },
  MsMpEng:       { bg: 'rgba(137,87,229,0.13)',   border: 'rgba(137,87,229,0.4)'  },
  SentinelAgent: { bg: 'rgba(192,57,43,0.13)',    border: 'rgba(192,57,43,0.4)'   },
};

function RamLineChart({ history: historyRaw, totalRamMb }) {
  const history = Array.isArray(historyRaw) ? historyRaw : [];
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !history.length) return;

    const labels = history.map(h => formatTime(h.recorded_at));
    const totalData = history.map(h => h.ram_pct);

    // ── high-risk: วาดเป็น line บาง fill opacity ซ้อนเส้นหลัก ──────────────────
    // ── แปลง MB → % โดยใช้ totalRamMb จาก /ram-current (ไม่พึ่ง ram_total_mb) ──
    // ── ram.total จาก /ram-current เป็น MB แล้ว (getCurrentRam หาร 1024*1024 ไว้แล้ว) ──
    // ── ถ้าค่า > 100000 แสดงว่าหลุดเป็น bytes มา → หาร 1024 อีกครั้ง ──
    const rawTotal = totalRamMb && totalRamMb > 0 ? totalRamMb : null;
    const ramTotalSafe = rawTotal ? (rawTotal > 100000 ? Math.round(rawTotal / 1024) : rawTotal) : null;
    const highRiskDatasets = ramTotalSafe ? HIGH_RISK_PROCS.map(name => {
      const data = history.map(h => {
        const procs = h.top_processes || [];
        const found = procs.find(p => p.Name === name);
        if (!found || !found.RAM) return 0;
        return Math.max(0, Math.min(100, Math.round((found.RAM / ramTotalSafe) * 100 * 10) / 10));
      });
      const hasData = data.some(v => v > 0);
      if (!hasData) return null;
      const c = HIGH_RISK_COLORS[name] || { bg: 'rgba(150,150,150,0.15)', border: 'rgba(150,150,150,0.3)' };
      return {
        type: 'bar', label: name, data,
        backgroundColor: c.bg,
        borderColor: 'transparent',
        borderWidth: 0,
        order: 3,
        yAxisID: 'y',
        categoryPercentage: 1.0,
        barPercentage: 1.0,
      };
    }).filter(Boolean) : [];

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      data: {
        labels,
        datasets: [
          {
            type: 'line', label: 'RAM รวม', data: totalData,
            borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5,
            fill: false, tension: 0.35, order: 0, yAxisID: 'y',
            segment: { borderColor: c => (c.p1.parsed.y >= 75 ? '#e24b4a' : '#eda100') },
            pointHoverBackgroundColor: c => (c.parsed.y >= 75 ? '#e24b4a' : '#eda100'),
          },
          {
            type: 'line', label: 'เกณฑ์ 75%', data: labels.map(() => 75),
            borderColor: 'rgba(220,80,80,0.35)', borderWidth: 1,
            borderDash: [4, 4], pointRadius: 0, fill: false, order: 1, yAxisID: 'y',
          },
          ...highRiskDatasets,
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, aspectRatio: 1,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#fcfcfb', titleColor: '#0b0b0b', bodyColor: '#52514e',
            borderColor: '#e1e0d9', borderWidth: 1, padding: 10, cornerRadius: 8,
            callbacks: {
              label: c => {
                if (c.dataset.label === 'เกณฑ์ 75%') return null;
                if (c.dataset.type === 'bar') return null;
                if (c.dataset.label === 'RAM รวม') return ` RAM รวม: ${c.parsed.y}%`;
                return c.raw > 0 ? ` ${c.dataset.label}: ~${c.raw}%` : null;
              },
              footer: items => {
                const hr = items.filter(i => HIGH_RISK_PROCS.includes(i.dataset.label) && i.dataset.type !== 'bar' && i.raw > 0);
                if (!hr.length) return '';
                return `High-risk รวม: ~${hr.reduce((s, i) => s + i.raw, 0).toFixed(1)}%`;
              },
            },
          },
        },
        scales: {
          y: {
            min: 0, max: 100,
            position: 'left',
            grid: { color: '#e8e7e1' },
            ticks: { color: '#898781', font: { size: 11 }, callback: v => v + '%', stepSize: 25 },
          },
          x: {
            grid: { display: false },
            ticks: { color: '#898781', font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 },
          },
        },
      },
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [history]);

  // ── Legend แสดงเฉพาะ process ที่มีข้อมูลจริง ──
  const activeProcs = HIGH_RISK_PROCS.filter(name =>
    history.some(h => (h.top_processes || []).find(p => p.Name === name))
  );

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '8px', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#888' }}>
          <span style={{ width: '20px', height: '2px', background: '#eda100', display: 'inline-block', borderRadius: '1px' }} />
          RAM รวม
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#888' }}>
          <span style={{ width: '20px', borderTop: '1.5px dashed rgba(220,80,80,0.5)', display: 'inline-block' }} />
          เกณฑ์ 75%
        </span>
        {activeProcs.length > 0 && <span style={{ width: '1px', height: '12px', background: '#e0e0e0' }} />}
        {activeProcs.map(name => {
          const c = HIGH_RISK_COLORS[name] || {};
          return (
            <span key={name} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#888' }}>
              <span style={{ width: '10px', height: '9px', borderRadius: '2px', background: c.bg, border: `0.5px solid ${c.border || '#ccc'}`, display: 'inline-block' }} />
              {name}
              <span style={{ fontSize: '10px', background: '#FCEBEB', color: '#A32D2D', padding: '1px 5px', borderRadius: '3px' }}>high-risk</span>
            </span>
          );
        })}
      </div>
      <div style={{ position: 'relative', width: '100%', height: '190px' }}>
        <canvas ref={canvasRef} style={{ width: '100% !important', height: '100% !important' }} />
      </div>
    </div>
  );
}

export function RAMDashboardTab() {
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [expandedProc, setExpandedProc] = useState(null);
  const [killLog, setKillLog] = useState([]);
  const [previewData, setPreviewData] = useState(null);
  const [selectedPids, setSelectedPids] = useState(new Set());
  const [killing, setKilling] = useState(false);
  const [killingSafe, setKillingSafe] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [anomalyCleared, setAnomalyCleared] = useState(false);

 
  const fetchAll = useCallback(async () => {
    try {
      const [cur, hist, ana] = await Promise.all([
        authFetch('/system/ram-current'),
        authFetch('/system/ram-history?hours=24'),
        authFetch('/system/ram-analysis'),
      ]);
      setCurrent(cur);
      setHistory(hist);
      setAnalysis(ana);
      setLastRefresh(Date.now());
      // ถ้า RAM กลับปกติแล้ว (anomaly หาย) → reset cleared state
      if (!ana?.hasAnomaly) setAnomalyCleared(false);
    } catch (err) { console.error('RAM dashboard fetch error:', err); }
  }, []);

  const fetchKillLog = useCallback(async () => {
    try {
      const data = await authFetch('/activity_log?eq_module=BACKEND_OPS&eq_action=KILL_ORPHAN_PROCESS&order=created_at.desc&limit=5');
      setKillLog(Array.isArray(data) ? data : []);
    } catch (err) { console.error('kill log fetch error:', err); }
  }, []);

  useEffect(() => {
    fetchAll();
    fetchKillLog();
    const interval = setInterval(fetchAll, 60000);
    return () => clearInterval(interval);
  }, [fetchAll, fetchKillLog]);

  // ── เปิด Preview Modal — auto-kill จัดการ backend แล้ว ส่ง suggest กลับให้ Owner ──
  const handlePreviewKill = async () => {
    try {
      const data = await authFetch('/system/kill-orphans/preview', { method: 'POST' });
      setPreviewData(data);
      const suggestPids = new Set((data.suggest || []).map(p => p.Id));
      setSelectedPids(suggestPids);
      if (data.autoKilledCount > 0) {
        setAnomalyCleared(true);
        await fetchAll();
        await fetchKillLog();
      }
    } catch (err) { console.error('preview kill error:', err); }
  };

  // ── Kill เฉพาะ auto tier (score ≥ 80) ทันที ไม่ต้องรอ Owner เลือก ──
  const handleConfirmKillSafe = async () => {
    setKillingSafe(true);
    try {
      await authFetch('/system/kill-orphans/confirm-safe', { method: 'POST' });
      setPreviewData(null);
      await fetchAll();
      await fetchKillLog();
    } catch (err) { console.error('confirm kill safe error:', err); }
    setKillingSafe(false);
  };

  // ── Kill เฉพาะ PID ที่ Owner ติ๊กเลือก (suggest tier) ──
  const handleConfirmKill = async () => {
    if (!selectedPids.size) return;
    setKilling(true);
    try {
      await authFetch('/system/kill-orphans/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pids: [...selectedPids] }),
      });
      setPreviewData(null);
      setSelectedPids(new Set());
      setAnomalyCleared(true);
      await fetchAll();
      await fetchKillLog();
    } catch (err) { console.error('confirm kill error:', err); }
    setKilling(false);
  };

  const togglePid = (pid) => {
    setSelectedPids(prev => {
      const next = new Set(prev);
      next.has(pid) ? next.delete(pid) : next.add(pid);
      return next;
    });
  };

  if (!current) {
    return (
      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ width: '120px', height: '20px', background: '#f0efec', borderRadius: '4px' }} />
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ width: '60px', height: '30px', background: '#f0efec', borderRadius: '6px' }} />
            <div style={{ width: '140px', height: '30px', background: '#f0efec', borderRadius: '6px' }} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '28px', marginBottom: '28px', alignItems: 'start' }}>
          <div style={{ width: '172px', height: '172px', borderRadius: '50%', background: '#f0efec', margin: '0 auto' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '20px' }}>
            <div style={{ width: '65%', height: '13px', background: '#f0efec', borderRadius: '4px' }} />
            <div style={{ width: '45%', height: '13px', background: '#f0efec', borderRadius: '4px' }} />
            <div style={{ width: '100%', height: '6px', background: '#f0efec', borderRadius: '3px', marginTop: '16px' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
          <div style={{ flex: 1, height: '76px', background: '#f0efec', borderRadius: '8px' }} />
          <div style={{ flex: 1, height: '76px', background: '#f0efec', borderRadius: '8px' }} />
        </div>
        <div style={{ width: '160px', height: '13px', background: '#f0efec', borderRadius: '4px', marginBottom: '10px' }} />
        <div style={{ height: '190px', background: '#f0efec', borderRadius: '8px', marginBottom: '24px' }} />
      </div>
    );
  }

  const { ram, orphanCount, orphanRamMb, orphanSafety, topProcesses } = current;
  const { safeCount, watchingCount, safeRamMb, isEmergency } = orphanSafety;
  const { backendRamMb } = current.orphanSafety || {};
  const riskLabel = ram.pct >= 75 ? 'เกินเกณฑ์วิกฤต' : ram.pct >= 50 ? 'เข้าเกณฑ์เตือน' : 'ปกติ';
  const riskColor = ram.pct >= 75 ? '#791F1F' : ram.pct >= 50 ? '#856404' : '#27500A';
  const minutesAgo = Math.floor((Date.now() - lastRefresh) / 60000);

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>🖥️</span>
          <span style={{ fontSize: '15px', fontWeight: '500' }}>RAM monitor</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: '#888' }}>อัปเดตล่าสุด {minutesAgo < 1 ? 'เมื่อสักครู่' : `${minutesAgo} นาทีที่แล้ว`}</span>
          <button onClick={fetchAll} style={{ fontSize: '13px', padding: '6px 12px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', cursor: 'pointer' }}>รีเฟรช</button>
          <button onClick={handlePreviewKill} style={{ fontSize: '13px', padding: '6px 12px', borderRadius: '6px', border: '0.5px solid #f7c1c1', background: '#FCEBEB', color: '#791F1F', cursor: 'pointer' }}>เคลียร์ orphan process</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '28px', alignItems: 'start', marginBottom: '28px' }}>
        <div style={{ position: 'relative', width: '172px', height: '172px', margin: '0 auto' }}>
          <RamDonut orphanRamMb={orphanRamMb} usedMb={ram.used} totalMb={ram.total} backendRamMb={backendRamMb} />
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
            <p style={{ fontSize: '34px', fontWeight: '500', margin: 0, lineHeight: 1, color: riskColor }}>{ram.pct}<span style={{ fontSize: '16px' }}>%</span></p>
            <p style={{ fontSize: '11px', color: '#888', margin: '4px 0 0' }}>{(ram.used / 1024).toFixed(1)} / {(ram.total / 1024).toFixed(1)} GB</p>
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: '#eda100', flexShrink: 0 }} />
              <span style={{ flex: 1 }}>powershell orphan</span>
              <span style={{ fontSize: '12px', padding: '1px 7px', borderRadius: '20px', background: '#FFF3CD', color: '#856404' }}>{orphanCount} โปรเซส</span>
              <span style={{ fontWeight: '500', minWidth: '66px', textAlign: 'right' }}>{orphanRamMb} MB</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: '#008300', flexShrink: 0 }} />
              <span style={{ flex: 1, color: '#555' }}>backend (ระบบของเราเอง)</span>
              <span style={{ fontWeight: '500', minWidth: '66px', textAlign: 'right', color: '#555' }}>{backendRamMb} MB</span>
            </div>
          </div>

          <div style={{ borderTop: '0.5px solid #e8e8e8', paddingTop: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', color: '#555' }}>ระดับความเสี่ยง</span>
              <span style={{ fontSize: '12px', color: riskColor, fontWeight: '500' }}>{riskLabel}</span>
            </div>
            <div style={{ height: '6px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden', position: 'relative' }}>
              <div style={{ width: `${Math.min(ram.pct, 100)}%`, height: '100%', background: 'linear-gradient(90deg, #eda100, #e24b4a)', borderRadius: '3px' }} />
              <div style={{ position: 'absolute', left: '75%', top: '-2px', width: '1px', height: '10px', background: '#999' }} />
            </div>
          </div>
        </div>
      </div>

      {isEmergency && (
        <div style={{ background: '#FCEBEB', color: '#791F1F', fontSize: '11px', padding: '4px 10px', borderRadius: '20px', display: 'inline-block', marginBottom: '8px' }}>
          RAM สูง — ใช้เกณฑ์ตรวจสอบแบบเร็วขึ้นชั่วคราว
        </div>
      )}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <div style={{ flex: 1, background: '#EAF3DE', borderRadius: '8px', padding: '12px 16px' }}>
          <p style={{ fontSize: '22px', fontWeight: '500', margin: 0, color: '#27500A' }}>{safeCount}</p>
          <p style={{ fontSize: '12px', color: '#27500A', margin: '2px 0 10px' }}>ปลอดภัยที่จะปิด ({safeRamMb} MB)</p>
          {safeCount > 0 && (
            <button onClick={handlePreviewKill} style={{ fontSize: '12px', padding: '5px 10px', border: 'none', borderRadius: '6px', background: '#27500A', color: 'white', cursor: 'pointer' }}>
              ปิดโปรแกรมที่ปลอดภัย
            </button>
          )}
        </div>
        <div style={{ flex: 1, background: '#FFF3CD', borderRadius: '8px', padding: '12px 16px' }}>
          <p style={{ fontSize: '22px', fontWeight: '500', margin: 0, color: '#856404' }}>{watchingCount}</p>
          <p style={{ fontSize: '12px', color: '#856404', margin: '2px 0 0' }}>ระบบกำลังเฝ้าดู (ยังไม่แน่ใจ)</p>
        </div>
      </div>

      <p style={{ fontSize: '13px', fontWeight: '500', margin: '0 0 8px' }}>RAM ย้อนหลัง 24 ชั่วโมง</p>
      <div style={{ marginBottom: '24px' }}>
        <RamLineChart history={history} totalRamMb={ram?.total} />
      </div>

      {(analysis?.hasAnomaly || anomalyCleared) && (
        <div style={{ background: anomalyCleared ? '#EAF3DE' : '#FCEBEB', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px', transition: 'background 0.4s' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: anomalyCleared ? '#3B6D11' : '#e24b4a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.4s' }}>
              <span style={{ color: 'white', fontSize: '15px' }}>{anomalyCleared ? '✓' : '⚠️'}</span>
            </div>
            <div style={{ flex: 1 }}>
              {anomalyCleared ? (
                <>
                  <p style={{ fontSize: '13px', fontWeight: '500', color: '#27500A', margin: '0 0 3px' }}>เคลียร์แล้ว — RAM จะกลับสู่ปกติในรอบถัดไป</p>
                  <p style={{ fontSize: '12px', color: '#3B6D11', margin: 0 }}>ระบบจะตรวจสอบใหม่อีกครั้งในอีก 5 นาที</p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: '13px', fontWeight: '500', color: '#791F1F', margin: '0 0 3px' }}>RAM เพิ่มขึ้น {analysis.increase} เปอร์เซ็นต์ ใน {analysis.hoursSpan} ชั่วโมง</p>
                  <p style={{ fontSize: '12px', color: '#791F1F', margin: '0 0 10px', lineHeight: 1.5 }}>
                    ระหว่าง {formatTime(analysis.fromTime)} ถึง {formatTime(analysis.toTime)}
                    {analysis.topSuspect && <> — สาเหตุที่เป็นไปได้คือ <code style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 5px', borderRadius: '4px', fontSize: '11px' }}>{analysis.topSuspect.name}</code> เพิ่มจาก {analysis.topSuspect.beforeRam} เป็น {analysis.topSuspect.afterRam} MB</>}
                  </p>
                  <button onClick={handlePreviewKill} style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '6px', border: 'none', background: '#e24b4a', color: 'white', cursor: 'pointer' }}>เคลียร์ orphan process</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <p style={{ fontSize: '13px', fontWeight: '500', margin: '0 0 8px' }}>Process ที่ใช้ RAM สูงสุด</p>
      <div style={{ border: '0.5px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden', marginBottom: '24px' }}>
        {(topProcesses || []).slice(0, 6).map((p, i) => {
          const isOrphanGroup = p.Name === 'powershell';
          return (
            <div key={i}>
              <div
                onClick={() => isOrphanGroup && setExpandedProc(expandedProc === i ? null : i)}
                style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: i < topProcesses.length - 1 ? '0.5px solid #e8e8e8' : 'none', cursor: isOrphanGroup ? 'pointer' : 'default' }}>
                {isOrphanGroup && <span style={{ fontSize: '13px', color: '#888', marginRight: '8px', transform: expandedProc === i ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block' }}>&rsaquo;</span>}
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: isOrphanGroup ? '#eda100' : (p.Name === 'node' ? '#008300' : '#999'), marginRight: '10px', marginLeft: isOrphanGroup ? 0 : '21px', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: '13px' }}>{p.Name}{isOrphanGroup && <span style={{ color: '#888' }}> · {orphanCount} โปรเซส</span>}</span>
                <span style={{ fontSize: '13px' }}>{p.RAM} MB</span>
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: '13px', fontWeight: '500', margin: '0 0 8px' }}>ประวัติการเคลียร์ process</p>
      <div style={{ border: '0.5px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden' }}>
        {killLog.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: '#aaa', fontSize: '12px' }}>ยังไม่มีประวัติการเคลียร์</div>}
        {killLog.map((log, i) => {
          const detail = typeof log.detail === 'string' ? JSON.parse(log.detail) : (log.detail || {});
          const isAuto = detail.triggered_by === 'auto_score';
          const ramDiff = detail.ram_before_pct != null && detail.ram_after_pct != null
            ? detail.ram_before_pct - detail.ram_after_pct : null;
          return (
            <div key={i} style={{ padding: '10px 14px', borderBottom: i < killLog.length - 1 ? '0.5px solid #e8e8e8' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#888', flexShrink: 0, minWidth: '90px' }}>{formatTime(log.created_at)}</span>
                <span style={{ fontSize: '13px', flex: 1 }}>{log.username}</span>
                <span style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '10px', flexShrink: 0,
                  background: isAuto ? '#EAF3DE' : '#EDE9FE',
                  color: isAuto ? '#27500A' : '#4C1D95' }}>
                  {isAuto ? 'Auto' : 'Manual'}
                </span>
                <span style={{ fontSize: '12px', color: '#555', flexShrink: 0 }}>{detail.count || 0} ตัว</span>
                {ramDiff != null && ramDiff > 0 && (
                  <span style={{ fontSize: '11px', color: '#27500A', flexShrink: 0 }}>↓ {ramDiff}%</span>
                )}
              </div>
              {detail.process_detail?.length > 0 && (
                <div style={{ marginTop: '6px', paddingLeft: '98px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {detail.process_detail.map((p, j) => (
                    <span key={j} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '10px', background: p.killed ? '#EAF3DE' : '#FCEBEB', color: p.killed ? '#3B6D11' : '#791F1F' }}>
                      {p.name} {p.ram_mb}MB
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {previewData && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '480px', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '15px', margin: '0 0 2px', color: '#0b0b0b' }}>เคลียร์ process</h3>
                <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>ระบบวิเคราะห์ความปลอดภัยแล้ว</p>
              </div>
              <button onClick={() => { setPreviewData(null); setSelectedPids(new Set()); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#aaa', lineHeight: 1 }}>×</button>
            </div>

            {/* Auto-kill summary — ทำไปแล้ว แสดงผลลัพธ์ */}
            {previewData.autoKilledCount > 0 && (
              <div style={{ background: '#EAF3DE', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '18px' }}>✓</span>
                  <span style={{ fontSize: '13px', fontWeight: '500', color: '#27500A' }}>
                    ระบบปิดอัตโนมัติแล้ว {previewData.autoKilledCount} ตัว — คืน RAM ~{previewData.autoRamMb} MB
                  </span>
                </div>
                {previewData.autoKilled?.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', fontSize: '12px', color: '#3B6D11', padding: '3px 0' }}>
                    <span style={{ flex: 1 }}>{p.name}</span>
                    <span style={{ marginRight: '10px' }}>{p.ram_mb} MB</span>
                    <span style={{ fontSize: '10px', background: p.killed ? '#C0DD97' : '#f7c1c1', color: p.killed ? '#27500A' : '#791F1F', padding: '1px 6px', borderRadius: '10px' }}>
                      {p.killed ? 'สำเร็จ' : 'ล้มเหลว'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Suggest tier — ให้ Owner ตัดสินใจ */}
            {previewData.suggest?.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <p style={{ fontSize: '12px', color: '#856404', fontWeight: '500', margin: '0 0 8px' }}>
                  ต้องการให้ Owner ตัดสินใจ — ติ๊กเลือก process ที่ต้องการปิด
                </p>
                {previewData.suggest.map(p => (
                  <div key={p.Id} onClick={() => togglePid(p.Id)}
                    style={{ display: 'flex', alignItems: 'center', padding: '9px 12px', background: selectedPids.has(p.Id) ? '#FFFBEB' : '#fafafa', border: `0.5px solid ${selectedPids.has(p.Id) ? '#eda100' : '#e8e8e8'}`, borderRadius: '6px', marginBottom: '6px', cursor: 'pointer' }}>
                    <input type="checkbox" readOnly checked={selectedPids.has(p.Id)} style={{ marginRight: '10px', accentColor: '#eda100', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '500' }}>{p.Name}</div>
                      <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{(p.reasons || []).join(' · ')}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '10px' }}>
                      <div style={{ fontSize: '13px' }}>{p.RAM} MB</div>
                      <div style={{ fontSize: '10px', color: '#856404' }}>score {p.score}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {previewData.autoKilledCount === 0 && !previewData.suggest?.length && (
              <p style={{ fontSize: '13px', color: '#888', textAlign: 'center', padding: '20px 0' }}>ไม่มี process ที่ควร Kill ตอนนี้</p>
            )}

            <div style={{ borderTop: '0.5px solid #e8e8e8', paddingTop: '14px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => { setPreviewData(null); setSelectedPids(new Set()); }}
                style={{ padding: '7px 14px', borderRadius: '6px', border: '0.5px solid #e0e0e0', cursor: 'pointer', background: 'white', color: '#555', fontSize: '13px' }}>ปิด</button>
              {previewData.suggest?.length > 0 && selectedPids.size > 0 && (
                <button onClick={handleConfirmKill} disabled={killing}
                  style={{ padding: '7px 16px', borderRadius: '6px', border: 'none', cursor: killing ? 'default' : 'pointer', background: killing ? '#ccc' : '#eda100', color: 'white', fontSize: '13px', fontWeight: '500' }}>
                  {killing ? 'กำลังปิด...' : `ปิด ${selectedPids.size} ตัว`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// MARKER_CPU_DASHBOARD_TAB
function CpuLineChart({ history: historyRaw }) {
  const history = Array.isArray(historyRaw) ? historyRaw : [];
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !history.length) return;
    const labels = history.map(h => formatTime(h.recorded_at));
    const data = history.map(h => h.cpu_pct);

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      data: {
        labels,
        datasets: [
          {
            type: 'line', label: 'CPU', data,
            borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5,
            fill: false, tension: 0.35, order: 0,
            segment: { borderColor: c => (c.p1.parsed.y >= 70 ? '#e24b4a' : '#185FA5') },
            pointHoverBackgroundColor: c => (c.parsed.y >= 70 ? '#e24b4a' : '#185FA5'),
          },
          {
            type: 'line', label: 'เกณฑ์ 70%', data: labels.map(() => 70),
            borderColor: 'rgba(220,80,80,0.35)', borderWidth: 1,
            borderDash: [4, 4], pointRadius: 0, fill: false, order: 1,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#fcfcfb', titleColor: '#0b0b0b', bodyColor: '#52514e',
            borderColor: '#e1e0d9', borderWidth: 1, padding: 10, cornerRadius: 8,
            callbacks: {
              label: c => (c.dataset.label === 'เกณฑ์ 70%' ? null : ` CPU: ${c.parsed.y}%`),
            },
          },
        },
        scales: {
          y: { min: 0, max: 100, grid: { color: '#e8e7e1' }, ticks: { color: '#898781', font: { size: 11 }, callback: v => v + '%', stepSize: 25 } },
          x: { grid: { display: false }, ticks: { color: '#898781', font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        },
      },
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [history]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '190px' }}>
      <canvas ref={canvasRef} style={{ width: '100% !important', height: '100% !important' }} />
    </div>
  );
}

const CORE_COLORS = ['#185FA5','#0F6E56','#D85A30','#993C1D','#534AB7','#993556','#3B6D11','#854F0B'];

function PerCoreLineChart({ history: historyRaw }) {
  const history = Array.isArray(historyRaw) ? historyRaw : [];
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const rowsWithCore = history.filter(h => Array.isArray(h.per_core) && h.per_core.length);
    if (chartRef.current) chartRef.current.destroy();
    if (!rowsWithCore.length) return;

    const labels = history.map(h => formatTime(h.recorded_at));
    const coreCount = Math.max(...rowsWithCore.map(h => h.per_core.length));

    const datasets = [];
    for (let i = 0; i < coreCount; i++) {
      datasets.push({
        type: 'line', label: `Core ${i}`,
        data: history.map(h => {
          const entry = Array.isArray(h.per_core) ? h.per_core.find(c => c.core === i) : null;
          return entry ? entry.pct : null;
        }),
        borderColor: CORE_COLORS[i % CORE_COLORS.length],
        backgroundColor: CORE_COLORS[i % CORE_COLORS.length],
        borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4,
        fill: false, tension: 0.3, spanGaps: true,
      });
    }

    chartRef.current = new Chart(canvasRef.current, {
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 10 }, color: '#898781' } },
          tooltip: {
            backgroundColor: '#fcfcfb', titleColor: '#0b0b0b', bodyColor: '#52514e',
            borderColor: '#e1e0d9', borderWidth: 1, padding: 10, cornerRadius: 8,
            callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y}%` },
          },
        },
        scales: {
          y: { min: 0, max: 100, grid: { color: '#e8e7e1' }, ticks: { color: '#898781', font: { size: 11 }, callback: v => v + '%', stepSize: 25 } },
          x: { grid: { display: false }, ticks: { color: '#898781', font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        },
      },
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [history]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '220px' }}>
      <canvas ref={canvasRef} style={{ width: '100% !important', height: '100% !important' }} />
    </div>
  );
}

export function CPUDashboardTab() {
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [topProcesses, setTopProcesses] = useState([]);
  const [coreProcesses, setCoreProcesses] = useState([]); // process per core (live)
  const [liveCores, setLiveCores] = useState([]); // live % per core จาก /cpu-cores
  const [junkItems, setJunkItems] = useState([]);
  const [junkTotal, setJunkTotal] = useState('');
  const [junkLoading, setJunkLoading] = useState(false);
  const [junkClearing, setJunkClearing] = useState(false);
  const [junkResult, setJunkResult] = useState(null); // {ok, deletedLabel}

  const fetchAll = useCallback(async () => {
    try {
      const [cur, hist, cores] = await Promise.all([
        authFetch('/system/cpu-current'),
        authFetch('/system/cpu-history?hours=24'),
        authFetch('/system/cpu-cores').catch(() => null),
      ]);
      setCurrent(cur);
      setHistory(hist);
      if (cores?.topProcesses) setTopProcesses(cores.topProcesses);
      if (cores?.coreProcesses) setCoreProcesses(cores.coreProcesses);
      if (cores?.cores) setLiveCores(cores.cores);
      // sync totalPct จาก /cpu-cores (วัดพร้อมกับ per core ใน call เดียว)
      if (cores?.totalPct != null) setCurrent(prev => prev ? { ...prev, pct: cores.totalPct } : prev);
      setLastRefresh(Date.now());
    } catch (err) { console.error('CPU dashboard fetch error:', err); }
  }, []);

  const fetchJunk = useCallback(async () => {
    setJunkLoading(true);
    setJunkResult(null);
    try {
      const data = await authFetch('/system/disk-junk/scan');
      setJunkItems(data.items || []);
      setJunkTotal(data.totalLabel || '');
    } catch (err) { console.error('junk scan error:', err); }
    finally { setJunkLoading(false); }
  }, []);

  const clearJunk = useCallback(async (categories) => {
    setJunkClearing(true);
    try {
      const data = await authFetch('/system/disk-junk/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories }),
      });
      setJunkResult(data);
      await fetchJunk();
    } catch (err) { console.error('junk clear error:', err); }
    finally { setJunkClearing(false); }
  }, [fetchJunk]);

  useEffect(() => {
    fetchAll();
    fetchJunk();
    const interval = setInterval(fetchAll, 300000); // 5 นาที
    return () => clearInterval(interval);
  }, [fetchAll, fetchJunk]);

  if (!current) {
    return (
      <div style={{ padding: '20px 24px' }}>
        <div style={{ width: '120px', height: '20px', background: '#f0efec', borderRadius: '4px', marginBottom: '20px' }} />
        <div style={{ height: '80px', background: '#f0efec', borderRadius: '8px', marginBottom: '24px' }} />
        <div style={{ height: '190px', background: '#f0efec', borderRadius: '8px' }} />
      </div>
    );
  }

  const pct = current.pct ?? 0;
  const riskLabel = pct >= 70 ? 'เกินเกณฑ์วิกฤต' : pct >= 40 ? 'เข้าเกณฑ์เตือน' : 'ปกติ';
  const riskColor = pct >= 70 ? '#791F1F' : pct >= 40 ? '#856404' : '#27500A';
  const minutesAgo = Math.floor((Date.now() - lastRefresh) / 60000);

  // เติม "live point" จาก current.pct ต่อท้าย history เสมอ -- history จาก DB
  // อาจย้อนหลังได้ถึง 5 นาที (รอบ cron) และไม่ insert ถ้าค่าไม่เปลี่ยน (dedup)
  // ทำให้จุดขวาสุดของกราฟไม่ตรงกับตัวเลขใหญ่ (current) ที่เป็น live เป๊ะ ๆ
  // แก้โดยให้จุดขวาสุดอ้างอิง current.pct เสมอ -- จะได้ไม่มีวันไม่ sync กัน
  const historyWithLive = current
    ? [...history, { recorded_at: new Date().toISOString(), cpu_pct: pct, top_processes: null, per_core: [] }]
    : history;

  // ── หา Spike ล่าสุดที่มี top_processes เก็บไว้ (CPU >= 70% ตอนนั้น) ──
  const lastSpike = [...history].reverse().find(h => h.top_processes && h.top_processes.length);

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>⚡</span>
          <span style={{ fontSize: '15px', fontWeight: '500' }}>CPU monitor</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: '#888' }}>อัปเดตล่าสุด {minutesAgo < 1 ? 'เมื่อสักครู่' : `${minutesAgo} นาทีที่แล้ว`}</span>
          <button onClick={fetchAll} style={{ fontSize: '13px', padding: '6px 12px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', cursor: 'pointer' }}>รีเฟรช</button>
        </div>
      </div>

      <div style={{ background: '#fafaf8', borderRadius: '8px', padding: '16px 20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px' }}>
          <span style={{ fontSize: '34px', fontWeight: '500', color: riskColor, lineHeight: 1 }}>{pct}<span style={{ fontSize: '16px' }}>%</span></span>
          <span style={{ fontSize: '12px', color: riskColor }}>{riskLabel}</span>
        </div>
        <div style={{ height: '6px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden', position: 'relative' }}>
          <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: 'linear-gradient(90deg, #185FA5, #e24b4a)', borderRadius: '3px' }} />
          <div style={{ position: 'absolute', left: '70%', top: '-2px', width: '1px', height: '10px', background: '#999' }} />
        </div>
      </div>

      <p style={{ fontSize: '13px', fontWeight: '500', margin: '0 0 8px' }}>CPU ย้อนหลัง 24 ชั่วโมง</p>
      <div style={{ marginBottom: '24px' }}>
        <CpuLineChart history={historyWithLive} />
      </div>

      <p style={{ fontSize: '13px', fontWeight: '500', margin: '0 0 8px' }}>CPU แต่ละ Core ย้อนหลัง 24 ชั่วโมง</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '24px' }}>
        {(() => {
          const rowsWithCore = history.filter(h => Array.isArray(h.per_core) && h.per_core.length > 0);
          const coreCount = rowsWithCore.length > 0 ? Math.max(...rowsWithCore.map(h => h.per_core.length)) : 4;
          const COLORS = ['#185FA5','#0F6E56','#D85A30','#E24B4A'];
          return Array.from({ length: coreCount }, (_, i) => {
            const color = COLORS[i % COLORS.length];
            // ใช้ live % จาก /cpu-cores ก่อน ถ้าไม่มีค่อย fallback ไป snapshot
            const liveEntry = liveCores.find(c => c.core === i || c.InstanceName === String(i));
            const latestPct = liveEntry
              ? Math.round(liveEntry.CookedValue ?? liveEntry.pct ?? 0)
              : (() => {
                  for (let j = history.length - 1; j >= 0; j--) {
                    const e = (history[j].per_core || []).find(c => c.core === i);
                    if (e) return e.pct;
                  }
                  return null;
                })();
            // สร้าง sparkline points จาก history ย้อนหลัง 20 จุดล่าสุด
            const pts = history.slice(-20).map((h, idx) => {
              const e = (h.per_core || []).find(c => c.core === i);
              const pct = e ? e.pct : null;
              return { x: idx, y: pct };
            }).filter(p => p.y !== null);
            const W = 110, H = 34;
            const toSvgY = p => H - (p / 100) * H;
            const polyPts = pts.map((p, idx) => `${(idx / Math.max(pts.length - 1, 1)) * W},${toSvgY(p.y)}`).join(' ');
            const fillPts = pts.length > 0
              ? `${polyPts} ${(pts.length - 1) / Math.max(pts.length - 1, 1) * W},${H} 0,${H}`
              : '';
            // process ที่รันบน core นี้ (จาก live coreProcesses)
            const procs = coreProcesses.filter(p => p.core === i).slice(0, 3);
            return (
              <div key={i} style={{ background: '#fafaf8', border: '0.5px solid #e8e8e8', borderRadius: '10px', padding: '12px 13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                  <span style={{ fontSize: '11px', color: '#666', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: color, display: 'inline-block' }} />
                    Core {i}
                  </span>
                  <span style={{ fontSize: '17px', fontWeight: '500', color: latestPct !== null ? color : '#bbb' }}>
                    {latestPct !== null ? `${latestPct}%` : '—'}
                  </span>
                </div>
                <div style={{ height: '3px', background: '#eee', borderRadius: '2px', marginBottom: '7px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${latestPct ?? 0}%`, background: color, borderRadius: '2px' }} />
                </div>
                {pts.length > 1 ? (
                  <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
                    <polyline points={polyPts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
                    {fillPts && <polygon points={fillPts} fill={color} fillOpacity="0.08" stroke="none" />}
                  </svg>
                ) : (
                  <div style={{ height: `${H}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '10px', color: '#bbb' }}>รอข้อมูล...</span>
                  </div>
                )}
                <div style={{ borderTop: '0.5px solid #eee', paddingTop: '6px', marginTop: '4px' }}>
                  {procs.length > 0 ? procs.map((p, pi) => (
                    <div key={pi} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#888', lineHeight: '1.9' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100px' }}>{p.name}</span>
                      <span style={{ fontWeight: '500', color, flexShrink: 0 }}>{p.pct}%</span>
                    </div>
                  )) : (
                    <span style={{ fontSize: '10px', color: '#bbb' }}>ไม่มีข้อมูล process</span>
                  )}
                </div>
              </div>
            );
          });
        })()}
      </div>

      {/* ── Disk Junk Section ── */}
      <div style={{ borderTop: '0.5px solid #e8e8e8', margin: '0 0 18px' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px' }}>🗑</span>
          <span style={{ fontSize: '13px', fontWeight: '500' }}>Disk junk</span>
          {junkLoading && <span style={{ fontSize: '11px', color: '#aaa' }}>กำลังสแกน...</span>}
          {!junkLoading && junkTotal && <span style={{ fontSize: '11px', color: '#aaa' }}>พบ {junkTotal}</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={fetchJunk} disabled={junkLoading} style={{ fontSize: '12px', padding: '5px 11px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', cursor: 'pointer' }}>
            สแกนใหม่
          </button>
          <button
            onClick={() => clearJunk(junkItems.filter(j => j.bytes > 0).map(j => j.id))}
            disabled={junkClearing || junkLoading || junkItems.filter(j => j.bytes > 0).length === 0}
            style={{ fontSize: '12px', padding: '5px 11px', borderRadius: '6px', border: 'none', background: junkItems.filter(j=>j.bytes>0).length>0 ? '#791F1F' : '#ccc', color: 'white', cursor: 'pointer' }}
          >
            {junkClearing ? 'กำลังเคลียร์...' : `เคลียร์ทั้งหมด${junkTotal ? ` (${junkTotal})` : ''}`}
          </button>
        </div>
      </div>

      {junkResult && (
        <div style={{ background: junkResult.ok ? '#EAF3DE' : '#FCEBEB', border: `0.5px solid ${junkResult.ok ? '#C0DD97' : '#F7C1C1'}`, borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '12px', color: junkResult.ok ? '#085041' : '#791F1F' }}>
          {junkResult.ok ? `✓ เคลียร์เรียบร้อย คืน disk ได้ ${junkResult.deletedLabel} (${junkResult.deletedFiles} ไฟล์)` : 'เกิดข้อผิดพลาด'}
        </div>
      )}

      {junkItems.length > 0 && (
        <div style={{ border: '0.5px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden', marginBottom: '24px' }}>
          {junkItems.map((item, i) => {
            const badgeColor = item.level === 'safe' ? { bg: '#EAF3DE', color: '#27500A' } : { bg: '#FAEEDA', color: '#633806' };
            return (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 14px', borderBottom: i < junkItems.length - 1 ? '0.5px solid #e8e8e8' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '500' }}>{item.name}</span>
                    <span style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '20px', background: badgeColor.bg, color: badgeColor.color }}>{item.badge}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.paths.join(' · ')}
                  </div>
                </div>
                <span style={{ fontSize: '13px', fontWeight: '500', color: item.bytes > 0 ? '#791F1F' : '#bbb', width: '60px', textAlign: 'right', flexShrink: 0 }}>{item.sizeLabel}</span>
                <button
                  onClick={() => clearJunk([item.id])}
                  disabled={junkClearing || item.bytes === 0}
                  style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', color: item.bytes > 0 ? '#333' : '#bbb', cursor: item.bytes > 0 ? 'pointer' : 'default', flexShrink: 0 }}
                >
                  เคลียร์
                </button>
              </div>
            );
          })}
        </div>
      )}

      {topProcesses.length > 0 && (
        <>
          <p style={{ fontSize: '13px', fontWeight: '500', margin: '0 0 8px' }}>Process ที่กิน CPU สูงสุด (ตอนนี้)</p>
          <div style={{ border: '0.5px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden', marginBottom: '24px' }}>
            {topProcesses.slice(0, 8).map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '8px 14px', borderBottom: i < topProcesses.length - 1 ? '0.5px solid #e8e8e8' : 'none' }}>
                <span style={{ flex: 1, fontSize: '12px' }}>{p.Name}</span>
                <span style={{ fontSize: '11px', color: '#aaa', marginRight: '10px' }}>PID {p.Id}</span>
                <span style={{ fontSize: '12px', color: '#888' }}>{p.CPU ? `${Number(p.CPU).toFixed(1)}s` : '-'}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {lastSpike && (
        <>
          <p style={{ fontSize: '13px', fontWeight: '500', margin: '0 0 8px' }}>Process ที่กิน CPU สูงสุดตอน Spike ล่าสุด ({formatTime(lastSpike.recorded_at)})</p>
          <div style={{ border: '0.5px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden' }}>
            {(lastSpike.top_processes || []).slice(0, 5).map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: i < lastSpike.top_processes.length - 1 ? '0.5px solid #e8e8e8' : 'none' }}>
                <span style={{ flex: 1, fontSize: '13px' }}>{p.Name}</span>
                <span style={{ fontSize: '13px', color: '#888' }}>{p.CPU ? `${Number(p.CPU).toFixed(1)}s CPU time` : '-'}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// MARKER_STORAGE_DASHBOARD_TAB_V1 -- Storage Dashboard (System Console > Backend Ops): ความจุ / โควตา / ขนาดรายจุดเก็บ
const stFmt = (b) => {
  const n = Number(b) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(n >= 10737418240 ? 1 : 2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
};
const stColor = (lv) => (lv === 'red' ? '#c0392b' : lv === 'yellow' ? '#d97706' : '#0F6E56');
const stLevel = (p, y, r) => (p == null ? 'ok' : p >= r ? 'red' : p >= y ? 'yellow' : 'ok');

export function StorageDashboardTab() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async (refresh) => {
    setBusy(true); setErr('');
    try {
      const r = await authFetch('/file-storage/storage-stats' + (refresh ? '?refresh=1' : ''));
      if (r && r.error) setErr(r.error); else setD(r);
    } catch (e) { setErr('โหลดไม่สำเร็จ: ' + e.message); }
    setBusy(false);
  }, []);
  useEffect(() => { load(false); }, [load]);

  const save = async () => {
    setMsg('');
    const body = { quotas: {}, doa_max_periods: Number(edit.doa_max_periods), warn_yellow: Number(edit.warn_yellow), warn_red: Number(edit.warn_red), reserve_pct: Number(edit.reserve_pct) };
    Object.keys(edit.quotas).forEach((k) => { body.quotas[k] = Number(edit.quotas[k]); });
    try {
      const r = await authFetch('/file-storage/storage-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r && r.error) { setMsg(r.error); return; }
      setEdit(null); load(true);
    } catch (e) { setMsg('บันทึกไม่สำเร็จ: ' + e.message); }
  };

  const card = { background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 12 };
  const th = { textAlign: 'left', padding: '6px 8px', color: '#888', fontWeight: 600, fontSize: 12, borderBottom: '1px solid #e5e7eb' };
  const td = { padding: '6px 8px', fontSize: 13, borderBottom: '1px solid #f0f0f0' };
  const num = { textAlign: 'right' };
  const pill = (lv, t) => <span style={{ background: stColor(lv), color: '#fff', borderRadius: 10, padding: '1px 8px', fontSize: 11 }}>{t}</span>;
  const bar = (pct, col) => <div style={{ height: 10, background: '#e5e7eb', borderRadius: 6, overflow: 'hidden' }}><div style={{ width: Math.min(100, Math.max(0, pct || 0)) + '%', height: '100%', background: col }} /></div>;

  if (!d) return <div style={{ padding: 20, fontSize: 13, color: err ? '#c0392b' : '#888' }}>{err || 'กำลังโหลด…'}</div>;
  const cfg = d.config || {}; const Y = cfg.warn_yellow || 70; const R = cfg.warn_red || 90;
  const cap = d.capacity || {}; const capLv = stLevel(cap.pct, Y, R);
  const fc = d.forecast || {};
  const kpi = (k, v, s, c) => (<div style={{ ...card, marginBottom: 0, flex: '1 1 160px' }}><div style={{ fontSize: 12, color: '#888' }}>{k}</div><div style={{ fontSize: 22, fontWeight: 700, color: c || '#1f2937' }}>{v}</div><div style={{ fontSize: 12, color: '#888' }}>{s}</div></div>);

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto', background: '#f5f6fa', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: '#888' }}>อัปเดต {new Date(d.at).toLocaleString('th-TH')}{d.cached ? ' (แคช 2 นาที)' : ''}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setEdit({ quotas: { ...(cfg.quotas || {}) }, doa_max_periods: cfg.doa_max_periods, warn_yellow: cfg.warn_yellow, warn_red: cfg.warn_red, reserve_pct: cfg.reserve_pct })} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid #ddd', borderRadius: 6, background: 'white', cursor: 'pointer' }}>✎ ปรับโควตา (Owner)</button>
          <button onClick={() => load(true)} disabled={busy} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid #ddd', borderRadius: 6, background: 'white', cursor: 'pointer' }}>{busy ? 'กำลังโหลด…' : '↻ รีเฟรช'}</button>
        </div>
      </div>
      {err && <div style={{ ...card, color: '#c0392b' }}>{err}</div>}

      {(d.alerts || []).length > 0 && (
        <div style={{ ...card, borderColor: stColor(d.alerts.some((a) => a.level === 'red') ? 'red' : 'yellow') }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠ แจ้งเตือน ({d.alerts.length})</div>
          {d.alerts.map((a, i) => <div key={i} style={{ fontSize: 13 }}>{pill(a.level, a.level === 'red' ? 'แดง' : 'เหลือง')} {a.text}</div>)}
        </div>
      )}

      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>พื้นที่เก็บข้อมูล FASTAPN</div>
        {cap.source === 'none' ? (
          <div style={{ fontSize: 13, color: '#d97706' }}>อ่านความจุดิสก์ไม่ได้ — ตั้ง env STORAGE_CAPACITY_GB บน Server (ตอนนี้ข้อมูล FASTAPN ใช้ไป {stFmt(cap.app_bytes)})</div>
        ) : (<>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            {kpi('ข้อมูล FASTAPN ใช้ไป', stFmt(cap.app_bytes), 'ฐานข้อมูล ' + stFmt(cap.db_bytes) + ' + ไฟล์อัปโหลด ' + stFmt(cap.files_bytes), stColor(capLv))}
            {kpi('เก็บเพิ่มได้อีก', stFmt(cap.usable_free), 'พื้นที่ว่างรายไดรฟ์ หักสำรองให้เครื่อง ' + cap.reserve_pct + '%', stColor(capLv))}
            {kpi('พื้นที่ที่ FASTAPN ใช้ได้รวม', stFmt(cap.app_capacity), 'ใช้ไป ' + (cap.pct != null ? cap.pct : '-') + '% ของส่วนนี้')}
            {kpi('คาดว่าเต็มในอีก', fc.months_left != null ? '≈ ' + fc.months_left + ' เดือน' : '—', fc.per_month != null ? 'ข้อมูลโตเฉลี่ย ' + stFmt(fc.per_month) + '/เดือน' : 'ต้องมีประวัติ ≥ 7 วัน (ตอนนี้ ' + (fc.days_of_history || 0) + ' วัน)')}
          </div>
          {bar(cap.pct, stColor(capLv))}
          <div style={{ marginTop: 6 }}>{pill(capLv, 'ใช้ ' + (cap.pct != null ? cap.pct : '-') + '%')} <span style={{ fontSize: 12, color: '#888' }}>เหลือง ≥{Y}% · แดง ≥{R}% (คิดเทียบพื้นที่ที่ FASTAPN ใช้ได้รวม)</span></div>
          <div style={{ marginTop: 10, fontWeight: 600, fontSize: 13 }}>รายไดรฟ์ (ข้อมูลประกอบ — รวม Windows / โปรแกรมอื่นด้วย)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>ไดรฟ์ / ที่เก็บ</th><th style={{ ...th, ...num }}>ขนาดดิสก์</th><th style={{ ...th, ...num }}>FASTAPN</th><th style={{ ...th, ...num }}>อย่างอื่น (Windows/โปรแกรม)</th><th style={{ ...th, ...num }}>ว่าง</th><th style={{ ...th, ...num }}>เก็บเพิ่มได้ (หักสำรอง)</th><th style={th}>FASTAPN ใช้ของที่ได้</th><th style={{ ...th, ...num }}>ดิสก์ใช้ทั้งไดรฟ์</th></tr></thead>
            <tbody>{(d.drives || []).map((x, i) => { const lv = stLevel(x.app_pct, Y, R); return <tr key={i}><td style={td}>{x.label}<div style={{ fontSize: 11, color: '#888' }}>{x.path}</div></td><td style={{ ...td, ...num }}>{stFmt(x.total)}</td><td style={{ ...td, ...num }}>{stFmt(x.app)}</td><td style={{ ...td, ...num }}>{stFmt(x.other)}</td><td style={{ ...td, ...num }}>{stFmt(x.free)}</td><td style={{ ...td, ...num }}><b>{stFmt(x.usable_free)}</b></td><td style={td}>{pill(lv, x.app_pct + '%')}</td><td style={{ ...td, ...num, color: '#888' }}>{x.used_pct}%</td></tr>; })}</tbody></table>
        </>)}
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>โควตาแยกตามกลุ่ม</div>
        {(d.groups || []).map((g) => {
          const lv = stLevel(g.use_pct, Y, R);
          return (
            <div key={g.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,1.3fr) 3fr 210px', gap: 8, alignItems: 'center', padding: '5px 0' }}>
              <span style={{ fontSize: 13 }}>{g.label}</span>
              {bar(g.use_pct, stColor(lv))}
              <span style={{ fontSize: 13 }}><b>{stFmt(g.bytes)}</b> / {g.quota_bytes ? stFmt(g.quota_bytes) : '-'} ({g.quota_pct}%) {g.use_pct != null && pill(lv, g.use_pct + '%')}</span>
            </div>
          );
        })}
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>% ท้ายแถว = ใช้ไปเทียบกับโควตาของกลุ่ม · โควตาเป็น % ของ "พื้นที่ที่ FASTAPN ใช้ได้รวม" (ข้อมูล FASTAPN + เก็บเพิ่มได้) · กลุ่ม "ไฟล์ที่อัปโหลด" นับจากไฟล์จริงบนดิสก์ ({d.files.scanned}/{d.files.total} ไฟล์{d.files.truncated ? ' — สแกนไม่ครบ' : ''})</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 12 }}>
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Detail of Account แยกตามชนิด</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Kind</th><th style={{ ...th, ...num }}>ไฟล์</th><th style={{ ...th, ...num }}>BU</th><th style={{ ...th, ...num }}>ขนาด</th></tr></thead>
            <tbody>{(d.doa.by_kind || []).map((r) => <tr key={r.kind}><td style={td}><b>{r.kind}</b>{r.kind === 'TBRAW' ? ' (TB ทั้งไฟล์)' : ''}</td><td style={{ ...td, ...num }}>{r.files}</td><td style={{ ...td, ...num }}>{r.bus}</td><td style={{ ...td, ...num }}>{stFmt(r.bytes)}</td></tr>)}</tbody></table>
          <div style={{ fontWeight: 600, margin: '10px 0 4px' }}>BU ที่ใช้พื้นที่มากสุด (Top 5)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>{(d.doa.top_bu || []).map((r, i) => <tr key={i}><td style={td}>{r.bu}</td><td style={td}>{r.kind}</td><td style={{ ...td, ...num }}>{r.files} ไฟล์</td><td style={{ ...td, ...num }}>{stFmt(r.bytes)}</td></tr>)}</tbody></table>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>เพดานงวดต่อ BU (TBRAW) — สูงสุด {d.doa.max_periods} งวด</div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>เกินเพดานแล้วแจ้งเตือนให้ย้ายไป SharePoint — ระบบไม่ลบเอง</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>BU</th><th style={{ ...th, ...num }}>งวดที่เก็บ</th><th style={{ ...th, ...num }}>เพดาน</th><th style={th}>สถานะ</th></tr></thead>
            <tbody>{(d.doa.periods || []).slice(0, 12).map((r) => <tr key={r.bu}><td style={td}>{r.bu}</td><td style={{ ...td, ...num }}>{r.periods}</td><td style={{ ...td, ...num }}>{r.max}</td><td style={td}>{pill(r.level, r.level === 'red' ? 'เต็มเพดาน' : r.level === 'yellow' ? 'ใกล้เต็ม' : 'ปกติ')}</td></tr>)}</tbody></table>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Memory ใน Process</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
            <tr><td style={td}>RSS (รวม)</td><td style={{ ...td, ...num }}>{stFmt(d.process.rss)}</td></tr>
            <tr><td style={td}>Heap ที่ใช้ / จัดสรร</td><td style={{ ...td, ...num }}>{stFmt(d.process.heapUsed)} / {stFmt(d.process.heapTotal)}</td></tr>
            <tr><td style={td}>External + Buffers</td><td style={{ ...td, ...num }}>{stFmt(d.process.external)}</td></tr>
            {(d.mem_caches || []).map((c, i) => <tr key={i}><td style={td}>{c.name} ({c.entries} รายการ)</td><td style={{ ...td, ...num }}>{stFmt(c.bytes)}</td></tr>)}
          </tbody></table>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>ไฟล์บนดิสก์ แยกตาม module / สถานะ</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Module</th><th style={th}>สถานะ</th><th style={{ ...th, ...num }}>ไฟล์</th><th style={{ ...th, ...num }}>ขนาด</th></tr></thead>
            <tbody>{(d.files.rows || []).map((r, i) => <tr key={i}><td style={td}>{r.module}</td><td style={td}>{r.status}</td><td style={{ ...td, ...num }}>{r.files}{r.missing ? <span style={{ color: '#d97706' }}> (+{r.missing} หาย)</span> : null}</td><td style={{ ...td, ...num }}>{stFmt(r.bytes)}</td></tr>)}</tbody></table>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>ตารางใหญ่สุด (Top 10 จาก {d.table_count} ตาราง)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>ตาราง</th><th style={th}>กลุ่ม</th><th style={{ ...th, ...num }}>แถว</th><th style={{ ...th, ...num }}>ข้อมูล</th><th style={{ ...th, ...num }}>Index</th><th style={{ ...th, ...num }}>รวม</th></tr></thead>
          <tbody>{(d.tables || []).map((t) => <tr key={t.name}><td style={td}>{t.name}</td><td style={td}>{(d.groups.find((g) => g.key === t.group) || {}).label}</td><td style={{ ...td, ...num }}>{t.rows.toLocaleString()}</td><td style={{ ...td, ...num }}>{stFmt(t.tbl)}</td><td style={{ ...td, ...num }}>{stFmt(t.idx)}</td><td style={{ ...td, ...num }}><b>{stFmt(t.total)}</b></td></tr>)}</tbody></table>
      </div>

      {edit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }} onClick={() => setEdit(null)}>
          <div style={{ background: 'white', borderRadius: 10, padding: 16, width: 420, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>ปรับโควตา (% ของความจุทั้งหมด)</div>
            {(d.groups || []).map((g) => (
              <div key={g.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: 13 }}>
                <span>{g.label}</span>
                <input type="number" min="0" max="100" value={edit.quotas[g.key]} onChange={(e) => setEdit({ ...edit, quotas: { ...edit.quotas, [g.key]: e.target.value } })} style={{ width: 70, textAlign: 'right' }} />
              </div>
            ))}
            <div style={{ fontSize: 12, color: Object.values(edit.quotas).reduce((s, v) => s + Number(v || 0), 0) > 100 ? '#c0392b' : '#888', margin: '4px 0 8px' }}>รวม {Object.values(edit.quotas).reduce((s, v) => s + Number(v || 0), 0)}% (ต้องไม่เกิน 100)</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}><span>เพดานงวดต่อ BU (TBRAW)</span><input type="number" min="1" value={edit.doa_max_periods} onChange={(e) => setEdit({ ...edit, doa_max_periods: e.target.value })} style={{ width: 70, textAlign: 'right' }} /></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}><span>เตือนเหลือง (%)</span><input type="number" min="1" max="100" value={edit.warn_yellow} onChange={(e) => setEdit({ ...edit, warn_yellow: e.target.value })} style={{ width: 70, textAlign: 'right' }} /></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}><span>เตือนแดง (%)</span><input type="number" min="1" max="100" value={edit.warn_red} onChange={(e) => setEdit({ ...edit, warn_red: e.target.value })} style={{ width: 70, textAlign: 'right' }} /></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}><span>กันที่ว่างไว้ให้เครื่อง (%)</span><input type="number" min="0" max="60" value={edit.reserve_pct} onChange={(e) => setEdit({ ...edit, reserve_pct: e.target.value })} style={{ width: 70, textAlign: 'right' }} /></div>
            {msg && <div style={{ color: '#c0392b', fontSize: 12, marginTop: 6 }}>{msg}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
              <button onClick={() => setEdit(null)} style={{ padding: '5px 12px', border: '1px solid #ddd', borderRadius: 6, background: 'white', cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={save} style={{ padding: '5px 12px', border: 'none', borderRadius: 6, background: '#1a3a5c', color: 'white', cursor: 'pointer' }}>บันทึก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
