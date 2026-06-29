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
