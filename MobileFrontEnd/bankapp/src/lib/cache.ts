import AsyncStorage from "@react-native-async-storage/async-storage";

type CacheEnvelope<T> = {
  savedAt: number;
  value: T;
};

export function buildUserCacheKey(userId: string | null, scope: string): string {
  return `bankapp-cache:${userId ?? "anon"}:${scope}`;
}

export async function loadCache<T>(key: string, maxAgeMs: number): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > maxAgeMs) return null;
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

export async function saveCache<T>(key: string, value: T): Promise<void> {
  const envelope: CacheEnvelope<T> = { savedAt: Date.now(), value };
  try {
    await AsyncStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Best-effort cache; ignore persistence errors.
  }
}

