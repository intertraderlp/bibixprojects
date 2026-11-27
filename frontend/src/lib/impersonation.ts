// Client-side "Sign in as" (impersonation) helpers.
// When an admin impersonates a user we stash the admin's own JWT so they can
// return to their account. All state lives in localStorage so the banner works
// after a full page reload (which we do on enter/exit to reset app state).

const ORIGIN_KEY = 'imp_origin_token'; // the admin's own JWT
const TARGET_KEY = 'imp_target_name';  // display name of who we're signed in as
const BY_KEY     = 'imp_by_name';      // display name of the admin impersonating

export function isImpersonating(): boolean {
  try { return !!localStorage.getItem(ORIGIN_KEY); } catch { return false; }
}

export function impersonationInfo(): { target: string; by: string } | null {
  if (!isImpersonating()) return null;
  return {
    target: localStorage.getItem(TARGET_KEY) || 'user',
    by: localStorage.getItem(BY_KEY) || 'admin',
  };
}

// Swap the current token for the target's token and reload into their session.
export function enterImpersonation(newToken: string, targetName: string, byName: string) {
  const current = localStorage.getItem('token');
  if (current) localStorage.setItem(ORIGIN_KEY, current);
  localStorage.setItem(TARGET_KEY, targetName);
  localStorage.setItem(BY_KEY, byName);
  localStorage.setItem('token', newToken);
  window.location.href = '/'; // reload fresh as the target user
}

// Restore the admin's own token and return to the admin area.
export function exitImpersonation(redirect = '/admin') {
  const origin = localStorage.getItem(ORIGIN_KEY);
  if (origin) localStorage.setItem('token', origin);
  localStorage.removeItem(ORIGIN_KEY);
  localStorage.removeItem(TARGET_KEY);
  localStorage.removeItem(BY_KEY);
  window.location.href = redirect;
}
