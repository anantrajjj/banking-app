import type { RequestHandler } from 'express';

// ---------------------------------------------------------------------------
// Role definitions (Requirement 3.6)
// ---------------------------------------------------------------------------

/** The three valid roles supported by the system. */
export type Role = 'CUSTOMER' | 'BRANCH_MANAGER' | 'ADMIN';

const VALID_ROLES = new Set<string>(['CUSTOMER', 'BRANCH_MANAGER', 'ADMIN']);

/**
 * Role hierarchy levels — higher number means more privilege.
 *
 *   CUSTOMER        → 1
 *   BRANCH_MANAGER  → 2
 *   ADMIN           → 3
 *
 * A token role satisfies a minimum requirement when its level is >= the
 * required level (Requirement 3.2, 3.3, 3.4).
 */
const ROLE_LEVEL: Record<Role, number> = {
  CUSTOMER: 1,
  BRANCH_MANAGER: 2,
  ADMIN: 3,
};

// ---------------------------------------------------------------------------
// Shared 403 response body (Requirement 3.2 – 3.4, 3.6)
// ---------------------------------------------------------------------------

const FORBIDDEN_BODY = {
  code: 'FORBIDDEN',
  message: 'Insufficient permissions',
} as const;

// ---------------------------------------------------------------------------
// requireRole factory
// ---------------------------------------------------------------------------

/**
 * Returns an Express `RequestHandler` that enforces the RBAC role hierarchy.
 *
 * The middleware expects `res.locals.user` to have been populated by the JWT
 * auth middleware (task 4.4) with at least a `role` string field.
 *
 * Behaviour:
 *  - If the role is unrecognised → HTTP 403 (Req 3.6)
 *  - If the role's hierarchy level is below `minimumRole` → HTTP 403
 *    (Req 3.2, 3.3, 3.4)
 *  - Otherwise → calls `next()`
 *
 * @param minimumRole  The lowest role that is permitted to access the endpoint.
 */
export function requireRole(
  minimumRole: 'CUSTOMER' | 'BRANCH_MANAGER' | 'ADMIN',
): RequestHandler {
  const requiredLevel = ROLE_LEVEL[minimumRole];

  return (_req, res, next): void => {
    // res.locals.user is set by the JWT auth middleware
    const user = res.locals['user'] as { role?: unknown } | undefined;
    const roleValue = user?.role;

    // Unknown or absent role → 403 (Req 3.6)
    if (typeof roleValue !== 'string' || !VALID_ROLES.has(roleValue)) {
      res.status(403).json(FORBIDDEN_BODY);
      return;
    }

    const tokenRole = roleValue as Role;
    const tokenLevel = ROLE_LEVEL[tokenRole];

    // Insufficient privilege → 403 (Req 3.2 / 3.3 / 3.4)
    if (tokenLevel < requiredLevel) {
      res.status(403).json(FORBIDDEN_BODY);
      return;
    }

    next();
  };
}
