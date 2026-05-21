interface CacheEntry {
  value: unknown;
  expires: number;
}

const store = new Map<string, CacheEntry>();

export function set(key: string, value: unknown, ttlSeconds = 300): void {
  store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

export function get<T = unknown>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function del(key: string): void {
  store.delete(key);
}

export function clear(): void {
  store.clear();
}

export function size(): number {
  return store.size;
}

export function keys(): string[] {
  return Array.from(store.keys());
}

export function stats(): { size: number; keys: string[] } {
  return { size: store.size, keys: keys() };
}
