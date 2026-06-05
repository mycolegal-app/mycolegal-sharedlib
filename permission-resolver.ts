// @mycolegal-app/sharedlib/permission-resolver — resolución resiliente de los
// permisos centralizados que las apps de usuario final piden al servicio auth
// en CADA request (`GET {AUTH_INTERNAL_URL}/auth/me/permissions/<appSlug>`).
//
// Problema que resuelve (incidencia #113):
//   Cada deploy reinicia el servicio auth. Durante esa ventana el fetch falla y
//   el `getAuthContext` de cada app degradaba `permissions` a `[]`, cayendo al
//   fallback por rol local. Eso DENIEGA (403) a los usuarios cuyo acceso viene
//   de un grant POR-USUARIO (no del rol) — p.ej. un TRAMITADOR con
//   `protocolos:read` —, dejando la pantalla en blanco hasta que auth se
//   estabiliza. El fallback por rol local no puede reproducir grants por-usuario.
//
// Política:
//   - auth responde (2xx, incluso con set vacío) → resultado en vivo + se cachea
//     el último set "bueno" (con algo que conceder) por (usuario, org, app).
//   - auth responde 4xx (sin asignación) → set vacío en vivo (definitivo); NO
//     pisa la cache buena previa.
//   - auth inalcanzable (5xx / red / timeout) → se reusa el último set bueno
//     reciente (TTL) en vez de vaciar. Si no hay cache → null (fallback por rol,
//     comportamiento histórico).
//
// Módulo puro (sólo `fetch` global de Node/Next). La cache es por proceso de la
// app (cada app es su propio proceso); module-level Map basta y es correcto.

export interface CentralizedPermissions {
  appRoleKey: string | null;
  permissions: string[];
}

export interface ResolvePermissionsOpts {
  /** Base interna del servicio auth (p.ej. `AUTH_INTERNAL_URL`). */
  authInternalUrl: string;
  /** Slug de la app (`notaria`, `legifirma`, …) — segmento del endpoint. */
  appSlug: string;
  /** JWT del usuario (valor de la cookie de sesión). */
  token: string;
  /** Id del usuario en auth (para la clave de cache). */
  userId: string;
  /** Org activa (para la clave de cache). */
  orgId: string;
  /** Inyectable en tests; por defecto `Date.now()`. */
  now?: number;
}

/** 15 min: suficiente para cubrir la ventana de un deploy sin servir permisos
 *  obsoletos demasiado tiempo (sólo se sirven mientras auth está caído). */
export const PERM_CACHE_TTL_MS = 15 * 60 * 1000;

const cache = new Map<string, CentralizedPermissions & { ts: number }>();

type Fetched =
  | ({ reachable: true } & CentralizedPermissions)
  | { reachable: false };

async function fetchOnce(
  authInternalUrl: string,
  appSlug: string,
  token: string,
): Promise<Fetched> {
  try {
    const res = await fetch(`${authInternalUrl}/auth/me/permissions/${appSlug}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 5xx = auth caído/reiniciándose → transitorio. 4xx = respuesta definitiva
    // (sin asignación) → alcanzable con set vacío.
    if (res.status >= 500) return { reachable: false };
    if (!res.ok) return { reachable: true, appRoleKey: null, permissions: [] };
    const data = await res.json();
    return {
      reachable: true,
      appRoleKey: data?.data?.appRoleKey || null,
      permissions: data?.data?.permissions || [],
    };
  } catch {
    return { reachable: false }; // red / timeout
  }
}

/**
 * Devuelve los permisos centralizados del usuario en la app, resistente a
 * caídas transitorias de auth. `null` ⇒ ni en vivo ni en cache (el caller debe
 * caer a su fallback por rol local, como antes).
 */
export async function resolveCentralizedPermissions(
  opts: ResolvePermissionsOpts,
): Promise<CentralizedPermissions | null> {
  const { authInternalUrl, appSlug, token, userId, orgId } = opts;
  const now = opts.now ?? Date.now();
  const cacheKey = `${userId}:${orgId}:${appSlug}`;

  const fetched = await fetchOnce(authInternalUrl, appSlug, token);

  if (fetched.reachable) {
    const value: CentralizedPermissions = {
      appRoleKey: fetched.appRoleKey,
      permissions: fetched.permissions,
    };
    // Sólo cacheamos sets con contenido: un set vacío no debe pisar uno bueno.
    if (value.permissions.length > 0 || value.appRoleKey) {
      cache.set(cacheKey, { ...value, ts: now });
    }
    return value;
  }

  const cached = cache.get(cacheKey);
  if (cached && now - cached.ts < PERM_CACHE_TTL_MS) {
    return { appRoleKey: cached.appRoleKey, permissions: cached.permissions };
  }
  if (cached) cache.delete(cacheKey);
  return null;
}
