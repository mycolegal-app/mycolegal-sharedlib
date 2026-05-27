// @mycolegal-app/sharedlib/org-apps — verificación de apps habilitadas para la
// organización autenticada (bloque byte-idéntico extraído de las apps que
// muestran/ocultan secciones según las apps contratadas por la org).
//
// Llama a `${AUTH_INTERNAL_URL}/apps/user-apps` reusando el JWT del
// usuario actual. La respuesta indica qué apps están contratadas por
// la org. Cache en memoria 60s para no martillar auth en cada request.

import { cookies } from 'next/headers';
import { AUTH_INTERNAL_URL, JWT_COOKIE_NAME } from './config';

interface UserAppsResponse {
  data?: {
    apps?: Array<{ slug: string; active?: boolean }>;
  };
}

interface CacheEntry {
  apps: Set<string>;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, CacheEntry>();

async function fetchEnabledApps(token: string): Promise<Set<string>> {
  const res = await fetch(`${AUTH_INTERNAL_URL}/apps/user-apps`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return new Set();
  const json = (await res.json()) as UserAppsResponse;
  const slugs = (json.data?.apps ?? [])
    .filter((a) => a.active !== false)
    .map((a) => a.slug);
  return new Set(slugs);
}

export async function getEnabledAppSlugs(): Promise<Set<string>> {
  const cookieStore = await cookies();
  const token = cookieStore.get(JWT_COOKIE_NAME)?.value;
  if (!token) return new Set();
  const cached = cache.get(token);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.apps;
  const apps = await fetchEnabledApps(token);
  cache.set(token, { apps, expiresAt: now + CACHE_TTL_MS });
  return apps;
}

export async function isAppEnabled(slug: string): Promise<boolean> {
  const apps = await getEnabledAppSlugs();
  return apps.has(slug);
}
