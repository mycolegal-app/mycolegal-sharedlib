// @mycolegal-app/sharedlib/data-scope — filtrado por usuario (data scope) para
// queries Prisma. Núcleo compartido por las apps de usuario final (superset:
// incluye la opción `mine?` de cross-visibility extraída de notaria).
//
// Política:
//   - `superadmin` (cross-org)              → bypass total.
//   - `org_admin`  (admin de su org)        → bypass dentro de su org.
//   - `appRole === 'NOTARIO'`               → bypass dentro de su org.
//   - resto                                  → ve solo los registros donde
//                                              `creadoPorId = userRoleId`
//                                              OR `asignadoId = userRoleId`,
//                                              SALVO que el caller pase
//                                              `mine: false` (visibilidad de
//                                              toda la org — ver abajo).
//
// Cross-visibility (solo lectura): los listados exponen un checkbox
// "Ver mis…" marcado por defecto. Al desmarcarlo, el endpoint pasa
// `mine: false` y el usuario ve toda la org. Los GET de detalle/sub-recursos
// pasan `mine: false` siempre (cualquier empleado puede consultar y seguir
// registros de otros). Las mutaciones NO pasan `mine` → siguen restringidas
// a creador/asignado (+ bypass).
//
// Catálogos compartidos (LegalAct, Tramit, Flow, DocumentType, Jurisdiccion,
// plantillas) NO usan este helper — siguen siendo visibles para toda la org.
// Endpoints inter-app (`/api/inter/*`) tampoco — su auth es de servicio.
//
// Composición con `withOrgScope`:
//   const where = mergeDataScopeWhere({ orgId: auth.orgId, anulado: false }, auth);
//   await prisma.expediente.findMany({ where, ... });
//
// Para apps cuya entidad no tiene `asignadoId` (p.ej. Comunicacion en
// LegiFirma), pasa `asignadoField: null` en `opts`.
//
// Módulo puro: sin imports de Prisma/Next. `appRole` se tipa como `string`
// (no `AppRole`) a propósito, para funcionar con cualquier enum `AppRole`
// per-app sin acoplar sharedlib a un schema concreto.

const BYPASS_AUTH_ROLES = new Set(['superadmin', 'org_admin']);

// Los appRoles con visibilidad completa de la org, equivalentes a org_admin
// para efectos de data scope. `NOTARIO` aplica donde existe (notaria/legifirma):
// el notario titular ve todo el despacho. En apps sin `NOTARIO` en su enum
// AppRole, ningún user tiene ese appRole, así que el `includes` nunca casa y el
// bypass solo aplica vía `authRole`.
const BYPASS_APP_ROLES: string[] = ['NOTARIO'];

export interface DataScopeAuth {
  authRole: string;
  appRole: string;
  userRoleId: string;
}

export interface DataScopeOptions {
  /** Campo FK al creador. Default `'creadoPorId'`. */
  creadoPorField?: string;
  /**
   * Campo FK al asignado. Default `'asignadoId'`. Pasa `null` cuando la
   * entidad no tiene concepto de asignado (entonces el scope solo filtra
   * por creador).
   */
  asignadoField?: string | null;
  /**
   * Visibilidad "solo míos" vs toda la org. Default `true` (comportamiento
   * histórico: el usuario non-bypass ve solo creados/asignados). Pasa `false`
   * para abrir la query a toda la organización — listados con el filtro
   * "Ver mis…" desmarcado y lecturas de detalle/sub-recursos. Las mutaciones
   * se llaman sin `mine` para mantener el scope estricto.
   */
  mine?: boolean;
}

/**
 * Indica si el usuario actual ve toda la información de su organización
 * (no aplica filtro por usuario). Útil también para decisiones de UI:
 * mostrar/ocultar el filtro "Asignado a", el toggle de dashboard, etc.
 */
export function isBypassUser(auth: DataScopeAuth): boolean {
  if (BYPASS_AUTH_ROLES.has(auth.authRole)) return true;
  if (BYPASS_APP_ROLES.includes(auth.appRole)) return true;
  return false;
}

/**
 * Devuelve el fragmento `where` que restringe a registros del usuario,
 * o `null` cuando el usuario tiene bypass.
 *
 * Output cuando hay filtro:
 *   - con asignado: `{ OR: [{ creadoPorId: id }, { asignadoId: id }] }`
 *   - sin asignado: `{ creadoPorId: id }`
 *
 * Prefiere `mergeDataScopeWhere` para no perder el `OR` del caller al
 * mezclar; usa esta función directamente cuando reutilizas el mismo scope
 * en varias queries (p.ej. dashboard con varios `count`).
 */
export function dataScopeWhere(
  auth: DataScopeAuth,
  opts: DataScopeOptions = {},
): Record<string, unknown> | null {
  if (isBypassUser(auth)) return null;
  // Cross-visibility (solo lectura): el caller pide explícitamente toda la org.
  if (opts.mine === false) return null;

  const creadoPor = opts.creadoPorField ?? 'creadoPorId';
  const asignado = opts.asignadoField === undefined ? 'asignadoId' : opts.asignadoField;
  const userId = auth.userRoleId;

  if (asignado === null) {
    return { [creadoPor]: userId };
  }
  return {
    OR: [
      { [creadoPor]: userId },
      { [asignado]: userId },
    ],
  };
}

/**
 * Combina el `where` del caller con el filtro de data scope. Cuando el
 * scope tiene `OR` y el caller también, ambos quedan envueltos en `AND`
 * para preservar la semántica de cada uno — no se sobrescriben.
 *
 *   const where = mergeDataScopeWhere(
 *     { orgId: auth.orgId, anulado: false },
 *     auth,
 *   );
 */
export function mergeDataScopeWhere<W extends Record<string, unknown>>(
  userWhere: W,
  auth: DataScopeAuth,
  opts: DataScopeOptions = {},
): Record<string, unknown> {
  const scoped = dataScopeWhere(auth, opts);
  if (!scoped) return userWhere;
  return { AND: [userWhere, scoped] };
}
