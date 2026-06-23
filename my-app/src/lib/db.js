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
      if (this._limit) params.set('limit', this._limit);

      const query = params.toString() ? `?${params.toString()}` : '';
      const result = await apiFetch(`/${this.table}${query}`);
      if (result.error) return result;

      let data = result.data;

      if (this._single || this._maybeSingle) {
        return { data: Array.isArray(data) ? data[0] || null : data, error: null, count: null };
      }

      if (this._count === 'exact' && this._head) {
        return { data: null, error: null, count: Array.isArray(data) ? data.length : 0 };
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