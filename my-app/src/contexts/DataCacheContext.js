import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { db } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';

const DataCacheContext = createContext(null);

const STORAGE_KEY = 'fastapn_cache';
const STORAGE_TIME_KEY = 'fastapn_cache_time';

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

  // บันทึกลง sessionStorage ทุกครั้งที่ Cache เปลี่ยน
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
      const snap = await getDocs(collection(db, collectionName));
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setCache(prev => ({ ...prev, [collectionName]: data }));
      setLastFetch(prev => ({ ...prev, [collectionName]: Date.now() }));
      return data;
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