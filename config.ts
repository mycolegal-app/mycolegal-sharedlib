// @mycolegal-app/sharedlib/config — constantes de auth/cookie compartidas por
// las 10 apps (bloque byte-idéntico extraído de cada `src/lib/config.ts`).
//
// Solo el bloque auth/cookie. Lo app-específico (APP_URL y su default, SECURE_COOKIES
// derivado de APP_URL, y constantes propias como Vertex/GCS) sigue en cada app.

/** Internal auth URL for server-to-server communication */
export const AUTH_INTERNAL_URL =
  process.env.AUTH_SERVICE_URL || 'https://auth.mycolegal.app';

/** Shared secret for HS256 JWT verification (must match auth service) */
export const JWT_SECRET = process.env.JWT_SECRET || '';

/**
 * Optional cookie-name prefix for environment isolation. Empty in prod (no-op),
 * `test-` in the preprod fleet (`*.test.mycolegal.app`) so a prod cookie that
 * domain-matches a `*.test` host can't collide with the test cookie of the same
 * name. Read at RUNTIME (like JWT_SECRET) so the same image works in prod and
 * test (build-once-promote).
 */
export const COOKIE_PREFIX = process.env.COOKIE_PREFIX || '';

/** Shared cookie name for SSO across all mycolegal apps */
export const JWT_COOKIE_NAME = `${COOKIE_PREFIX}mycolegal-token`;

/** Refresh token cookie name */
export const REFRESH_COOKIE_NAME = `${COOKIE_PREFIX}mycolegal-refresh`;

/** Cookie domain for cross-app SSO (localhost for Docker, .mycolegal.app for prod) */
export const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

export const COOKIE_MAX_AGE = 8 * 60 * 60; // 8 hours

export const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days, matches auth backend
