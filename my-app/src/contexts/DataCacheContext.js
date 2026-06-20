import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../api';

const DataCacheContext = createContext(null);

const STORAGE_KEY = 'fastapn_cache';
const STORAGE_TIME_KEY = 'fastapn_cache_time';

const TABLE_MAP = {
  AccountList:    'account_list',
  BranchList:     'branch_list',
  CompanyList:    'company_list',
  ItemcodeList:   'itemcode_list',
  SupplierList:   'supplier_list',
  VendorCategory: 'vendor_category',
  NoticeList:     'notice_list',
  SubAccList:     'sub_acc_list',
  CpcList:        'cpc_list',
  User:           'users',
  account_list:    'account_list',
  branch_list:     'branch_list',
  company_list:    'company_list',
  itemcode_list:   'itemcode_list',
  supplier_list:   'supplier_list',
  vendor_category: 'vendor_category',
  VendorRule:       'Vendor_rule',
  notice_list:     'notice_list',
  sub_acc_list:    'sub_acc_list',
  cpc_list:        'cpc_list',
};

const DEDUP_IGNORE_FIELDS = ['id', 'created_at', 'updated_at', 'updated_by'];

const dedupRows = (collectionName, rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') { result.push(row); continue; }
    const keys = Object.keys(row).filter(k => !DEDUP_IGNORE_FIELDS.includes(k)).sort();
    const signature = JSON.stringify(keys.map(k => row[k]));
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(row);
  }
  if (result.length !== rows.length) {
    console.warn(`[DataCache] Removed ${rows.length - result.length} duplicate row(s) from ${collectionName}`);
  }
  return result;
};

const loadFromStorage = () => {
  try {
    const cached = sessionStorage.getItem(STORAGE_KEY);
    const times = sessionStorage.getItem(STORAGE_TIME_KEY);
    return {
      cache: cached ? JSON.parse(cached) : {},
      lastFetch: times ? JSON.parse(times) : {},
    };
  } catch { return { cache: {}, lastFetch: {} }; }
};

const saveToStorage = (cache, lastFetch) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    sessionStorage.setItem(STORAGE_TIME_KEY, JSON.stringify(lastFetch));
  } catch { }
};

export function DataCacheProvider({ children }) {
  const initial = loadFromStorage();
  const [cache, setCache] = useState(initial.cache);
  const [loading, setLoading] = useState({});
  const [lastFetch, setLastFetch] = useState(initial.lastFetch);

  const CACHE_TTL = 15 * 60 * 1000;

  useEffect(() => {
    saveToStorage(cache, lastFetch);
  }, [cache, lastFetch]);

  const isStale = useCallback((collectionName) => {
    const last = lastFetch[collectionName];
    if (!last) return true;
    return Date.now() - last > CACHE_TTL;
  }, [lastFetch]);

  const fetchCollection = useCallback(async (collectionName, forceRefresh = false) => {
    if (!forceRefresh && cache[collectionName] && !isStale(collectionName)) {
      return cache[collectionName];
    }
    if (loading[collectionName]) return cache[collectionName] || [];

    setLoading(prev => ({ ...prev, [collectionName]: true }));
    try {
      const tableName = TABLE_MAP[collectionName] || collectionName;
      // backend ของเราคืนทั้งตารางในครั้งเดียว ไม่ต้อง paginate แบบที่ Supabase บังคับ
      const allData = await apiFetch(`/${tableName}`);
      const dedupedData = dedupRows(collectionName, allData);
      setCache(prev => ({ ...prev, [collectionName]: dedupedData }));
      setLastFetch(prev => ({ ...prev, [collectionName]: Date.now() }));
      return dedupedData;
    } catch (err) {
      console.error(`Cache fetch error [${collectionName}]:`, err);
      return cache[collectionName] || [];
    } finally {
      setLoading(prev => ({ ...prev, [collectionName]: false }));
    }
  }, [cache, loading, isStale]);

  const invalidate = useCallback((collectionName) => {
    setCache(prev => {
      const next = { ...prev };
      delete next[collectionName];
      return next;
    });
    setLastFetch(prev => ({ ...prev, [collectionName]: null }));
  }, []);

  const refresh = useCallback(async (collectionName) => {
    return await fetchCollection(collectionName, true);
  }, [fetchCollection]);

  const appendToCache = useCallback((collectionName, newItem) => {
    setCache(prev => ({
      ...prev,
      [collectionName]: prev[collectionName] ? [...prev[collectionName], newItem] : [newItem]
    }));
  }, []);

  const updateInCache = useCallback((collectionName, id, updatedData) => {
    setCache(prev => ({
      ...prev,
      [collectionName]: (prev[collectionName] || []).map(item =>
        item.id === id ? { ...item, ...updatedData } : item
      )
    }));
  }, []);

  const removeFromCache = useCallback((collectionName, id) => {
    setCache(prev => ({
      ...prev,
      [collectionName]: (prev[collectionName] || []).filter(item => item.id !== id)
    }));
  }, []);

  const getCached = useCallback((collectionName) => {
    return cache[collectionName] || [];
  }, [cache]);

  const isLoading = useCallback((collectionName) => {
    return loading[collectionName] || false;
  }, [loading]);

  return (
    <DataCacheContext.Provider value={{
      fetchCollection,
      invalidate,
      refresh,
      getCached,
      isLoading,
      cache,
      appendToCache,
      updateInCache,
      removeFromCache,
    }}>
      {children}
    </DataCacheContext.Provider>
  );
}

export function useDataCache() {
  const ctx = useContext(DataCacheContext);
  if (!ctx) {
    return {
      fetchCollection: async () => [],
      invalidate: () => {},
      refresh: async () => [],
      getCached: () => [],
      isLoading: () => false,
      cache: {},
      appendToCache: () => {},
      updateInCache: () => {},
      removeFromCache: () => {},
    };
  }
  return ctx;
}
