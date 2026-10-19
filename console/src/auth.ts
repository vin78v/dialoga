import Keycloak from 'keycloak-js';

export const auth = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8081',
  realm: import.meta.env.VITE_KEYCLOAK_REALM || 'dialoga',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'dialoga-console',
});

// Use the same fixed callback for login and logout; never accept a URL from query parameters.
export const redirectUri = new URL('/', window.location.origin).href;
let initialization: Promise<boolean> | undefined;
export function initializeAuth() {
  return initialization ??= auth.init({
    redirectUri,
    onLoad: 'check-sso',
    flow: 'standard',
    pkceMethod: 'S256',
    responseMode: 'query',
    checkLoginIframe: false,
    // Recover an existing SSO session without storing tokens in browser storage.
  });
}

export type Profile = { id: string; email: string; firstName: string | null; lastName: string | null };
export class SessionExpired extends Error {}

export async function authenticatedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  try {
    await auth.updateToken(30);
  } catch {
    auth.clearToken();
    throw new SessionExpired();
  }
  if (!auth.token) throw new SessionExpired();
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${auth.token}`);
  const response = await fetch(`${import.meta.env.VITE_API_URL || ''}${path}`, {
    ...options, headers, cache: 'no-store',
  });
  if (response.status === 401) {
    auth.clearToken();
    throw new SessionExpired();
  }
  return response;
}

export async function loadProfile(signal: AbortSignal): Promise<Profile> {
  const response = await authenticatedFetch('/api/me', { signal });
  if (!response.ok) throw new Error('Non è stato possibile caricare il profilo. Riprova tra poco.');
  return response.json();
}
