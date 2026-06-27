/**
 * userStore — lightweight role helpers derived from the in-memory access token.
 *
 * JWTs are base64url-encoded and safe to decode client-side for display
 * purposes. The backend always re-validates the signature on every request,
 * so client-side decoding is UI-only and carries no security risk.
 */

export type Role = 'CUSTOMER' | 'BRANCH_MANAGER' | 'ADMIN';

const ROLE_LEVEL: Record<Role, number> = {
  CUSTOMER: 1,
  BRANCH_MANAGER: 2,
  ADMIN: 3,
};

interface JwtClaims {
  sub: string;
  role: Role;
  jti: string;
  exp: number;
}

export function decodeJwtClaims(token: string): JwtClaims | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    // Handle base64url encoding
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)) as JwtClaims;
  } catch {
    return null;
  }
}

export function getUserRole(token: string | null): Role | null {
  if (!token) return null;
  return decodeJwtClaims(token)?.role ?? null;
}

/** Returns true when the user's role level is ≥ the required minimum. */
export function isAtLeast(token: string | null, minRole: Role): boolean {
  const role = getUserRole(token);
  if (!role) return false;
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minRole];
}

export function roleLabel(role: Role | null): string {
  switch (role) {
    case 'ADMIN': return 'Admin';
    case 'BRANCH_MANAGER': return 'Branch Manager';
    case 'CUSTOMER': return 'Customer';
    default: return 'Unknown';
  }
}
