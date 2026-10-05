// src/lib/db.js
const API_URL = process.env.REACT_APP_API_URL;

const apiFetch = async (path, options = {}) => {
  const token = sessionStorage.getItem('fastapn_token');

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  // MARKER_DB_GLOBAL_401_HANDLER_V1 -- แจ้ง AuthContext ให้ Force Logout ทันทีเมื่อ Token หลุด/หมดอายุ
  // -- ไม่ Import useAuth ตรงนี้เพราะ db.js ไม่ใช่ React Component -- ใช้ Window Event แทน
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('fastapn:unauthorized'));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return { data: null, error: data?.error || 'Request failed', count: null };
  return { data, error: null, count: Array.isArray(data) ? data.length : null };
};

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this._filters = {};
    this._order = null;
    this._limit = null;
    this._single = false;
    this._maybeSingle = false;
    this._select = '*';
    this._method = 'GET';
    this._body = null;
    this._upsert = false;
    this._onConflict = null;
    this._range = null;
    this._count = null;
    this._head = false;
  }

  select(cols = '*', opts = {}) {
    this._select = cols;
    if (opts.count) this._count = opts.count;
    if (opts.head) this._head = opts.head;
    return this;
  }

  eq(col, val) { this._filters[`eq_${col}`] = val; return this; }
  neq(col, val) { this._filters[`neq_${col}`] = val; return this; }
  in(col, vals) { this._filters[`in_${col}`] = vals.join(','); return this; }
  gte(col, val) { this._filters[`gte_${col}`] = val; return this; }
  lte(col, val) { this._filters[`lte_${col}`] = val; return this; }
  gt(col, val) { this._filters[`gt_${col}`] = val; return this; }
  lt(col, val) { this._filters[`lt_${col}`] = val; return this; }
  ilike(col, val) { this._filters[`ilike_${col}`] = val.replace(/%/g, ''); return this; }

  // MARKER_DB_RAW_FILTER_V1 -- ทางออกสำหรับ Query Param ที่ไม่มี Prefix (search, search_cols,
  // distinct_group ฯลฯ ที่ genericTable.js อ่านตรงๆ จาก req.query ไม่ผ่าน eq_/ilike_ ฯลฯ)
  raw(key, val) { this._filters[key] = val; return this; }

  // MARKER_DB_SEARCH_METHOD_V1 -- Wire เข้ากับ search/search_cols ที่ Backend รองรับอยู่แล้ว
  // แต่ก่อนหน้านี้ไม่มี Method ให้เรียกจาก Frontend เลย
  search(term, cols, opts = {}) {
    this.raw('search', term);
    this.raw('search_cols', Array.isArray(cols) ? cols.join(',') : cols);
    if (opts.mode) this.raw('search_mode', opts.mode);
    return this;
  }

  // MARKER_DB_DISTINCT_GROUP_METHOD_V1 -- Wire เข้ากับ distinct_group ที่ Backend รองรับอยู่แล้ว
  // (ต้องระบุ 2 Column เสมอ — ถ้าต้องการนับแค่ 1 Column ให้ส่งชื่อเดิมซ้ำ 2 ครั้ง)
  distinctGroup(colA, colB) { this.raw('distinct_group', `${colA},${colB}`); return this; }

  order(col, opts = {}) {
    const dir = opts.ascending === false ? 'desc' : 'asc';
    this._order = this._order ? `${this._order},${col}.${dir}` : `${col}.${dir}`;
    return this;
  }

  limit(n) { this._limit = n; return this; }

  range(from, to) {
    this._range = { from, to };
    this._limit = to - from + 1;
    return this;
  }

  single() { this._single = true; return this; }
  maybeSingle() { this._maybeSingle = true; return this; }

  insert(data) {
    this._method = 'POST';
    this._body = Array.isArray(data) ? data[0] : data;
    this._bulkData = Array.isArray(data) && data.length > 1 ? data : null;
    return this;
  }

  update(data) { this._method = 'PUT'; this._body = data; return this; }

  upsert(data, opts = {}) {
    this._method = 'POST';
    this._upsert = true;
    this._body = Array.isArray(data) ? data : [data];
    this._onConflict = opts.onConflict || null;
    return this;
  }

  delete() { this._method = 'DELETE'; return this; }

  then(resolve, reject) { return this._execute().then(resolve, reject); }
  // MARKER_DB_THENABLE_CATCH_FINALLY_V1 -- ให้ Builder ใช้ .catch()/.finally() ได้เหมือน Promise/Supabase (เดิมมีแค่ then ทำให้ .update().eq().catch() พังด้วย "catch is not a function")
  catch(reject) { return this._execute().catch(reject); }
  finally(fn) { return this._execute().finally(fn); }

  async _execute() {
    try {
      if (this._method === 'DELETE') {
        const id = this._filters['eq_id'];
        const inIds = this._filters['in_id'];
        if (id) return await apiFetch(`/${this.table}/${id}`, { method: 'DELETE' });
        if (inIds) {
          const ids = inIds.split(',');
          const results = await Promise.all(ids.map(i => apiFetch(`/${this.table}/${i}`, { method: 'DELETE' })));
          return { data: null, error: results.find(r => r.error)?.error || null };
        }
        return { data: null, error: 'No id specified for delete' };
      }

      if (this._upsert) {
        const query = this._onConflict ? `?onConflict=${this._onConflict}` : '';
        return await apiFetch(`/${this.table}/upsert${query}`, { method: 'POST', body: JSON.stringify(this._body) });
      }

      if (this._method === 'POST') {
        if (this._bulkData) {
          const results = await Promise.all(this._bulkData.map(d => apiFetch(`/${this.table}`, { method: 'POST', body: JSON.stringify(d) })));
          return { data: results.map(r => r.data).filter(Boolean), error: results.find(r => r.error)?.error || null };
        }
        const result = await apiFetch(`/${this.table}`, { method: 'POST', body: JSON.stringify(this._body) });
        if (result.data && !Array.isArray(result.data) && !this._single && !this._maybeSingle) {
          result.data = [result.data];
        }
        return result;
      }

      if (this._method === 'PUT') {
        const id = this._filters['eq_id'];
        const inIds = this._filters['in_id'];
        if (id) return await apiFetch(`/${this.table}/${id}`, { method: 'PUT', body: JSON.stringify(this._body) });
        if (inIds) {
          const ids = inIds.split(',');
          const results = await Promise.all(ids.map(i => apiFetch(`/${this.table}/${i}`, { method: 'PUT', body: JSON.stringify(this._body) })));
          return { data: results.map(r => r.data), error: results.find(r => r.error)?.error || null };
        }
        return { data: null, error: 'No id specified for update' };
      }

      const params = new URLSearchParams();
      Object.entries(this._filters).forEach(([k, v]) => params.set(k, v));
      if (this._order) params.set('order', this._order);
      // MARKER_DB_SELECT_PARAM_V1 -- Bug Fix: this._select ถูกเก็บไว้จาก .select(cols) แต่ไม่เคยถูกส่งไป
      // Backend เลย (ขาดบรรทัดนี้มาตลอด) ทำให้ทุก .select('col1,col2') ทั่วทั้ง Frontend เป็น No-op จริงๆ
      // Backend ได้ SELECT * เสมอไม่ว่าจะระบุ Column ไว้กี่ตัว -- ถ้าตารางมี Column ใหญ่ (เช่น JSONB เก็บ
      // ข้อมูลทั้งชุด) จะโดนลากมาด้วยทุกครั้งแม้หน้า List จะใช้แค่ไม่กี่ Column ก็ตาม เป็นสาเหตุหลักที่ทำให้
      // การดึงรายการ (เช่น Document/Resource Center) ช้า
      if (this._select && this._select !== '*') params.set('select', this._select);

      // MARKER_DB_COUNT_EXACT_HEAD_V1 -- โหมดขอแค่จำนวนรวม (count:'exact', head:true) ก่อนหน้านี้
      // ไม่เคยยิง count=true ไป Backend จริง (แค่นับความยาวข้อมูลที่ดึงมา ซึ่งอาจถูก limit ตัดไปแล้ว
      // ทำให้ Total ผิด) ตอนนี้ให้ Database นับให้ตรงๆ เร็วกว่าและถูกต้องกว่า
      if (this._count === 'exact' && this._head) {
        params.set('count', 'true');
        const query = params.toString() ? `?${params.toString()}` : '';
        const result = await apiFetch(`/${this.table}${query}`);
        if (result.error) return { data: null, error: result.error, count: null };
        const total = result.data && typeof result.data.total === 'number' ? result.data.total : 0;
        return { data: null, error: null, count: total };
      }

      if (this._limit) params.set('limit', this._limit);
      // MARKER_DB_RANGE_OFFSET_V1 -- .range(from,to) เดิมตั้งแค่ this._limit แต่ไม่เคยส่ง offset
      // ไปที่ Backend เลย ทำให้ทุกหน้าที่เรียกผ่าน .range() ได้ข้อมูลจากตำแหน่ง 0 เสมอ (Bug เดียวกับ select)
      if (this._range) params.set('offset', this._range.from);

      const query = params.toString() ? `?${params.toString()}` : '';
      const result = await apiFetch(`/${this.table}${query}`);
      if (result.error) return result;

      let data = result.data;

      if (this._single || this._maybeSingle) {
        return { data: Array.isArray(data) ? data[0] || null : data, error: null, count: null };
      }

      return { data, error: null, count: Array.isArray(data) ? data.length : null };
    } catch (err) {
      return { data: null, error: err.message, count: null };
    }
  }
}

export const db = {
  from: (table) => new QueryBuilder(table),
};