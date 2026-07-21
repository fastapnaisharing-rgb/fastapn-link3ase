import React, { useState, useEffect, useRef, useCallback } from 'react';
import Chart from 'chart.js/auto';

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