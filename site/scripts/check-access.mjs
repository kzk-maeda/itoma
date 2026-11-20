import { pathToFileURL } from 'node:url';

// Public routing identifiers, not credentials. Keep these outside the served src/ tree.
export const access = Object.freeze({
  origin: 'https://itoma.app',
  teamOrigin: 'https://soft-sea-2b9b.cloudflareaccess.com',
  audience: 'db898b0aa7e529f8dc533bd9f79555d3359b83846fd4f97bab403b3280f3ef4d',
});
export const protectedPaths = ['/', '/privacy', '/privacy/', '/assets/site.css', '/assets/site-mark.svg', '/missing'];

export function assertAccessRedirect(response) {
  let target;
  try { target = new URL(response.headers.get('location')); } catch { /* Reject missing/relative redirects. */ }
  if (response.status !== 302 || !target || target.origin !== access.teamOrigin
      || target.pathname !== '/cdn-cgi/access/login/itoma.app'
      || target.searchParams.get('kid') !== access.audience) {
    throw new Error('Expected the site-specific Cloudflare Access login; refusing deployment.');
  }
}

export async function checkAccess(fetchImpl = fetch) {
  for (const path of protectedPaths) {
    // No credentials, cookies, or redirect following. DNS/TLS/network failures also stop deploy.
    const response = await fetchImpl(access.origin + path, {
      redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (ITOMA prelaunch access check)' },
    });
    assertAccessRedirect(response);
    await response.body?.cancel();
    console.log(`Access protected: ${path}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkAccess();
}
