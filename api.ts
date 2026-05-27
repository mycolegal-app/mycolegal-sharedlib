// @mycolegal-app/sharedlib/api — helpers puros de respuesta + paginación para
// route handlers (reconciliados desde el `api-utils.ts` de cada app). Las
// diferencias entre apps eran tipado/formato salvo el clamp de paginación:
// este canónico es la versión robusta (guards de NaN + clamp de mínimo/máximo),
// estricta mejora sobre todas las variantes previas.
//
// Los wrappers `withAuth`/`withPermission` (+ variantes) y `hasPerm` se quedan
// en cada app: atan `getAuthContext` y la capa de permisos (ROLE_PERMISSIONS o
// hasPermission/hasPermissionFromList), que son app-specific. Importan estos
// helpers compartidos.
//
// `next` es peerDependency OPCIONAL (solo se usa `NextResponse`).
import { NextResponse } from 'next/server';

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface ApiError {
  error: { code: string; message: string };
}

export function successResponse<T>(
  data: T,
  meta?: PaginationMeta,
): NextResponse<ApiResponse<T>> {
  const body: ApiResponse<T> = { data };
  if (meta) body.meta = meta;
  return NextResponse.json(body);
}

export function errorResponse(
  code: string,
  message: string,
  status = 400,
): NextResponse<ApiError> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export interface ParsedSearchParams {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  filters: Record<string, string>;
}

export function parseSearchParams(url: URL): ParsedSearchParams {
  const params = url.searchParams;
  // Guards robustos: params no numéricos (NaN) → default; negativos → clamp.
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, parseInt(params.get('pageSize') || '20', 10) || 20),
  );
  const sortBy = params.get('sortBy') || 'createdAt';
  const sortOrder = params.get('sortOrder') === 'asc' ? 'asc' : 'desc';

  // Resto de params → filtros (excluye las claves de paginación/orden).
  const reservedKeys = new Set(['page', 'pageSize', 'sortBy', 'sortOrder']);
  const filters: Record<string, string> = {};
  params.forEach((value, key) => {
    if (!reservedKeys.has(key)) filters[key] = value;
  });

  return { page, pageSize, sortBy, sortOrder, filters };
}

export function getPaginationParams(searchParams: ParsedSearchParams): {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
} {
  const { page, pageSize } = searchParams;
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

export function buildPaginationMeta(
  total: number,
  params: { page: number; pageSize: number },
): PaginationMeta {
  return {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.ceil(total / params.pageSize),
  };
}
