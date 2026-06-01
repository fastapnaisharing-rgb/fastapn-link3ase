import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';

function BranchList() {
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ code: '', name: '', taxId: '', branchNo: '', bu: '', group: '', status: 'Active' });

  const fetchData = async () => {
    const snap = await getDocs(collection(db, 'branches'));
    setBranches(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (editId) {
      await updateDoc(doc(db, 'branches', editId), form);
    } else {
      await addDoc(collection(db, 'branches'), form);
    }
    setShowForm(false);
    setEditId(null);
    setForm({ code: '', name: '', taxId: '', branchNo: '', bu: '', group: '', status: 'Active' });
    fetchData();
  };

  const handleEdit = (b) => {
    setForm({ code: b.code, name: b.name, taxId: b.taxId, branchNo: b.branchNo, bu: b.bu, group: b.group, status: b.status });
    setEditId(b.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm('ต้องการลบรายการนี้?')) {
      await deleteDoc(doc(db, 'branches', id));
      fetchData();
    }
  };

  const filtered = branches.filter(b =>
    b.name?.toLowerCase().includes(search.toLowerCase()) ||
    b.code?.toLowerCase().includes(search.toLowerCase())
  );

  const S = { container: { padding: '20px' }, topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }, btn: { padding: '7px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', marginLeft: '8px' }, table: { width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: '8px', overflow: 'hidden' }, th: { background: '#f0f0f0', padding: '10px', textAlign: 'left', fontSize: '12px', fontWeight: '600' }, td: { padding: '9px 10px', fontSize: '12px', borderBottom: '1px solid #f0f0f0' }, input: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', width: '100%', marginBottom: '8px' }, overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }, modal: { background: 'white', borderRadius: '10px', padding: '24px', width: '420px' } };

  return (
    <div style={S.container}>
      <div style={S.topbar}>
        <h2 style={{ fontSize: '16px', fontWeight: '600' }}>🏪 Branch List</h2>
        <div>
          <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...S.input, width: '200px', marginBottom: 0 }} />
          <button style={{ ...S.btn, background: '#1a3a5c', color: 'white' }} onClick={() => { setShowForm(true); setEditId(null); setForm({ code: '', name: '', taxId: '', branchNo: '', bu: '', group: '', status: 'Active' }); }}>+ New</button>
        </div>
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            {['Branch Code', 'Name', 'Tax ID', 'Branch No.', 'BU', 'Group', 'Status', 'Action'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {filtered.map(b => (
            <tr key={b.id}>
              <td style={S.td}>{b.code}</td>
              <td style={S.td}>{b.name}</td>
              <td style={S.td}>{b.taxId}</td>
              <td style={S.td}>{b.branchNo}</td>
              <td style={S.td}>{b.bu}</td>
              <td style={S.td}>{b.group}</td>
              <td style={S.td}><span style={{ background: b.status === 'Active' ? '#EAF3DE' : '#FCEBEB', color: b.status === 'Active' ? '#27500A' : '#791F1F', padding: '2px 8px', borderRadius: '20px', fontSize: '11px' }}>{b.status}</span></td>
              <td style={S.td}>
                <button style={{ ...S.btn, background: '#f0f0f0', marginLeft: 0 }} onClick={() => handleEdit(b)}>✏️</button>
                <button style={{ ...S.btn, background: '#FCEBEB', color: '#791F1F' }} onClick={() => handleDelete(b.id)}>🗑️</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showForm && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={{ marginBottom: '16px', fontSize: '15px' }}>{editId ? 'Edit Branch' : 'New Branch'}</h3>
            {[['code', 'Branch Code'], ['name', 'Business Name'], ['taxId', 'BU Tax ID'], ['branchNo', 'BU No.'], ['bu', 'BU'], ['group', 'GROUP']].map(([key, label]) => (
              <div key={key}>
                <label style={{ fontSize: '12px', color: '#666' }}>{label}</label>
                <input style={S.input} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: '12px', color: '#666' }}>Status</label>
              <select style={S.input} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option>Active</option>
                <option>Inactive</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button style={{ ...S.btn, background: '#f0f0f0' }} onClick={() => setShowForm(false)}>Cancel</button>
              <button style={{ ...S.btn, background: '#1a3a5c', color: 'white' }} onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BranchList;