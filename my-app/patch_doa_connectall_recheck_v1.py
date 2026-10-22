import sys,shutil
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_CONNECT_ALL_RECHECK_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_connectall_recheck_v1')
a=s.index("  const connectAll = async (accs) => {")
b=s.index("    } catch (e) { setBkAcc(m => { const n = { ...m }; codes.forEach(c => { if ((n[c] || {}).conn === 'busy') n[c] = { conn: 'off', sel: '' }; }); return n; }); setDbMsg('Connect ไม่สำเร็จ: ' + e.message); }\n  };", a)
blk=s[a:b]
i0=blk.index("      let it = bkFiles;")
head=blk[:i0]
new = r"""      /* MARKER_GL_DOA_CONNECT_ALL_RECHECK_V1 -- Connect ทั้งหมด = Recheck ใหม่ทุกครั้ง: โหลดรายการ Backup + เปิดไฟล์ดูว่า Account ไหนมีข้อมูล + อ่าน Include จาก DB แล้วค่อย Connect เฉพาะ Account ที่มีข้อมูลจริง */
      const jr = await listDoaBackups(bu); const it = (jr.items || []).filter(x => (x.kind || 'TB') === 'Detail' && x.period !== period).sort((x, y) => String(y.period).localeCompare(String(x.period))); setBkFiles(it); bkLoaded.current = bu;
      const fl = it.filter(x => x.period < period).slice(0, 12);
      const ds = await Promise.all(fl.map(f => getDoaBackup(f.id).then(d => ({ f, d })).catch(() => null)));
      const mpN = {}; ds.forEach(r => { if (!r) return; detailRows(Array.isArray(r.d && r.d.data) ? r.d.data : []).forEach(o => { const c = String(o.account_code); if (!mpN[c]) mpN[c] = { id: r.f.id, period: r.f.period, name: r.f.file_name || '' }; }); });
      setBkHaveMap(mpN); setBkHave(new Set(Object.keys(mpN)));
      let incSet = new Set(); try { const cl = await listDoaClear(bu); applyClr(cl); (cl || []).filter(x => x.status === 'Include').forEach(x => incSet.add(String(x.row_key).split('|').pop())); } catch (e0) { incSet = new Set([...incByAcc.keys()]); }
      const hasD = (c) => !!mpN[String(c)] || incSet.has(String(c)) || belowByAcc.has(String(c));
      if (!codes.some(hasD)) { setBkAcc(m => { const n = { ...m }; codes.forEach(c => { if ((n[c] || {}).conn === 'busy') n[c] = { conn: 'empty', sel: '' }; }); return n; }); setDropAcc(''); setDropPop(true); setDbMsg('Recheck: ไม่พบข้อมูล Backup / Include ของ Account ใดเลย — โยนไฟล์ Backup (Detail งวดก่อน) เพื่อสร้าง'); return; }
      const defF = (c) => (mpN[String(c)] && it.find(x => String(x.id) === String(mpN[String(c)].id))) || null;
      setBkAcc(m => { const n = { ...m }; codes.forEach(c => { if ((n[c] || {}).conn !== 'on') { const d1 = defF(c); n[c] = hasD(c) ? { conn: 'on', sel: d1 ? String(d1.id) : '' } : { conn: 'empty', sel: '' }; } }); return n; });
      { const grp = {}; codes.filter(c => mpN[String(c)]).forEach(c => { const d0 = defF(c); const k = d0 ? String(d0.id) : ''; (grp[k] = grp[k] || { d0, cs: [] }).cs.push(c); }); for (const k of Object.keys(grp)) await carryM1(grp[k].d0, grp[k].cs); }
      let nb = 0; try { nb = await stampBelow(codes.filter(c => belowByAcc.has(String(c)) && !mpN[String(c)])); } catch (e) { /* ไม่กระทบ */ }
      { const okC = codes.filter(hasD); const noC = codes.filter(c => !hasD(c)); setDbMsg(`✓ Recheck BU ${bu}: Connect ${okC.length} Account (เจอใน Backup ${okC.filter(c => mpN[String(c)]).length} · Include ใน DB ${okC.filter(c => !mpN[String(c)] && incSet.has(String(c))).length}${nb ? ` · ตั้ง Include ${nb} แถว` : ''})${noC.length ? ` · ไม่พบข้อมูล ${noC.length} Account: ${noC.slice(0, 8).join(', ')}${noC.length > 8 ? '…' : ''}` : ''}`); }
"""
s=s[:a]+head+new+s[b:]
open(p,'w',encoding='utf-8').write(s); print('ok')
