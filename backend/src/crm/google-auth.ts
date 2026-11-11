/** Who a Google ID token belongs to, once Google has confirmed it was issued for our client id. */
export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string;
}

/**
 * Verifies a "Sign in with Google" ID token with Google's tokeninfo endpoint: signature, expiry, audience
 * (must be our client id) and a verified email. Returns null for anything that doesn't check out.
 */
export async function verifyGoogleIdToken(idToken: string, clientId: string, fetcher: typeof fetch = fetch): Promise<GoogleProfile | null> {
  if (!idToken || !clientId || idToken.length > 4096) return null;
  try {
    const res = await fetcher(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const t = (await res.json()) as Record<string, string | undefined>;
    const issuerOk = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
    const fresh = Number(t.exp) * 1000 > Date.now();
    if (t.aud !== clientId || !issuerOk || !fresh || !t.sub || t.email_verified !== 'true') return null;
    return { sub: t.sub, email: t.email ?? '', name: t.name ?? t.email ?? '', picture: t.picture ?? '' };
  } catch {
    return null;
  }
}
