import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../supabase';
import * as XLSX from 'xlsx';
import { useAuth } from '../contexts/AuthContext';
import { useUserRole } from '../contexts/useUserRole';

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return width;
}

function ComboBox({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(value || '');
  const ref = useRef(null);
  useEffect(() => { setInput(value || ''); }, [value]);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const filtered = [...new Set(options.filter(o => o && o !== '-' && o.toLowerCase().includes(input.toLowerCase())))].slice(0, 20);
  return (
    <div ref={ref} style={{ position: 'relative', marginBottom: '8px' }}>
      <input value={input} onChange={e => { setInput(e.target.value); onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={placeholder || ''}
        style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', width: '100%', boxSizing: 'border-box' }} />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #ddd', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 1000, maxHeight: '180px', overflowY: 'auto' }}>
          {filtered.map((opt, i) => (
            <div key={i} onMouseDown={() => { setInput(opt); onChange(opt); setOpen(false); }}
              style={{ padding: '7px 10px', fontSize: '12px', cursor: 'pointer', borderBottom: '0.5px solid #f5f5f5' }}
              onMouseEnter={e => e.target.style.background = '#f0f7ff'}
              onMouseLeave={e => e.target.style.background = 'white'}>{opt}</div>
          ))}
        </div>
      )}
    </div>
  );
}

const COLUMNS = [
  { key: 'code',        label: 'Code',        w: 100, sortable: true },
  { key: 'itemcode2',   label: '2Itemcode',   w: 100 },
  { key: 'bu',          label: 'BU',          w: 70 },
  { key: 'description', label: 'Description', w: null },
  { key: 'cpc',         label: 'CPC',         w: 80 },
  { key: 'account',     label: 'Account',     w: 100 },
  { key: 'sub',         label: 'SUB',         w: 70 },
  { key: 'dis_g',       label: 'Dis-G',       w: 70 },
  { key: 'i_and_g',     label: 'I&G',         w: 70 },
  { key: 'value',       label: 'VALUE',       w: 70 },
  { key: 'oth',         label: 'OTH',         w: 70 },
  { key: 'spi1',        label: 'SPI-1',       w: 70 },
  { key: 'spec_tx',     label: 'SPEC-TX',     w: 80 },
];

const EDIT_FIELDS = [
  ['itemcode2','2Itemcode'],['bu','BU'],['description','Description'],
  ['cpc','CPC'],['account','Account'],['sub','SUB'],['dis_g','Dis-G'],
  ['i_and_g','I&G'],['value','VALUE'],['oth','OTH'],['spi1','SPI-1'],
  ['spec_tx','SPEC-TX'],['keyword','Keyword'],
];
const COMBO_FIELDS = ['bu','sub','dis_g','i_and_g','value','oth','spi1','spec_tx'];

function ItemCodeList() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState([]);
  const [importing, setImporting] = useState(false);
  const [editId, setEditId] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [nextCode, setNextCode] = useState('');
  const [selected, setSelected] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const fileInputRef = useRef(null);
  const theadRef = useRef(null);
  const tbodyRef = useRef(null);
  const containerRef = useRef(null);
  const [containerW, setContainerW] = useState(0);
  const { currentUser, userName } = useAuth();
  const { isAdmin, isOwner } = useUserRole();
  const screenWidth = useWindowWidth();
  const isMobile = screenWidth < 768;
  const isTablet = screenWidth >= 768 && screenWidth < 1200;

  const [form, setForm] = useState({
    itemcode2:'', bu:'', description:'', cpc:'', account:'', sub:'',
    dis_g:'', i_and_g:'', value:'', oth:'', spi1:'', spec_tx:'', keyword:''
  });

  useEffect(() => {
    if (!containerRef.current) return;
    setContainerW(containerRef.current.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => setContainerW(entries[0].contentRect.width));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const syncScroll = () => { if (theadRef.current && tbodyRef.current) theadRef.current.scrollLeft = tbodyRef.current.scrollLeft; };

  // ✅ แก้ไข: filter ที่ DB เลย ไม่ดึง deleted มาด้วย
  const fetchData = async () => {
    const { data, error } = await supabase
      .from('itemcode_list')
      .select('*')
      .or('deleted.is.null,deleted.eq.false');
    if (error) { console.error('fetchData error:', error); return; }
    const result = (data || []).map(item => ({
      ...item,
      code:      item.code      || '',
      itemcode2: item.itemcode2 || item['2Itemcode'] || '',
      i_and_g:   item.i_and_g   || item['I & G']  || '',
      spi1:      item.spi1      || item['SPI-1']   || '',
    }));
    setItems(result);
    computeNextCode(result);
  };

  const computeNextCode = (data) => {
    const nums = data.map(d=>d.code||'').filter(c=>/^C\d{7}$/.test(c)).map(c=>parseInt(c.replace('C',''),10)).sort((a,b)=>a-b);
    if (!nums.length) { setNextCode('C0000001'); return; }
    for (let i=0;i<nums.length-1;i++) { if (nums[i+1]-nums[i]>1) { setNextCode(`C${String(nums[i]+1).padStart(7,'0')}`); return; } }
    setNextCode(`C${String(nums[nums.length-1]+1).padStart(7,'0')}`);
  };

  const getCodePool = (data) => {
    const nums = data.map(d=>d.code||'').filter(c=>/^C\d{7}$/.test(c)).map(c=>parseInt(c.replace('C',''),10)).sort((a,b)=>a-b);
    const gaps = [];
    for (let i=0;i<nums.length-1;i++) for (let g=nums[i]+1;g<nums[i+1];g++) gaps.push(g);
    const max = nums.length>0?nums[nums.length-1]:0;
    let idx=0;
    return () => idx<gaps.length?`C${String(gaps[idx++]).padStart(7,'0')}`:`C${String(max+(idx++-gaps.length+1)).padStart(7,'0')}`;
  };

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { setPage(1); }, [search]);

  const getOptions = (field) => [...new Set(items.map(i=>i[field]||'').filter(v=>v&&v!=='-'))].sort();
  const resetForm = () => setForm({ itemcode2:'',bu:'',description:'',cpc:'',account:'',sub:'',dis_g:'',i_and_g:'',value:'',oth:'',spi1:'',spec_tx:'',keyword:'' });
  const getTimestamp = () => { const n=new Date(); return `${String(n.getDate()).padStart(2,'0')}/${String(n.getMonth()+1).padStart(2,'0')}/${n.getFullYear()} ${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`; };

  const handleSave = async () => {
    const data = { ...form, username: userName||currentUser?.email||'', last_update: getTimestamp() };
    if (editId) { await supabase.from('itemcode_list').update(data).eq('id',editId); }
    else { await supabase.from('itemcode_list').insert([{ ...data, code: nextCode }]); }
    setShowForm(false); setEditId(null); resetForm(); fetchData();
  };

  const handleEdit = (item) => {
    setForm({ itemcode2:item.itemcode2||'',bu:item.bu||'',description:item.description||'',cpc:item.cpc||'',account:item.account||'',sub:item.sub||'',dis_g:item.dis_g||'',i_and_g:item.i_and_g||'',value:item.value||'',oth:item.oth||'',spi1:item.spi1||'',spec_tx:item.spec_tx||'',keyword:item.keyword||'' });
    setEditId(item.id); setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ต้องการลบรายการนี้?')) return;
    try {
      const item = items.find(i => i.id === id);
      await supabase.from('recycle_bin').insert([{
        source_table: 'itemcode_list',
        source_id: id,
        source_key: item?.code || id,
        data: item,
        deleted_by: userName || currentUser?.email || '',
        deleted_at: new Date().toISOString(),
      }]);
      const { error } = await supabase.from('itemcode_list')
        .update({ deleted: true, deleted_by: userName || currentUser?.email || '', deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      setSelected(prev => prev.filter(s => s !== id));
      fetchData();
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`ต้องการลบ ${selected.length} รายการ?`)) return;
    try {
      const now = new Date().toISOString();
      const bins = items.filter(i => selected.includes(i.id)).map(item => ({
        source_table: 'itemcode_list',
        source_id: item.id,
        source_key: item.code || item.id,
        data: item,
        deleted_by: userName || currentUser?.email || '',
        deleted_at: now,
      }));
      if (bins.length) await supabase.from('recycle_bin').insert(bins);
      const { error } = await supabase.from('itemcode_list')
        .update({ deleted: true, deleted_by: userName || currentUser?.email || '', deleted_at: now })
        .in('id', selected);
      if (error) throw error;
      setSelected([]); fetchData();
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([['itemcode2','bu','description','cpc','account','sub','dis_g','i_and_g','value','oth','spi1','spec_tx','keyword']]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'ItemcodeList');
    XLSX.writeFile(wb,'ItemcodeList_Template.xlsx');
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => { const wb=XLSX.read(evt.target.result,{type:'binary'}); setPreviewData(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''})); setShowPreview(true); };
    reader.readAsBinaryString(file); e.target.value='';
  };

  const handleConfirmImport = async () => {
    setImporting(true);
    try {
      const getNextCode = getCodePool(items);
      for (let i=0;i<previewData.length;i+=500) {
        const batch = previewData.slice(i,i+500).map(row => ({
          code: getNextCode(),
          itemcode2:String(row['itemcode2']??row['2Itemcode']??''),
          bu:String(row['bu']??''), description:String(row['description']??''),
          cpc:String(row['cpc']??''), account:String(row['account']??''),
          sub:String(row['sub']??''),
          dis_g:  String(row['dis_g']??'').trim()||'-',
          i_and_g:String(row['i_and_g']??row['I & G']??'').trim()||'-',
          value:  String(row['value']??'').trim()||'-',
          oth:    String(row['oth']??'').trim()||'-',
          spi1:   String(row['spi1']??row['SPI-1']??'').trim()||'-',
          spec_tx:String(row['spec_tx']??'').trim()||'-',
          keyword:String(row['keyword']??''),
          username:userName||currentUser?.email||'',
          last_update:getTimestamp(),
        }));
        await supabase.from('itemcode_list').insert(batch);
      }
      setShowPreview(false); setPreviewData([]); fetchData();
      alert(`✅ Import สำเร็จ ${previewData.length} รายการ`);
    } catch (err) { alert('เกิดข้อผิดพลาด: '+err.message); }
    setImporting(false);
  };

  const filtered = useMemo(() => items
    .filter(i => !search || (
      i.code?.toLowerCase().includes(search.toLowerCase()) ||
      i.itemcode2?.toLowerCase().includes(search.toLowerCase()) ||
      i.bu?.toLowerCase().includes(search.toLowerCase()) ||
      i.description?.toLowerCase().includes(search.toLowerCase()) ||
      i.cpc?.toLowerCase().includes(search.toLowerCase()) ||
      i.account?.includes(search) ||
      i.sub?.toLowerCase().includes(search.toLowerCase()) ||
      i.dis_g?.toLowerCase().includes(search.toLowerCase()) ||
      i.i_and_g?.toLowerCase().includes(search.toLowerCase()) ||
      i.spi1?.toLowerCase().includes(search.toLowerCase()) ||
      i.spec_tx?.toLowerCase().includes(search.toLowerCase()) ||
      i.keyword?.toLowerCase().includes(search.toLowerCase())
    ))
    .sort((a,b) => { const ca=a.code||'',cb=b.code||''; return sortDir==='asc'?ca.localeCompare(cb):cb.localeCompare(ca); }),
    [items, search, sortDir]
  );

  const effectivePageSize = pageSize === 0 ? filtered.length || 1 : pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePageSize));
  const paginated = pageSize === 0 ? filtered : filtered.slice((page-1)*effectivePageSize, page*effectivePageSize);

  const getPageWindow = () => {
    const size = isMobile ? 3 : 5;
    let start = Math.max(1, page - Math.floor(size/2));
    let end = Math.min(totalPages, start + size - 1);
    if (end - start < size - 1) start = Math.max(1, end - size + 1);
    const pages = []; for (let i=start;i<=end;i++) pages.push(i); return pages;
  };

  const actionW = isAdmin ? (56*2)+20 : 56+20;
  const fixedW = 36 + COLUMNS.filter(c=>c.w).reduce((s,c)=>s+c.w,0) + actionW;
  const totalW = containerW > 0 ? Math.max(fixedW + 100, containerW) : fixedW + 200;

  const S = {
    container: { padding:isMobile?'12px':'20px', display:'flex', flexDirection:'column', height:'100vh', boxSizing:'border-box', minWidth:0, overflow:'hidden' },
    topbar: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px', flexShrink:0, flexWrap:'wrap', gap:'8px' },
    btn: { padding:isMobile?'6px 10px':'7px 14px', borderRadius:'6px', border:'none', cursor:'pointer', fontSize:'13px', marginLeft:'8px' },
    outer: { background:'white', borderRadius:'8px', border:'0.5px solid #e8e8e8', overflow:'hidden', display:'flex', flexDirection:'column', flex:1, minWidth:0 },
    theadWrap: { overflowX:'auto', flexShrink:0, scrollbarWidth:'none' },
    tbodyWrap: { overflowY:'auto', overflowX:'auto', flex:1, minWidth:0 },
    table: { borderCollapse:'collapse', fontSize:'11px', tableLayout:'fixed' },
    th: { background:'#1a3a5c', color:'white', padding:'10px', textAlign:'left', fontSize:'11px', fontWeight:'500', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' },
    thSort: { background:'#1a3a5c', color:'white', padding:'10px', textAlign:'left', fontSize:'11px', fontWeight:'500', whiteSpace:'nowrap', cursor:'pointer', userSelect:'none', overflow:'hidden', textOverflow:'ellipsis' },
    thCheck: { background:'#1a3a5c', color:'white', padding:'10px', textAlign:'center', fontSize:'11px', width:'36px' },
    thAction: { background:'#1a3a5c', color:'white', padding:'10px', textAlign:'center', fontSize:'11px', fontWeight:'500' },
    td: { padding:'7px 10px', fontSize:'11px', borderBottom:'0.5px solid #f0f0f0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'0' },
    tdCenter: { padding:'6px 8px', fontSize:'11px', borderBottom:'0.5px solid #f0f0f0', textAlign:'center' },
    input: { padding:'7px 10px', borderRadius:'6px', border:'1px solid #ddd', fontSize:'13px', width:'100%', marginBottom:'8px', boxSizing:'border-box' },
    inputDisabled: { padding:'7px 10px', borderRadius:'6px', border:'1px solid #eee', fontSize:'13px', width:'100%', marginBottom:'8px', boxSizing:'border-box', background:'#f5f5f5', color:'#999' },
    overlay: { position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999 },
    modal: { background:'white', borderRadius:'10px', width:isMobile?'95vw':'500px', maxHeight:'85vh', display:'flex', flexDirection:'column' },
    iconBtn: (color,bg,border) => ({ background:bg||'none', border:`0.5px solid ${border||color}`, borderRadius:'4px', cursor:'pointer', padding:'3px 6px', color, fontSize:'12px', lineHeight:1 }),
    pageBtn: (active,disabled) => ({ padding:'3px 8px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', cursor:disabled?'default':'pointer', background:active?'#1a3a5c':'white', color:disabled?'#ccc':active?'white':'#555', minWidth:'28px', textAlign:'center' }),
  };

  const renderColGroup = () => (
    <colgroup>
      <col style={{ width:'36px', minWidth:'36px' }} />
      {COLUMNS.map((c,i) => c.w ? <col key={i} style={{ width:`${c.w}px`, minWidth:`${c.w}px` }} /> : <col key={i} />)}
      <col style={{ width:`${actionW}px`, minWidth:`${actionW}px` }} />
    </colgroup>
  );

  const renderInfoText = () => {
    if (isMobile) return `${filtered.length} รายการ`;
    const start = (page-1)*effectivePageSize+1;
    const end = Math.min(page*effectivePageSize, filtered.length);
    return `แสดง ${start}-${end} จาก ${filtered.length} รายการ${search?` | ค้นหา "${search}"`:''}${selected.length>0?` | เลือกอยู่ ${selected.length} รายการ`:''}`;
  };

  return (
    <div style={S.container}>
      {/* Top bar */}
      <div style={S.topbar}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
          <h2 style={{ fontSize:isMobile?'14px':'16px', fontWeight:'600', margin:0 }}>🔖 Item Code List</h2>
          {isAdmin && selected.length>0 && <button style={{...S.btn,background:'#c0392b',color:'white',marginLeft:0}} onClick={handleBulkDelete}>🗑️{!isMobile&&` ลบ ${selected.length}`}</button>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'4px' }}>
          <button style={{...S.btn,background:'#0F6E56',color:'white'}} onClick={handleDownloadTemplate}>⬇{!isMobile&&' Template'}</button>
          <button style={{...S.btn,background:'#5DCAA5',color:'#1a3a5c'}} onClick={()=>fileInputRef.current.click()}>📂{!isMobile&&' Import'}</button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }} onChange={handleFileChange} />
          <button style={{...S.btn,background:'#1a3a5c',color:'white'}} onClick={()=>{setShowForm(true);setEditId(null);resetForm();}}>+ New</button>
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', padding:'6px 0', margin:'4px 0', flexShrink:0, gap:'8px', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <input
            placeholder={isMobile?'Search...':'Search Code, Description, BU, Account...'}
            value={search} onChange={e=>setSearch(e.target.value)}
            style={{ padding:'5px 10px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', width:isMobile?'140px':isTablet?'180px':'240px' }}
          />
          {!isMobile && <span style={{ fontSize:'12px', color:'#888', whiteSpace:'nowrap' }}>{renderInfoText()}</span>}
          {nextCode && !isMobile && <span style={{ fontSize:'12px', color:'#1a3a5c', fontWeight:'500', whiteSpace:'nowrap' }}>Next Code: {nextCode}</span>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'4px', flexShrink:0 }}>
          <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}}
            style={{ padding:'3px 6px', borderRadius:'6px', border:'0.5px solid #ddd', fontSize:'12px', background:'white', cursor:'pointer' }}>
            {[25,50,100,200,0].map(s=><option key={s} value={s}>{s===0?'ทั้งหมด':s}</option>)}
          </select>
          {!isMobile && <span style={{ fontSize:'12px', color:'#888' }}>รายการ/หน้า</span>}
          <button style={S.pageBtn(false,page===1)} disabled={page===1} onClick={()=>setPage(1)}>«</button>
          <button style={S.pageBtn(false,page===1)} disabled={page===1} onClick={()=>setPage(p=>p-1)}>‹</button>
          {getPageWindow().map(p=>(
            <button key={p} style={S.pageBtn(p===page,false)} onClick={()=>setPage(p)}>{p}</button>
          ))}
          <button style={S.pageBtn(false,page>=totalPages)} disabled={page>=totalPages} onClick={()=>setPage(p=>p+1)}>›</button>
          <button style={S.pageBtn(false,page>=totalPages)} disabled={page>=totalPages} onClick={()=>setPage(totalPages)}>»</button>
          <span style={{ fontSize:'12px', color:'#888', marginLeft:'2px', whiteSpace:'nowrap' }}>{page} / {totalPages}</span>
        </div>
      </div>

      {/* Table */}
      <div ref={containerRef} style={S.outer}>
        <div ref={theadRef} style={{...S.theadWrap, msOverflowStyle:'none'}}>
          <table style={{...S.table, width:`${totalW}px`}}>
            {renderColGroup()}
            <thead>
              <tr>
                <th style={S.thCheck}>
                  <input type="checkbox"
                    checked={paginated.length>0&&paginated.every(i=>selected.includes(i.id))}
                    onChange={()=>{ const ids=paginated.map(i=>i.id); const all=ids.every(id=>selected.includes(id)); setSelected(all?selected.filter(id=>!ids.includes(id)):[...new Set([...selected,...ids])]); }} />
                </th>
                {COLUMNS.map(c => (
                  <th key={c.key} style={c.sortable?S.thSort:S.th} onClick={c.sortable?()=>setSortDir(d=>d==='asc'?'desc':'asc'):undefined}>
                    {c.label}{c.sortable?(sortDir==='asc'?' ▲':' ▼'):''}
                  </th>
                ))}
                <th style={S.thAction}>Action</th>
              </tr>
            </thead>
          </table>
        </div>
        <div ref={tbodyRef} style={S.tbodyWrap} className="table-scroll" onScroll={syncScroll}>
          <table style={{...S.table, width:`${totalW}px`}}>
            {renderColGroup()}
            <tbody>
              {paginated.map(item => (
                <tr key={item.id} style={{ background:selected.includes(item.id)?'#f0f7ff':'white' }}>
                  <td style={S.tdCenter}>
                    <input type="checkbox" checked={selected.includes(item.id)} onChange={()=>setSelected(prev=>prev.includes(item.id)?prev.filter(s=>s!==item.id):[...prev,item.id])} />
                  </td>
                  {COLUMNS.map(c => (
                    <td key={c.key} style={S.td} title={item[c.key]||''}>{item[c.key]||'-'}</td>
                  ))}
                  <td style={S.tdCenter}>
                    <div style={{ display:'inline-flex', alignItems:'center', gap:'4px' }}>
                      <button onClick={()=>handleEdit(item)} style={S.iconBtn('#555','#f5f5f5','#ddd')}>✏️</button>
                      {isAdmin && <button onClick={()=>handleDelete(item.id)} style={S.iconBtn('#791F1F','#FCEBEB','#f7c1c1')}>🗑️</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={{ padding:'16px 20px', borderBottom:'1px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
              <h3 style={{ fontSize:'15px', margin:0 }}>{editId?'✏️ Edit Item Code':'+ New Item Code'}</h3>
              <div style={{ display:'flex', gap:'8px' }}>
                <button style={{...S.btn,background:'#f0f0f0',marginLeft:0}} onClick={()=>setShowForm(false)}>Cancel</button>
                <button style={{...S.btn,background:'#1a3a5c',color:'white',marginLeft:0}} onClick={handleSave}>Save</button>
              </div>
            </div>
            <div style={{ padding:'16px 20px', overflowY:'auto', flex:1 }}>
              <label style={{ fontSize:'11px', color:'#888' }}>Code</label>
              <input style={S.inputDisabled} value={editId?(items.find(i=>i.id===editId)?.code||''):nextCode} disabled />
              {EDIT_FIELDS.map(([key,label]) => (
                <div key={key} style={{ marginBottom:'4px' }}>
                  <label style={{ fontSize:'11px', color:'#888', display:'block', marginBottom:'2px' }}>{label}</label>
                  {COMBO_FIELDS.includes(key)
                    ? <ComboBox value={form[key]} onChange={val=>setForm({...form,[key]:val})} options={getOptions(key)} placeholder={`พิมพ์หรือเลือก ${label}`} />
                    : <input style={S.input} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})} />
                  }
                </div>
              ))}
              <label style={{ fontSize:'11px', color:'#888' }}>Updated By</label>
              <input style={S.inputDisabled} value={userName||currentUser?.email||''} disabled />
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div style={S.overlay}>
          <div style={{ background:'white', borderRadius:'10px', padding:'20px', width:'90vw', maxWidth:'1000px', maxHeight:'85vh', display:'flex', flexDirection:'column' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
              <h3 style={{ fontSize:'15px', margin:0 }}>📋 Preview ข้อมูลที่จะ Import</h3>
              <span style={{ fontSize:'12px', color:'#0F6E56', fontWeight:'500' }}>{previewData.length} รายการ</span>
            </div>
            <div style={{ fontSize:'12px', color:'#888', marginBottom:'12px', background:'#f8f9fa', padding:'8px 12px', borderRadius:'6px' }}>
              ⚠️ Code จะถูก Auto Running, Username และ Last Update จะถูก Auto ใส่ให้ครับ
            </div>
            <div style={{ overflow:'auto', flex:1, marginBottom:'16px', border:'0.5px solid #e8e8e8', borderRadius:'6px' }}>
              <table style={{ borderCollapse:'collapse', fontSize:'11px', width:'100%' }}>
                <thead>
                  <tr>{['itemcode2','bu','description','cpc','account','sub','dis_g','i_and_g','value','oth','spi1','spec_tx','keyword'].map(f=>(
                    <th key={f} style={{ background:'#1a3a5c', color:'white', padding:'8px 10px', textAlign:'left', whiteSpace:'nowrap', position:'sticky', top:0 }}>{f}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {previewData.slice(0,50).map((row,i) => (
                    <tr key={i}>
                      {['itemcode2','bu','description','cpc','account','sub','dis_g','i_and_g','value','oth','spi1','spec_tx','keyword'].map(f => (
                        <td key={f} style={{ padding:'7px 10px', fontSize:'11px', borderBottom:'0.5px solid #f0f0f0', whiteSpace:'nowrap', maxWidth:'150px', overflow:'hidden', textOverflow:'ellipsis' }}>
                          {String(row[f]??'')||'-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewData.length>50 && <div style={{ textAlign:'center', padding:'8px', fontSize:'12px', color:'#888' }}>แสดง 50 แถวแรก จากทั้งหมด {previewData.length} แถว</div>}
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px' }}>
              <button style={{...S.btn,background:'#f0f0f0'}} onClick={()=>{setShowPreview(false);setPreviewData([]);}}>Cancel</button>
              <button style={{...S.btn,background:'#1a3a5c',color:'white'}} onClick={handleConfirmImport} disabled={importing}>
                {importing?'กำลัง Import...':`✅ Confirm Import ${previewData.length} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ItemCodeList;
