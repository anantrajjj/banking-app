import type { Request, Response, NextFunction } from 'express';
import { requireRole } from './rbac';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock Response whose locals.user carries the given role.
 * We capture the status code and JSON body so assertions are straightforward.
 */
function makeMockRes(role: unknown): {
  res: Response;
  statusCode: () => number;
  body: () => unknown;
} {
  let _statusCode = 200;
  let _body: unknown = undefined;

  const res = {
    locals: { user: { id: 'u1', role, jti: 'jti1' } },
    status(code: number) {
      _statusCode = code;
      return this;
    },
    json(payload: unknown) {
      _body = payload;
      return this;
    },
  } as unknown as Response;

  return {
    res,
    statusCode: () => _statusCode,
    body: () => _body,
  };
}

const FORBIDDEN = { code: 'FORBIDDEN', message: 'Insufficient permissions' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('requireRole — RBAC middleware (Requirements 3.2, 3.3, 3.4, 3.6)', () => {
  // ── Endpoints requiring CUSTOMER role (Req 3.2) ──────────────────────────

  describe('endpoint requiring CUSTOMER', () => {
    const middleware = requireRole('CUSTOMER');
    const next: NextFunction = jest.fn();

    afterEach(() => jest.clearAllMocks());

    it('allows CUSTOMER', () => {
      const { res } = makeMockRes('CUSTOMER');
      middleware({} as Request, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows BRANCH_MANAGER (satisfies CUSTOMER via hierarchy)', () => {
      const { res } = makeMockRes('BRANCH_MANAGER');
      middleware({} as Request, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows ADMIN (satisfies CUSTOMER via hierarchy)', () => {
      const { res } = makeMockRes('ADMIN');
      middleware({} as Request, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── Endpoints requiring BRANCH_MANAGER role (Req 3.3) ────────────────────

  describe('endpoint requiring BRANCH_MANAGER', () => {
    const middleware = requireRole('BRANCH_MANAGER');
    const next: NextFunction = jest.fn();

    afterEach(() => jest.clearAllMocks());

    it('rejects CUSTOMER with HTTP 403', () => {
      const { res, statusCode, body } = makeMockRes('CUSTOMER');
      middleware({} as Request, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(statusCode()).toBe(403);
      expect(body()).toEqual(FORBIDDEN);
    });

    it('allows BRANCH_MANAGER', () => {
      const { res } = makeMockRes('BRANCH_MANAGER');
      middleware({} as Request, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows ADMIN (satisfies BRANCH_MANAGER via hierarchy)', () => {
      const { res } = makeMockRes('ADMIN');
      middleware({} as Request, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── Endpoints requiring ADMIN role (Req 3.4) ─────────────────────────────

  describe('endpoint requiring ADMIN', () => {
    const middleware = requireRole('ADMIN');
    const next: NextFunction = jest.fn();

    afterEach(() => jest.clearAllMocks());

    it('rejects CUSTOMER with HTTP 403', () => {
      const { res, statusCode, body } = makeMockRes('CUSTOMER');
      middleware({} as Request, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(statusCode()).toBe(403);
      expect(body()).toEqual(FORBIDDEN);
    });

    it('rejects BRANCH_MANAGER with HTTP 403', () => {
      const { res, statusCode, body } = makeMockRes('BRANCH_MANAGER');
      middleware({} as Request, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(statusCode()).toBe(403);
      expect(body()).toEqual(FORBIDDEN);
    });

    it('allows ADMIN', () => {
      const { res } = makeMockRes('ADMIN');
      middleware({} as Request, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── Unknown / unrecognised role (Req 3.6) ────────────────────────────────

  describe('unrecognised role claim', () => {
    const next: NextFunction = jest.fn();

    afterEach(() => jest.clearAllMocks());

    it.each([
      ['an arbitrary string', 'SUPERUSER'],
      ['an empty string', ''],
      ['a lowercase valid role', 'customer'],
      ['a number', 42],
      ['null', null],
      ['undefined', undefined],
    ])('rejects %s with HTTP 403', (_label, role) => {
      const middleware = requireRole('CUSTOMER');
      const { res, statusCode, body } = makeMockRes(role);
      middleware({} as Request, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(statusCode()).toBe(403);
      expect(body()).toEqual(FORBIDDEN);
    });
  });

  // ── Response body shape ───────────────────────────────────────────────────

  describe('403 response body', () => {
    it('always returns { code: "FORBIDDEN", message: "Insufficient permissions" }', () => {
      const middleware = requireRole('ADMIN');
      const next: NextFunction = jest.fn();
      const { res, body } = makeMockRes('CUSTOMER');
      middleware({} as Request, res, next);
      expect(body()).toStrictEqual(FORBIDDEN);
    });
  });
});
