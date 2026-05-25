// @mycolegal-app/sharedlib/proxy — proxy a auth (byte-idéntico en 9-12 apps).
// Reenvía el JWT como Bearer; ante 401 limpia la cookie y devuelve SESSION_EXPIRED.

import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_INTERNAL_URL, JWT_COOKIE_NAME } from './config';

/**
 * Proxies a request to the auth service, forwarding the JWT as a Bearer token.
 * Returns a SESSION_EXPIRED error and clears the cookie if auth returns 401.
 */
export async function proxyToAuth(
  request: NextRequest,
  path: string,
  options: { method?: string; body?: string } = {},
): Promise<NextResponse> {
  const token = request.cookies.get(JWT_COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'No token' } },
      { status: 401 },
    );
  }

  const method = options.method || request.method;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const fetchOptions: RequestInit = { method, headers };

  if (method !== 'GET' && method !== 'HEAD') {
    fetchOptions.body = options.body ?? (await request.text());
  }

  const authResponse = await fetch(`${AUTH_INTERNAL_URL}${path}`, fetchOptions);

  if (authResponse.status === 401) {
    const response = NextResponse.json(
      { error: { code: 'SESSION_EXPIRED', message: 'Tu sesión ha expirado. Vuelve a iniciar sesión.' } },
      { status: 401 },
    );
    response.cookies.delete(JWT_COOKIE_NAME);
    return response;
  }

  const contentType = authResponse.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await authResponse.json();
    return NextResponse.json(data, { status: authResponse.status });
  }

  const text = await authResponse.text();
  return new NextResponse(text, { status: authResponse.status });
}

/**
 * Calls the auth service directly from a server context (not proxying a request).
 * Useful for API routes that need to make multiple calls to the auth service.
 */
export async function fetchFromAuth(
  path: string,
  token: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; data: any }> {
  const method = options.method || 'GET';
  // Solo enviamos Content-Type cuando hay body real. Sending
  // `Content-Type: application/json` en un DELETE/POST sin body engaña al
  // parser JSON de Fastify (lee 0 bytes y devuelve 400 "Unexpected end
  // of JSON input"). Caso observado:
  //   DELETE /orgs/:orgId/users/:userId/permissions/:appSlug
  // que deliberadamente no lleva body.
  const hasBody = options.body !== undefined && options.body !== null && method !== 'GET';
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (hasBody) headers['Content-Type'] = 'application/json';

  const fetchOptions: RequestInit = { method, headers };
  if (hasBody) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const res = await fetch(`${AUTH_INTERNAL_URL}${path}`, fetchOptions);
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  return { status: res.status, data };
}
