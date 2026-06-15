# mycolegal-sharedlib — Changelog

## 0.6.0 — app-roles: catálogo unificado B2B (#78) centralizado (2026-06-15)

- `app-roles.ts`: `addUnifiedB2BRoles(appRoles, options)` centraliza el bloque
  `APP_ROLES.push(ADMINISTRADOR_NOTARIA / USUARIO_NOTARIA / OBSERVADOR_NOTARIA /
  CONTABLE_NOTARIA)` que estaba copiado a mano en ~7 instrumentations. Opciones
  `adminFrom`/`usuarioFrom`/`observadorFrom`/`includeObservador`/`includeContable`
  reproducen exactamente cada variante. Adoptado en archivo, cancelaciones, actas,
  peticiones, moratorias y consultor. (notaria define los roles inline con otra
  estructura → no migrada; docfilling no cablea sharedlib → diferida.)

## 0.5.0 — Tier-2: api (helpers de respuesta + paginación, reconciliados) (2026-05-27)

- `api.ts`: helpers puros para route handlers — `successResponse`, `errorResponse`,
  `parseSearchParams`, `getPaginationParams`, `buildPaginationMeta` + tipos
  `PaginationMeta`/`ApiResponse`/`ApiError`/`ParsedSearchParams`. Reconciliados desde
  el `api-utils.ts` de las 10 apps: las diferencias eran tipado/formato salvo el clamp
  de paginación, donde este canónico es la versión robusta (guards de NaN + clamp de
  mín/máx) — estricta mejora, sin cambio para tráfico legítimo. `sortBy` se unifica a
  `string` (default `'createdAt'`); las 3 apps con la variante nullable no lo usaban.
- **NO se mueven** los wrappers `withAuth`/`withPermission` (+ variantes:
  withWritePermission/withCatalogPermission/withGestorAuth) ni `hasPerm`: atan
  `getAuthContext` y la capa de permisos (ROLE_PERMISSIONS / hasPermission /
  hasPermissionFromList / hasPermissionForRole), app-specific. Se quedan en cada
  `api-utils.ts`, que ahora re-exporta los helpers compartidos e importa `errorResponse`.
- legifirma mantiene `PaginationMeta`/`ApiResponse`/`ApiError` en `@/types`
  (estructuralmente idénticos → compatibles por tipado estructural).
- Añadido a `files` y a los fingerprints de deploy (common.sh + admin.sh).

## 0.4.0 — Tier-2: data-scope (2026-05-27)

- `data-scope.ts`: filtrado por usuario para queries Prisma (`isBypassUser`,
  `dataScopeWhere`, `mergeDataScopeWhere` + tipos `DataScopeAuth`/`DataScopeOptions`).
  Módulo PURO (sin imports de Prisma/Next). Core byte-idéntico en 8 apps; se publica
  como **superset**: incorpora la opción `mine?` de cross-visibility (solo lectura)
  que tenía notaria, y tipa `appRole` como `string` (no `AppRole`) para no acoplar
  sharedlib a ningún schema. Backward-compatible: `mine` por defecto es el
  comportamiento histórico (solo creados/asignados).
- Consumidores (10) re-exportan desde `@/lib/data-scope`. **archivo** conserva su
  `mergePeticionScopeWhere` local (ArchivoPeticion no tiene `asignadoId` propio: el
  asignado vive en ArchivoTarea). **notaria** abandona su fork.
- Tests: `data-scope.test.ts` (cancelaciones/legifirma/moratorias idénticos + notaria
  superset) se quedan en cada app y testean a través del re-export. Vitest v4
  transpila el TS crudo de sharedlib desde node_modules sin `deps.inline`.
- Añadido a `files` y a los fingerprints de deploy (common.sh + admin.sh).

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
