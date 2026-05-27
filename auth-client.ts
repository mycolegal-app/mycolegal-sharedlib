// @mycolegal-app/sharedlib/auth-client — helpers servicio-a-servicio contra
// mycolegal-auth (bloque byte-idéntico extraído de las apps). Usan
// AUTH_INTERNAL_URL para toda la comunicación interna.

import { AUTH_INTERNAL_URL } from './config';

// --------------------------------------------------------------------------
// API calls (server-to-server via internal URL)
// --------------------------------------------------------------------------

export interface TokenRefreshResponse {
  accessToken: string;
  expiresIn: number;
}

/**
 * Exchanges a refresh token for a new access token via the auth service.
 */
export async function refreshToken(
  currentRefreshToken: string,
): Promise<TokenRefreshResponse> {
  const res = await fetch(`${AUTH_INTERNAL_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: currentRefreshToken }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<TokenRefreshResponse>;
}

export interface AuthUserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  orgId: string;
  authRole: string;
}

/**
 * Fetches the user profile from mycolegal-auth.
 */
export async function fetchUserProfile(
  authUserId: string,
  accessToken: string,
): Promise<AuthUserProfile> {
  const res = await fetch(`${AUTH_INTERNAL_URL}/api/users/${authUserId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch user profile (${res.status}): ${body}`);
  }

  return res.json() as Promise<AuthUserProfile>;
}
