# mycolegal-sharedlib — Changelog

## 0.3.0 — Tier-1 quick wins: org-apps + safe-transaction + auth-client (2026-05-27)

- `org-apps.ts`: `getEnabledAppSlugs` + `isAppEnabled` con cache 60s, byte-idéntico
  en 6 apps (actas, archivo, cancelaciones, legifirma, notaria, peticiones).
  Reusa `./config` (AUTH_INTERNAL_URL, JWT_COOKIE_NAME) y `next/headers`.
- `safe-transaction.ts`: `safeTransaction` (retry P2034/P2002, backoff exponencial,
  Serializable por defecto), byte-idéntico en legifirma + notaria. Usa el singleton
  `prisma` de `./db` (la misma instancia que las apps re-exportan como `@/lib/db`).
- `auth-client.ts`: `refreshToken` + `fetchUserProfile` (+ tipos `TokenRefreshResponse`
  /`AuthUserProfile`), byte-idéntico en legifirma + notaria. Único cambio respecto al
  original: import `@/lib/config` → `./config`.
- Añadidos a `files` y a los fingerprints de deploy (`SHAREDLIB_PUBLISHED_PATHS` en
  platform/scripts/common.sh + lista de `repo_src_paths` en admin.sh).
- Consumidores re-exportan desde `@/lib/{org-apps,safe-transaction,auth-client}`
  (sin tocar imports existentes). Bump de package.json/package-lock vía
  `publish-sharedlib.sh`.

## 0.2.0 — Tier-1: db + inter-auth (2026-05-25)

- `db.ts`: singleton de `PrismaClient` (`prisma`), byte-idéntico en las 10 apps.
  `withOrgScope` se queda en cada app (diverge: variante "smart" via `Prisma.dmmf`).
- `inter-auth.ts`: `verifyInterAuth` + `InterAuthOk`/`InterAuthErr` (núcleo canónico
  de INTEGRATIONS_CONTRACT §3, superset con `userId?` opcional). `resolveServiceCreatorId`
  se queda en cada app (diverge en filtro `active`).
- Añadidos a `files` y a los fingerprints de deploy (`SHAREDLIB_PUBLISHED_PATHS`,
  `repo_src_paths` en admin.sh).
- Consumidor de referencia: consultor re-exporta ambos (`@/lib/db`, `@/lib/inter-auth`).

## 0.1.1 — Tier-1: config + proxy (2026-05-25)

- `config.ts`: bloque auth/cookie (AUTH_INTERNAL_URL, JWT_SECRET, JWT_COOKIE_NAME,
  REFRESH_COOKIE_NAME, COOKIE_DOMAIN, COOKIE_MAX_AGE, REFRESH_COOKIE_MAX_AGE).
- `proxy.ts`: `proxyToAuth` / `fetchFromAuth`.
- (0.1.0 quedó ocupado en el registry por un scaffold vacío previo → se publicó 0.1.1.)

## 0.1.0 — Bootstrap (2026-05-08)

- Inicialización del paquete `@mycolegal-app/sharedlib`.
- `package.json` con `peerDependencies` opcionales (`@prisma/client`, `jose`, `next`, `zod`).
- `tsconfig.json` clonado de `mycolegal-ui`.
- Workflow `publish.yml` para GitHub Packages.
- `index.ts` vacío. Sin contenido funcional todavía.
- Plan de extracción documentado en `SHAREDLIB_PLAN.md`.
