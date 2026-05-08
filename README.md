# @mycolegal-app/sharedlib

Paquete privado npm con código **no-gráfico** compartido entre las apps de usuario final de MycoLegal. Hermano de [`@mycolegal-app/ui`](https://github.com/mycolegal-app/mycolegal-ui), que sigue siendo el hogar de todo lo visual.

## Qué va aquí

- Helpers de autenticación (verificación JWT, sesión, tipos).
- Utilidades de API (response builders, paginación, validación de permisos pura).
- Wrappers de proxy hacia `mycolegal-auth`.
- Llamadas inter-app (`callInterApi`, `verifyInterAuth`).
- Helpers de Prisma sin acoplar al schema (factory de singleton, `safeTransaction`).
- Bootstrap de instrumentación, i18n loader, GCS/Excel/email helpers.
- Factories de configuración (`createAdminDeps`, `createIncidentsServerDeps`, opcional `createNextConfig`).
- Tipos compartidos (`AuthContext`, `ApiResponse`, `PaginationMeta`, …).

## Qué NO va aquí

- Componentes React ni JSX → `@mycolegal-app/ui`.
- Hooks visuales (toast, dialogs) → `@mycolegal-app/ui`.
- Tailwind preset, design tokens, CSS → `@mycolegal-app/ui`.
- Plantillas Dockerfile, `docker-compose`, scripts shell → in-app o `mycolegal-platform`.
- Schema Prisma o tipos generados (`@prisma/client`) en firmas públicas.
- Lógica de dominio (state machines, counters, reglas de negocio) — sigue in-app.

## Convenciones

- TypeScript fuente, sin bundler. Las apps consumen via `transpilePackages: ["@mycolegal-app/sharedlib"]` en `next.config`.
- Publicación a GitHub Packages privado (`https://npm.pkg.github.com`). Mismo `NPM_TOKEN` que `@mycolegal-app/ui`.
- Versionado semver. Empezamos en `0.1.0` y avanzamos por minor en cada extracción Tier 1/Tier 2; pasamos a `1.0.0` cuando todas las apps consuman y el contrato esté estable.
- **Bump atómico**: cualquier cambio que añada/modifique un símbolo público se acompaña en el mismo PR del bump de `package.json` + `package-lock.json` en cada app consumidora afectada. Cloud Build falla aunque local pase.
- Subpath por dominio funcional, nunca por archivo. Ej.: `@mycolegal-app/sharedlib/auth`, `@mycolegal-app/sharedlib/api`, `@mycolegal-app/sharedlib/proxy`.

## Instalación (apps consumidoras)

```bash
npm install @mycolegal-app/sharedlib
```

Asegúrate de que `.npmrc` apunta al registry privado (mismo patrón que `@mycolegal-app/ui`):

```
@mycolegal-app:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

Y de añadir el paquete a `transpilePackages` en `next.config.{ts,js,mjs}`:

```ts
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@mycolegal-app/ui', '@mycolegal-app/sharedlib'],
  // ...
};
```

## Plan de extracción

Ver [SHAREDLIB_PLAN.md](./SHAREDLIB_PLAN.md) para el catálogo de módulos a extraer y el plan operativo por fases.
