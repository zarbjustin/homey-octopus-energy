'use strict';

/**
 * Read a JWT's `exp` (expiry) claim as epoch milliseconds, or null when the
 * token is malformed or carries no usable numeric `exp`.
 *
 * This is signature-AGNOSTIC and deliberately so: we never trust the token's
 * contents for authorization — the server already validates it. We only read
 * the server-issued expiry so we can schedule a proactive refresh exactly when
 * the token actually expires, instead of guessing a fixed lifetime.
 */
export function jwtExpiryMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  // Reject a payload segment that is not valid unpadded base64url up front —
  // Buffer decoding is lenient and would silently drop invalid characters.
  if (!/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json) as { exp?: unknown };
    const { exp } = payload;
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) return null;
    const ms = exp * 1000;
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}
