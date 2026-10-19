import { uuidPattern } from './organizations';

export function workspaceRoute() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const org = params.get('organization');
  const project = params.get('project');
  return {
    organizationId: org && uuidPattern.test(org) ? org : null,
    projectId: org && uuidPattern.test(org) && project && uuidPattern.test(project) ? project : null,
  };
}
export function workspaceHash(organizationId: string, projectId?: string) {
  return `#organization=${organizationId}${projectId ? `&project=${projectId}` : ''}`;
}
export function captureWorkspaceRoute() {
  const route = workspaceRoute();
  if (!route.organizationId) return;
  try {
    sessionStorage.setItem('dialoga:requested-organization', route.organizationId);
    if (route.projectId) sessionStorage.setItem('dialoga:requested-project', JSON.stringify(route));
    else sessionStorage.removeItem('dialoga:requested-project');
  } catch { /* Navigation must also work when optional storage is unavailable. */ }
}
export function requestedProject(organizationId: string): string | null {
  const route = workspaceRoute();
  if (route.organizationId === organizationId) return route.projectId;
  try {
    const saved = JSON.parse(sessionStorage.getItem('dialoga:requested-project') || 'null');
    return saved?.organizationId === organizationId && typeof saved.projectId === 'string' && uuidPattern.test(saved.projectId) ? saved.projectId : null;
  } catch { return null; }
}
export function clearRequestedProject() {
  try { sessionStorage.removeItem('dialoga:requested-project'); } catch { /* Optional storage. */ }
}
