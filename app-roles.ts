// @mycolegal-app/sharedlib/app-roles
//
// Catálogo unificado de roles B2B (#78). Los roles "de familia notaría"
// (ADMINISTRADOR_NOTARIA / USUARIO_NOTARIA / OBSERVADOR_NOTARIA /
// CONTABLE_NOTARIA) se registran en el `instrumentation.node.ts` de cada app
// como entradas ADITIVAS que conviven con los roles propios de la app, con
// permisos = los del rol propio que absorben. Este bloque estaba copiado a
// mano en ~7 apps; aquí se centraliza para evitar el drift (ver incidencia
// CGN-test / [[project_roles_enum_catalog_drift]]).
//
// OJO: estos roles deben existir TAMBIÉN en el enum de rol de la BD
// (`AppRole` / `ConsultorRole`) o el auto-provisioning (`provisionUserRole`)
// falla al materializar la fila local. Mantener en sync con el schema
// canónico de mycolegal-platform.

export interface AppRoleEntry {
  key: string;
  label: string;
  description: string;
  isDefault: boolean;
  /**
   * Rol que recibe por auto-provisión un usuario `org_admin` de la org (en vez
   * del `isDefault`, pensado para usuarios normales). Sin esto, un org_admin
   * entraba en cada app como usuario raso y le faltaban permisos de admin
   * (p.ej. `peticiones:manage_externos`). Solo ADMINISTRADOR_NOTARIA lo lleva.
   */
  isAdminDefault?: boolean;
  permissions: string[];
}

export interface UnifiedB2BRolesOptions {
  /** Clave del rol propio del que ADMINISTRADOR_NOTARIA hereda permisos. Def: 'EDITOR'. */
  adminFrom?: string;
  /** Clave del rol propio del que USUARIO_NOTARIA hereda permisos. Def: 'OPERADOR'. */
  usuarioFrom?: string;
  /** Clave del rol propio del que OBSERVADOR_NOTARIA hereda permisos. Def: 'VISOR'. */
  observadorFrom?: string;
  /** Añadir OBSERVADOR_NOTARIA (solo-consulta). Def: true. */
  includeObservador?: boolean;
  /** Añadir CONTABLE_NOTARIA (acceso completo + datos económicos, ['*']). Def: false. */
  includeContable?: boolean;
}

/**
 * Empuja los roles unificados B2B sobre el array `appRoles` de la app (in
 * place) y lo devuelve. Los permisos de admin/usuario/observador se derivan
 * de los roles propios indicados en las opciones, replicando exactamente el
 * patrón que cada app tenía inline.
 */
export function addUnifiedB2BRoles(
  appRoles: AppRoleEntry[],
  options: UnifiedB2BRolesOptions = {},
): AppRoleEntry[] {
  const {
    adminFrom = 'EDITOR',
    usuarioFrom = 'OPERADOR',
    observadorFrom = 'VISOR',
    includeObservador = true,
    includeContable = false,
  } = options;

  const permsOf = (key: string): string[] =>
    appRoles.find((r) => r.key === key)?.permissions ?? [];

  appRoles.push(
    {
      key: 'ADMINISTRADOR_NOTARIA',
      label: 'Administrador de notaría',
      description: 'Acceso completo y administra usuarios y configuración',
      isDefault: false,
      isAdminDefault: true,
      permissions: permsOf(adminFrom),
    },
    {
      key: 'USUARIO_NOTARIA',
      label: 'Usuario de notaría',
      description: 'Trabaja en la aplicación',
      isDefault: false,
      permissions: permsOf(usuarioFrom),
    },
  );

  if (includeObservador) {
    appRoles.push({
      key: 'OBSERVADOR_NOTARIA',
      label: 'Observador',
      description: 'Solo consulta',
      isDefault: false,
      permissions: permsOf(observadorFrom),
    });
  }

  if (includeContable) {
    appRoles.push({
      key: 'CONTABLE_NOTARIA',
      label: 'Contable',
      description: 'Empleado de notaría con acceso completo, incluidos datos económicos',
      isDefault: false,
      permissions: ['*'],
    });
  }

  return appRoles;
}

// ---------------------------------------------------------------------------
// Traducción catálogo unificado → rol local (la otra mitad de #78)
//
// `addUnifiedB2BRoles` (arriba) publica los roles unificados HACIA auth. Esto
// es el camino de vuelta: auth entrega el `appRoleKey` con la nomenclatura
// unificada y cada app lo consume con su enum/unión propia (legacy). Sin
// traducir en el boundary de `getAuthContext`, el rol efectivo cae fuera del
// tipo local y todo lo que compara por rol falla en silencio: máquinas de
// estado sin transiciones, `ROLE_PERMISSIONS[rol]` → undefined, botones que no
// se renderizan. Fue la causa de la incidencia #412 (LegiFirma: nadie podía
// avanzar una actuación en producción).
//
// Regla: traducir UNA sola vez, en `getAuthContext`. De ahí para abajo, el
// código de la app solo ve roles locales y nunca claves unificadas.
// ---------------------------------------------------------------------------

/** Claves de rol del catálogo unificado B2B (#78), familia NOTARIA. */
export const UNIFIED_ROLE_KEYS = [
  'ADMINISTRADOR_NOTARIA',
  'USUARIO_NOTARIA',
  'OBSERVADOR_NOTARIA',
  'CONTABLE_NOTARIA',
] as const;

/**
 * Unificado → enum notarial legacy (notaria, legifirma: NOTARIO/OFICIAL/…).
 * Espejo exacto de los `permsOf(...)` de `addUnifiedB2BRoles`.
 */
export const UNIFIED_TO_NOTARIA_ROLE: Record<string, string> = {
  ADMINISTRADOR_NOTARIA: 'NOTARIO',
  USUARIO_NOTARIA: 'OFICIAL',
  OBSERVADOR_NOTARIA: 'AUXILIAR',
  CONTABLE_NOTARIA: 'CONTABILIDAD',
};

/**
 * Unificado → unión EDITOR/OPERADOR/VISOR (archivo, polizas, tramitacion,
 * peticiones, facturae, tributos). Coincide con los `adminFrom`/`usuarioFrom`/
 * `observadorFrom` por defecto de `addUnifiedB2BRoles`. CONTABLE_NOTARIA se
 * registra con `['*']`, así que absorbe el rol local más amplio: EDITOR.
 */
export const UNIFIED_TO_EDITOR_ROLE: Record<string, string> = {
  ADMINISTRADOR_NOTARIA: 'EDITOR',
  USUARIO_NOTARIA: 'OPERADOR',
  OBSERVADOR_NOTARIA: 'VISOR',
  CONTABLE_NOTARIA: 'EDITOR',
};

export interface ToLocalAppRoleOptions<T extends string> {
  /** Roles válidos del enum/unión local. Si la clave ya es uno, se respeta. */
  valid: readonly T[];
  /** Mapa unificado → local. Normalmente uno de los dos presets de arriba. */
  map?: Record<string, string>;
  /** Valor devuelto si la clave no se reconoce. Nunca fuera del tipo. */
  fallback: T;
}

/**
 * Coacciona un `appRoleKey` centralizado a un rol local válido:
 *   1. si ya es un rol local, se respeta tal cual;
 *   2. si es una clave del catálogo unificado, se traduce con `map`;
 *   3. si no se reconoce (o falta), se usa `fallback`.
 *
 * Garantiza que el `appRole` que circula por la app SIEMPRE pertenece al tipo
 * local, que es justo lo que el `as AppRole` crudo no garantizaba.
 */
export function toLocalAppRole<T extends string>(
  appRoleKey: string | null | undefined,
  options: ToLocalAppRoleOptions<T>,
): T {
  const { valid, map = {}, fallback } = options;
  if (!appRoleKey) return fallback;
  if ((valid as readonly string[]).includes(appRoleKey)) return appRoleKey as T;
  const mapped = map[appRoleKey];
  if (mapped && (valid as readonly string[]).includes(mapped)) return mapped as T;
  return fallback;
}
