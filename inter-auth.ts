// @mycolegal-app/sharedlib/inter-auth — validación de auth servicio-a-servicio
// (convención canónica de INTEGRATIONS_CONTRACT.md §3): `X-Service-Key` (env
// INTER_SERVICE_KEY) + `X-Org-Id`. Núcleo byte-idéntico extraído de las apps
// que exponen receivers `/api/inter/*`.
//
// Solo el núcleo `verifyInterAuth` + interfaces. Lo app-específico (p.ej.
// `resolveServiceCreatorId`, que difiere en el filtro `active`/forma de pasar
// el cliente Prisma) se queda en cada app.
//
// El secreto se lee EN CADA request a propósito: Next.js puede capturar
// expresiones top-level en build y dejarnos con un valor obsoleto.

import { NextResponse, type NextRequest } from 'next/server';

export interface InterAuthOk {
  ok: true;
  orgId: string;
  /** Identidad del usuario final reenviada por la app llamante (X-User-Id),
   *  p.ej. para acotar el historial de conversación de MycoBot por usuario.
   *  Opcional: las llamadas puramente de servicio pueden omitirla. */
  userId?: string;
}

export interface InterAuthErr {
  ok: false;
  response: NextResponse;
}

export function verifyInterAuth(request: NextRequest): InterAuthOk | InterAuthErr {
  const SERVICE_KEY = process.env.INTER_SERVICE_KEY ?? '';
  if (!SERVICE_KEY) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'CONFIG_ERROR', message: 'INTER_SERVICE_KEY no configurado' } },
        { status: 500 },
      ),
    };
  }
  const provided = request.headers.get('x-service-key');
  if (!provided || provided !== SERVICE_KEY) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Service key inválida' } },
        { status: 401 },
      ),
    };
  }
  const orgId = request.headers.get('x-org-id');
  if (!orgId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'X-Org-Id requerido' } },
        { status: 400 },
      ),
    };
  }
  const userId = request.headers.get('x-user-id') ?? undefined;
  return { ok: true, orgId, userId };
}
