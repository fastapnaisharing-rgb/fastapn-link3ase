import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';

function AccountList() {
  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ code: '', name: '', type: '', level: 'Child', status: 'Active' });

  const fetchData = async () => {
    const { data } = await supabase.from('account_list').select('*').order('code');
    setAccounts(data || []);
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (editId) {
      await supabase.from('account_list').update(form).eq('id', editId);
    } else {
      await supabase.from('account_list').insert([form]);
    }
    setShowForm(false);
    setEditId(null);
    setForm({ code: '', name: '', type: '', level: 'Child', status: 'Active' });
    fetchData();
  };

  const handleEdit = (a) => {
    setForm({ code: a.code, name: a.name, type: a.type, level: a.level, status: a.status });
    setEditId(a.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm('ต้องการลบรายการนี้?')) {
      await supabase.from('account_list').delete().eq('id', id);
      fetchData();
    }
  };

  const filtered = accounts.filter(a =>
    a.name?.toLowerCase().includes(search.toLowerCase()) ||
    a.code?.includes(search)
  );

  const S = {
    container: { padding: '20px' },
    topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
    btn: { padding: '7px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', marginLeft: '8px' },
    table: { width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: '8px', overflow: 'hidden' },
    th: { background: '#f0f0f0', padding: '10px', textAlign: 'left', fontSize: '12px', fontWeight: '600' },
    td: { padding: '9px 10px', fontSize: '12px', borderBottom: '1px solid #f0f0f0' },
    input: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', width: '100%', marginBottom: '8px' },
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
    modal: { background: 'white', borderRadius: '10px', padding: '24px', width: '420px' }
  };

  return (
    <div style={S.container}>
      <div style={S.topbar}>
        <h2 style={{ fontSize: '16px', fontWeight: '600' }}>💰 Account List</h2>
        <div>
          <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...S.input, width: '200px', marginBottom: 0 }} />
          <button style={{ ...S.btn, background: '#1a3a5c', color: 'white' }} onClick={() => { setShowForm(true); setEditId(null); setForm({ code: '', name: '', type: '', level: 'Child', status: 'Active' }); }}>+ New</button>
        </div>
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            {['Account Code', 'Account Name', 'Type', 'Level', 'Status', 'Action'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {filtered.map(a => (
            <tr key={a.id}>
              <td style={S.td}>{a.code}</td>
              <td style={S.td}>{a.name}</td>
              <td style={S.td}>{a.type}</td>
              <td style={S.td}>{a.level}</td>
              <td style={S.td}>
                <span style={{ background: a.status === 'Active' ? '#EAF3DE' : '#FCEBEB', color: a.status === 'Active' ? '#27500A' : '#791F1F', padding: '2px 8px', borderRadius: '20px', fontSize: '11px' }}>
                  {a.status}
                </span>
              </td>
              <td style={S.td}>
                <button style={{ ...S.btn, background: '#f0f0f0', marginLeft: 0 }} onClick={() => handleEdit(a)}>✏️</button>
                <button style={{ ...S.btn, background: '#FCEBEB', color: '#791F1F' }} onClick={() => handleDelete(a.id)}>🗑️</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showForm && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={{ marginBottom: '16px', fontSize: '15px' }}>{editId ? 'Edit Account' : 'New Account'}</h3>
            {[['code', 'Account Code'], ['name', 'Account Name'], ['type', 'Type']].map(([key, label]) => (
              <div key={key}>
                <label style={{ fontSize: '12px', color: '#666' }}>{label}</label>
                <input style={S.input} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: '12px', color: '#666' }}>Level</label>
              <select style={S.input} value={form.level} onChange={e => setForm({ ...form, level: e.target.value })}>
                <option>Child</option>
                <option>Parent</option>
              </select>
            </div>
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

export default AccountList;