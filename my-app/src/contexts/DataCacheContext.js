import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '../supabase';

const DataCacheContext = createContext(null);

const STORAGE_KEY = 'fastapn_cache';
const STORAGE_TIME_KEY = 'fastapn_cache_time';

// Map ชื่อ Collection (Firebase) → ชื่อ Table (Supabase)
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
  // ถ้าเรียกด้วยชื่อ Table โดยตรงก็ใช้ได้เลย
  account_list:    'account_list',
  branch_list:     'branch_list',
  company_list:    'company_list',
  itemcode_list:   'itemcode_list',
  supplier_list:   'supplier_list',
  vendor_category: 'vendor_category',
  notice_list:     'notice_list',
  sub_acc_list:    'sub_acc_list',
  cpc_list:        'cpc_list',
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

  const CACHE_TTL = 15 * 60 * 1000; // 15 นาที

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
      
      // ดึงข้อมูลทั้งหมด (รองรับ > 1000 rows ด้วย range)
      let allData = [];
      let from = 0;
      const pageSize = 1000;

      while (true) {
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        allData = [...allData, ...data];
        if (data.length < pageSize) break;
        from += pageSize;
      }

      setCache(prev => ({ ...prev, [collectionName]: allData }));
      setLastFetch(prev => ({ ...prev, [collectionName]: Date.now() }));
      return allData;
    } catch (err) {
      console.error(`Cache fetch error [${collectionName}]:`, err);
      return cache[collectionName] || [];
    } finally {
      setLoading(prev => ({ ...prev, [collectionName]: false }));
    }
  }, [cache, loading, isStale]);

  const invalidate = useCallback((collectionName) => {
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