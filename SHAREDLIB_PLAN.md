# Plan operativo `mycolegal-sharedlib`

Paquete privado npm hermano de `@mycolegal-app/ui` para extraer código no-gráfico repetido entre las 10 apps de usuario final (actas, archivo, cancelaciones, consultor, facturae, legifirma, moratorias, notaria, peticiones, tributos).

**Decisiones cerradas**:
- Paquete único `@mycolegal-app/sharedlib` (no se separa `@mycolegal-app/configs`).
- Versión inicial `0.1.0`, ramp-up gradual hasta `1.0.0` cuando todas las apps lo consuman.
- Todas las apps consumen via `transpilePackages: ["@mycolegal-app/sharedlib"]` en `next.config`.
- Patrón de empaquetado idéntico a `mycolegal-ui`: TypeScript fuente sin bundler, GitHub Packages privado.

---

## 1. Resumen ejecutivo

- 10 apps inspeccionadas + `mycolegal-ui` como patrón.
- ~900–1.000 líneas duplicadas identificadas como candidatas claras (Tier 1+2).
- 18 categorías de duplicación detectadas; 7 son copias byte-a-byte.
- Tiempo estimado total: 5–7 días dev efectivos repartidos en sprints.
- Riesgo bajo: código mayormente puro, sin lógica de negocio.

---

## 2. Catálogo consolidado de duplicación

### Tier 1 — Copia exacta, extracción inmediata (riesgo nulo)

| Módulo | Apps | Estado | Notas |
|---|---|---|---|
| `proxy.ts` (`proxyToAuth`, `fetchFromAuth`) | 9–12 | byte-a-byte | Manejo de 401, cookie clear, content-type smart |
| `db.ts` (singleton Prisma) | 10/10 | byte-a-byte | `withOrgScope` de notaria queda fuera (es app-specific) |
| `config.ts` (constantes JWT/cookie/auth URL) | 10/10 | idéntico salvo comentarios | Solo el bloque auth/cookie; el resto sigue in-app |
| `org-apps.ts` (`getEnabledAppSlugs`, cache 60s) | 5–6 | byte-a-byte | Reutilizable por las que aún no lo tienen |
| `aranceles-client.ts` | 2 (legifirma, notaria) | byte-a-byte | Lógica crítica de negocio |
| `safe-transaction.ts` | 2 | byte-a-byte | Retry P2034/P2002, también la necesita tributos |
| `i18n/load-messages.ts` | 10/10 | byte-a-byte | Loaders dinámicos + fallback a CAST |

### Tier 2 — Extracción con factory / inyección (alto valor, requiere parametrizar)

| Módulo | Apps | Qué se extrae | Qué queda in-app |
|---|---|---|---|
| `auth.ts` | 10/10 | `verifyToken`, `getSession`, tipos `JWTClaims`/`AuthContext` | `getAuthContext` wrapper, mapeo a `AppRole`, defaults de auto-provision |
| `api-utils.ts` | 9–10/10 | `successResponse`, `errorResponse`, paginación, `hasPerm`, tipos `ApiResponse`/`ApiError` | `withAuth`/`withPermission` (inyectan `ROLE_PERMISSIONS` local) |
| `inter-auth.ts` | 7–8/10 | `verifyInterAuth(request)` puro | `resolveServiceCreatorId(orgId, prisma)` con prisma inyectable |
| `inter-call.ts` | 1 (archivo) | `callInterApi<T>` | — (es genérico, lo migrarán las demás cuando lo usen) |
| `excel.ts` | 4 | `xlsxResponse`, `csvResponse` | — |
| `email.ts` | 2–3 | `sendForEvent`, `sendAdhoc` | `APP_SLUG` y plantillas |
| `gcs.ts` | 1 (cancelaciones) | `getSignedUrl`, `buildGcsPath`, `deleteObject` | bucket name (env) |
| `docfilling-service.ts` | 2 (actas, legifirma) | cliente con `appSlug` inyectable | — |
| `activity.ts` / `audit.ts` | 5 | `logActivity(args, tx?)`, tipo `LogActivityArgs` | enums `*_ACCIONES` por app |
| `admin-deps.ts` | 9–10 | factory `createAdminDeps({ appSlug, validRoles, orgAdminRole })` | el call site con su config |
| `incidents-server.ts` | 3 | factory que inyecta `jwtCookieName`+`authInternalUrl` | — |
| `instrumentation.ts` | 10/10 | helper `bootstrapInstrumentation()` | hooks específicos (cancelaciones tiene `registerInboxEndpoint`) |

### Tier 3 — Mantener in-app (datos específicos, no código)

- `permissions.ts` — el mapa `ROLE_PERMISSIONS` es app-specific por diseño.
- `branding.ts` — copy y features por app.
- `scopes-manifest.ts` — `appKey` + `SCOPABLE_RESOURCES` per-app (factory en sharedlib si queremos, pero aporta poco).
- `format.ts`/`utils.ts` — labels y colores de estado por dominio.
- State machines, counters, validadores de dominio.
- Layouts y pages (la divergencia es solo `metadata`).

---

## 3. Estructura propuesta del paquete

Clon directo del patrón `mycolegal-ui`: TypeScript fuente, sin bundler, GitHub Packages privado, barrel `index.ts` + subpaths.

```
mycolegal-sharedlib/
├── package.json              # name: @mycolegal-app/sharedlib
├── tsconfig.json             # idéntico al de ui (target ES2020, strict)
├── VERSION.md                # versionado X.Y.Z igual que ui
├── README.md
├── index.ts                  # barrel: tipos + utils puros
├── src/
│   ├── auth/
│   │   ├── verify-token.ts
│   │   ├── session.ts
│   │   └── types.ts          # JWTClaims, AuthContext
│   ├── api/
│   │   ├── responses.ts      # successResponse, errorResponse
│   │   ├── pagination.ts     # parseSearchParams, getPaginationParams, buildPaginationMeta
│   │   ├── permissions.ts    # hasPerm (puro)
│   │   └── types.ts          # ApiResponse, ApiError, PaginationMeta
│   ├── config/
│   │   └── auth-config.ts    # JWT_COOKIE_NAME, AUTH_INTERNAL_URL, etc.
│   ├── db/
│   │   └── prisma.ts         # singleton genérico (acepta PrismaClient via factory)
│   ├── proxy/
│   │   ├── proxy-to-auth.ts
│   │   └── fetch-from-auth.ts
│   ├── inter/
│   │   ├── verify-inter-auth.ts
│   │   ├── call-inter-api.ts
│   │   └── docfilling-client.ts
│   ├── tx/
│   │   └── safe-transaction.ts
│   ├── activity/
│   │   ├── log-activity.ts
│   │   └── types.ts
│   ├── storage/
│   │   ├── gcs.ts
│   │   └── excel.ts
│   ├── email/
│   │   └── send.ts
│   ├── domain/
│   │   └── aranceles-client.ts
│   ├── org-apps/
│   │   └── enabled-apps-cache.ts
│   ├── admin/
│   │   └── create-admin-deps.ts
│   ├── instrumentation/
│   │   └── bootstrap.ts
│   ├── i18n/
│   │   └── load-messages.ts
│   └── next/
│       └── create-next-config.ts   # opcional, evaluar tras Fases 1–2
└── e2e/                      # vacío al inicio; reservado por simetría con ui
```

**Subpaths canónicos** (igual que ui):
- `@mycolegal-app/sharedlib` — barrel con tipos + utils puros (zero side effects)
- `@mycolegal-app/sharedlib/auth`
- `@mycolegal-app/sharedlib/api`
- `@mycolegal-app/sharedlib/proxy`
- `@mycolegal-app/sharedlib/db`
- `@mycolegal-app/sharedlib/inter`
- `@mycolegal-app/sharedlib/tx`
- `@mycolegal-app/sharedlib/activity`
- `@mycolegal-app/sharedlib/storage`
- `@mycolegal-app/sharedlib/email`
- `@mycolegal-app/sharedlib/domain`
- `@mycolegal-app/sharedlib/org-apps`
- `@mycolegal-app/sharedlib/admin`
- `@mycolegal-app/sharedlib/instrumentation`
- `@mycolegal-app/sharedlib/i18n`
- `@mycolegal-app/sharedlib/config`
- `@mycolegal-app/sharedlib/next`

**`package.json` clave**:
```json
{
  "name": "@mycolegal-app/sharedlib",
  "version": "0.1.0",
  "type": "module",
  "main": "./index.ts",
  "publishConfig": { "registry": "https://npm.pkg.github.com" },
  "files": ["src", "index.ts", "tsconfig.json", "VERSION.md"],
  "peerDependencies": {
    "next": ">=14",
    "@prisma/client": ">=5",
    "jose": ">=5",
    "zod": ">=3"
  },
  "peerDependenciesMeta": {
    "next": { "optional": true },
    "@prisma/client": { "optional": true }
  }
}
```

`@prisma/client` y `jose` van como peer porque cada app tiene su versión y schema. El sharedlib **nunca** debe instanciar `PrismaClient`; expone factories que reciben el cliente.

Cada app consumidora añade `"@mycolegal-app/sharedlib"` a `transpilePackages` (igual que ui).

---

## 4. Plan de migración por fases

Orden pensado para que cada fase sea independiente, mergeable, y testeable con `docker compose build`. Recordatorio: cada bump del paquete y sus consumidores van **en el mismo commit** (regla atómica conocida).

### Fase 0 — Bootstrap del paquete

**Objetivo**: tener un paquete publicable en GitHub Packages con `0.1.0` vacío + scripts CI funcionando, sin tocar todavía ninguna app consumidora.

**Pre-requisitos**: ninguno. Trabajo aislado en este repo.

**Checklist**:
- [ ] Copiar y adaptar de `mycolegal-ui`:
  - [ ] `package.json` → name `@mycolegal-app/sharedlib`, version `0.1.0`, peerDeps `next>=14`, `@prisma/client>=5`, `jose>=5`, `zod>=3` (todos `optional`); `dependencies` vacío al inicio.
  - [ ] `tsconfig.json` (idéntico al de ui).
  - [ ] `.gitignore`, `.npmrc.example` (auth via `${NPM_TOKEN}`).
  - [ ] `README.md` con contrato del paquete (qué va y qué NO).
  - [ ] `VERSION.md` con `## 0.1.0 — Bootstrap (YYYY-MM-DD)`.
  - [ ] `index.ts` barrel vacío (solo `export {};`).
- [ ] Workflow `.github/workflows/publish.yml` (clon del de ui).
- [ ] Push inicial + tag `v0.1.0` y verificación de publish a `npm.pkg.github.com`.
- [ ] Documentar en CLAUDE.md de `mycolegal-platform` la existencia del paquete y la regla atómica de bump.

**Verificación**: `npm view @mycolegal-app/sharedlib --registry=https://npm.pkg.github.com` devuelve `0.1.0`. Ningún PR en apps consumidoras.

**Riesgo principal**: olvidar marcar peerDeps como `optional` y bloquear instalaciones donde Prisma no aplica.

---

### Fase 1 — Tier 1: extracción byte-a-byte

**Objetivo**: mover los 7 módulos idénticos sin refactor. Cada módulo es un commit independiente que bumpea sharedlib + bumpea consumidores en el mismo PR.

**Pre-requisitos**: Fase 0 completa. Acceso a `docker compose` para smoke test.

#### Módulo 1.1 — `db.ts` → `@mycolegal-app/sharedlib/db`
- [ ] Crear `src/db/prisma.ts` con la implementación genérica:
  ```ts
  export function createPrismaSingleton<T>(factory: () => T): T
  ```
  (no instancia `PrismaClient` directamente para evitar acoplar al schema).
- [ ] Exponer subpath y documentar import via `@mycolegal-app/sharedlib/db`.
- [ ] Bump `0.1.0 → 0.2.0`.
- [ ] En cada app reemplazar `src/lib/db.ts`:
  ```ts
  import { PrismaClient } from "@prisma/client";
  import { createPrismaSingleton } from "@mycolegal-app/sharedlib/db";
  export const prisma = createPrismaSingleton(() => new PrismaClient());
  ```
- [ ] Apps: actas, archivo, cancelaciones, consultor, facturae, legifirma, moratorias, notaria, peticiones, tributos.
- [ ] **Notaria mantiene** `withOrgScope` local (no se mueve).
- [ ] Bumpear `package.json` + `package-lock.json` en las 10 apps.
- [ ] Smoke: `docker compose build` para cada app cambiada.
- [ ] Smoke runtime: levantar 1 app y verificar query simple.

#### Módulo 1.2 — `proxy.ts` → `@mycolegal-app/sharedlib/proxy`
- [ ] Mover `proxyToAuth` y `fetchFromAuth` tal cual.
- [ ] Bump `0.2.0 → 0.3.0`.
- [ ] Reemplazar imports en 9 apps que tienen `proxy.ts` (notaria pendiente confirmar, parece tenerlo en otra forma).
- [ ] Smoke: hacer login en una app y verificar que el cookie/refresh sigue funcionando.

#### Módulo 1.3 — `i18n/load-messages.ts` → `@mycolegal-app/sharedlib/i18n`
- [ ] Mover `loadMessages` con sus dynamic imports.
- [ ] Bump `0.3.0 → 0.4.0`.
- [ ] Reemplazar en 10/10 apps.
- [ ] Smoke: cambiar idioma en una app y verificar que CAT/EUS/GAL cargan.
- [ ] **Importante**: no mover `getUiDefaults` ni los catálogos de mensajes — siguen en `mycolegal-ui`.

#### Módulo 1.4 — `safe-transaction.ts` → `@mycolegal-app/sharedlib/tx`
- [ ] Mover `safeTransaction` tal cual.
- [ ] Bump `0.4.0 → 0.5.0`.
- [ ] Apps: legifirma, notaria.
- [ ] Mejora bonus: tributos `m600-counter` (que hoy NO usa retry) → adoptar `safeTransaction`. Marcar como mejora aparte si añade riesgo.
- [ ] Smoke: simular conflicto de unique en local (insertar dos counters mismo número).

#### Módulo 1.5 — `aranceles-client.ts` → `@mycolegal-app/sharedlib/domain/aranceles-client`
- [ ] Mover tal cual.
- [ ] Bump `0.5.0 → 0.6.0`.
- [ ] Apps: legifirma, notaria.
- [ ] Smoke: e2e que ya valida cálculo arancel (si existe).

#### Módulo 1.6 — `org-apps.ts` → `@mycolegal-app/sharedlib/org-apps`
- [ ] Mover `getEnabledAppSlugs` + `isAppEnabled` con cache 60s.
- [ ] Bump `0.6.0 → 0.7.0`.
- [ ] Apps actuales: actas, archivo, peticiones, legifirma, consultor (5–6).
- [ ] Smoke: revocar una app en admin y verificar que el cache se invalida después de 60s.

#### Módulo 1.7 — Constantes `config.ts` (auth/cookie) → `@mycolegal-app/sharedlib/config`
- [ ] Mover SOLO: `JWT_COOKIE_NAME`, `JWT_SECRET`, `AUTH_INTERNAL_URL`, `SECURE_COOKIES`, `COOKIE_DOMAIN`, `COOKIE_MAX_AGE`, `REFRESH_COOKIE_MAX_AGE`.
- [ ] Bump `0.7.0 → 0.8.0`.
- [ ] En cada app, `src/lib/config.ts` re-exporta las constantes shared y mantiene las app-specific (`APP_SLUG`, `GCS_BUCKET`, etc.).
- [ ] Smoke: login en cada app → verificar cookie name y dominio.

**Hito Fase 1**: tag `v0.10.0`. Las 10 apps ya consumen sharedlib.

---

### Fase 2 — Tier 2: extracción con factories

**Objetivo**: mover módulos que requieren parametrizar (`appSlug`, `prisma`, etc.). Aquí ya no es copy-paste; cada cambio implica refactor.

**Pre-requisitos**: Fase 1 completa y estable. Tener al menos 1 día de "soak time" en producción tras Fase 1.

#### Módulo 2.1 — `api-utils` → `@mycolegal-app/sharedlib/api`
- [ ] Crear submódulos: `responses.ts`, `pagination.ts`, `permissions.ts` (solo `hasPerm` puro), `types.ts`.
- [ ] **NO mover** `withAuth` y `withPermission`: dependen de `ROLE_PERMISSIONS` local. Quedan in-app pero **usan** los helpers shared.
- [ ] Apps que aún no tengan `api-utils.ts` completo (facturae) reciben mejora bonus.
- [ ] Bump minor.
- [ ] Smoke: cualquier endpoint paginado.

#### Módulo 2.2 — `auth` → `@mycolegal-app/sharedlib/auth`
- [ ] Mover: `verifyToken(token, secret)`, `getSession()` (lectura cookie → JWT), tipos `JWTClaims`, `AuthContext` base.
- [ ] **NO mover**: `getAuthContext` (orquesta con `fetchCentralizedPermissions(appSlug)`), enums `AppRole`, default-role-map de auto-provision. Quedan in-app.
- [ ] Bump minor.
- [ ] Smoke: login + permission-gated endpoint en cada app.

#### Módulo 2.3 — `inter-auth` y `inter-call` → `@mycolegal-app/sharedlib/inter`
- [ ] Mover `verifyInterAuth(request)` puro.
- [ ] Mover `resolveServiceCreatorId(orgId, prisma)` con prisma inyectable.
- [ ] Mover `callInterApi<T>(opts)` (hoy solo en archivo) — beneficio futuro grande.
- [ ] Bump minor.
- [ ] Apps con `inter-auth`: actas, archivo, cancelaciones, consultor, legifirma, notaria, peticiones, tributos (más docfilling si aplica).
- [ ] Smoke: probar un flujo inter-app (actas → docfilling, p.ej.).

#### Módulo 2.4 — `excel`, `email`, `gcs` → submódulos `storage/`, `email/`
- [ ] `xlsxResponse` + `csvResponse` puros (4 apps los usan).
- [ ] `sendForEvent`/`sendAdhoc` con `appSlug` inyectable (2–3 apps).
- [ ] `getSignedUrl`/`buildGcsPath`/`deleteObject` con bucket inyectable (1 app).
- [ ] Bump minor.

#### Módulo 2.5 — `docfilling-service` → `@mycolegal-app/sharedlib/inter/docfilling-client`
- [ ] Refactor: `appSlug` y `serviceUrl` inyectables.
- [ ] Apps: actas, legifirma.
- [ ] Bump minor.

#### Módulo 2.6 — `activity` → `@mycolegal-app/sharedlib/activity`
- [ ] Mover función `logActivity(args, tx?)` y tipo `LogActivityArgs`.
- [ ] **NO mover** enums `ARCHIVO_ACCIONES`, `CANCEL_ACCIONES`, etc.
- [ ] Apps: archivo, cancelaciones, consultor, legifirma, notaria.
- [ ] Bump minor.

#### Módulo 2.7 — `instrumentation/bootstrap` → `@mycolegal-app/sharedlib/instrumentation`
- [ ] Helper `bootstrapInstrumentation({ extraHooks?: () => void })`.
- [ ] Apps: las 10 que tienen `instrumentation.ts`.
- [ ] Cancelaciones pasa su `registerInboxEndpoint` como hook.
- [ ] Bump minor.

**Hito Fase 2**: tag `v0.20.0`.

---

### Fase 3 — Factories de plataforma

**Objetivo**: completar boilerplate de admin, incidents y opcionalmente next.config.

#### Módulo 3.1 — `createAdminDeps` factory
- [ ] Firma: `createAdminDeps({ appSlug, validRoles, orgAdminRole, deps })`.
- [ ] 9–10 apps simplifican su `lib/admin-deps.ts`.

#### Módulo 3.2 — `createIncidentsServerDeps` factory
- [ ] Inyectar `jwtCookieName` + `authInternalUrl`.
- [ ] Apps: archivo, legifirma, notaria.

#### Módulo 3.3 — `createNextConfig({ extraHeaders, extraTranspile })` (opcional)
- [ ] Encapsula: `output: 'standalone'`, `transpilePackages: ["@mycolegal-app/ui","@mycolegal-app/sharedlib", ...extraTranspile]`, `webpack.symlinks=true`, env injection de `NEXT_PUBLIC_PLATFORM_VERSION` y `NEXT_PUBLIC_UI_VERSION`.
- [ ] **Decisión a tomar al llegar aquí**: si las divergencias entre apps (CSP de legifirma, etc.) hacen que la factory necesite demasiados escapes, descartar y dejar `next.config` in-app.

**Hito Fase 3**: tag `v0.30.0`.

---

### Fase 4 — Limpieza y guards

- [ ] Eliminar `lib/*.ts` que ya solo re-exportan (después de 1 sprint estable).
- [ ] Añadir guard de CI análoga al de `next/link`:
  - Lint rule: en `apps/*/src/lib/{db,proxy,config,inter-auth,inter-call,safe-transaction,aranceles-client,org-apps}.ts` **prohibido** tener implementación; solo re-export desde `@mycolegal-app/sharedlib/*`. Excepción documentada.
- [ ] Documento `mycolegal-sharedlib/CONTRACT.md`:
  - Qué va: helpers puros, factories, tipos compartidos, sin JSX, sin estilos.
  - Qué NO va: componentes React, hooks visuales, plantillas Dockerfile (siguen in-app).
- [ ] Tag `v1.0.0`. A partir de aquí semver estricto.

---

## 5. Reglas operativas durante todas las fases

1. **Bump atómico siempre**: cada cambio en sharedlib que añada o modifique un símbolo público se acompaña en el mismo PR de bump de `package.json` + `package-lock.json` en cada app consumidora afectada. Cloud Build falla aunque local pase.
2. **Test obligatorio**: `docker compose build` por cada app modificada antes de mergear. Nunca `next build`/`next dev` local.
3. **`@shared:*` e2e**: si una app tocada tiene Playwright `@shared:*`, correr `playwright test` con la dedup activa.
4. **Sin breaking changes silenciosos** entre `0.x` y `1.x`: aunque semver permite breaking en `0.x`, anunciar en `VERSION.md`.
5. **Schema Prisma fuera de sharedlib**: jamás importar tipos generados (`@prisma/client`) en firmas públicas; usar genéricos o interfaces propias.
6. **Notaria first**: la app más compleja (multi-tenancy con `withOrgScope`) es buen canario en cada fase — si pasa allí, pasa en el resto.

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| **Bump no atómico** rompe Cloud Build | Cada PR de extracción incluye en el mismo commit: cambio en sharedlib, bump de package.json + package-lock en TODAS las apps que lo importan |
| `PrismaClient` instanciado dos veces (sharedlib + app) | Sharedlib **NO** instancia; expone `createPrismaSingleton()` o recibe el cliente como parámetro |
| Divergencias React 18/19 entre apps | Sharedlib evita JSX por completo; UI ya está en `mycolegal-ui` |
| Importar tipos Prisma genera acoplamiento al schema | Definir tipos genéricos `<TUser>` o evitar tipos Prisma en firmas públicas; usar interfaces propias |
| Migración silenciosa rompe permisos centralizados | Probar cada app con e2e (`@shared:*`) tras Fase 2; verificar cookie/JWT roundtrip |
| Crece el catálogo de subpaths sin control | Documentar reglas: **un subpath por dominio funcional**, nunca por archivo |
| `mycolegal-auth` también tiene `lib/` con código similar | Fuera de scope de este plan; podría consumir sharedlib en una fase posterior |

---

## 7. Resumen de impacto esperado

| Métrica | Hoy | Tras Fase 4 |
|---|---|---|
| Líneas duplicadas en `lib/` | ~900–1.000 | ~50–100 (re-exports y data app-specific) |
| Módulos byte-a-byte idénticos | 7 | 0 |
| Apps que pueden adoptar `safeTransaction` y `callInterApi` | 2 / 1 | 10 / 10 |
| Tiempo estimado total | — | 5–7 días dev efectivos repartidos en sprints |
