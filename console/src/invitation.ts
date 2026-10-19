import { uuidPattern } from './organizations';
export type PendingInvitation = { organizationId: string; inviteId: string; token: string };
const key = 'dialoga:pending-invitation';
function valid(value: unknown): value is PendingInvitation {
  if (!value || typeof value !== 'object') return false;
  const v = value as PendingInvitation;
  return typeof v.organizationId === 'string' && uuidPattern.test(v.organizationId) && typeof v.inviteId === 'string' && uuidPattern.test(v.inviteId) && typeof v.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v.token);
}
let captured: PendingInvitation | null = null;
// A secret belongs in the fragment, never in a query string or API URL. Strip it
// immediately from browser history; keep it only for the same-tab OIDC round trip.
const params = new URLSearchParams(window.location.hash.slice(1));
if (params.has('token')) {
  const value = { organizationId: params.get('organization'), inviteId: params.get('invite'), token: params.get('token') };
  if (valid(value)) {
    captured = value;
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Same-page acceptance remains possible. */ }
  } else {
    // A malformed new link must never fall back to an older invitation.
    try { sessionStorage.removeItem(key); } catch { /* Optional storage. */ }
  }
  params.delete('token');
  window.history.replaceState(null, '', window.location.pathname + window.location.search + '#' + params.toString());
}
export function readInvitation(): PendingInvitation | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    return valid(value) ? value : captured;
  } catch { return captured; }
}
export function clearInvitation() {
  captured = null;
  try {
    sessionStorage.removeItem(key);
    sessionStorage.removeItem('dialoga:requested-organization');
    sessionStorage.removeItem('dialoga:requested-project');
  } catch { /* Storage is optional. */ }
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}
export function invitationLink(org: string, id: string, token: string) {
  const fragment = new URLSearchParams({ organization: org, invite: id, token });
  return new URL('/#' + fragment.toString(), window.location.origin).href;
}
