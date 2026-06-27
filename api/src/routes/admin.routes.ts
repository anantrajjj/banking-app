/**
 * Admin routes — restricted to BRANCH_MANAGER and ADMIN roles.
 *
 * GET   /v1/admin/stats                — aggregate dashboard stats  (BRANCH_MANAGER+)
 * GET   /v1/admin/users                — paginated user list         (ADMIN)
 * PATCH /v1/admin/users/:userId/lock   — lock / unlock a user        (ADMIN)
 * GET   /v1/admin/accounts             — paginated account list       (BRANCH_MANAGER+)
 * GET   /v1/admin/loans                — paginated loan list          (BRANCH_MANAGER+)
 * GET   /v1/admin/beneficiaries        — pending verification queue   (BRANCH_MANAGER+)
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { sanitise } from '../middleware/sanitise';
import * as adminService from '../services/admin.service';

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const toggleLockSchema = {
  type: 'object',
  required: ['lock'],
  properties: {
    lock: { type: 'boolean' },
    reason: { type: 'string', maxLength: 255 },
  },
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// GET /stats
// ---------------------------------------------------------------------------

router.get(
  '/stats',
  authenticate,
  requireRole('BRANCH_MANAGER'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stats = await adminService.getDashboardStats();
      res.status(200).json(stats);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /users  (ADMIN only)
// ---------------------------------------------------------------------------

router.get(
  '/users',
  authenticate,
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        page: pageStr,
        page_size: psStr,
        search,
        role,
      } = req.query as Record<string, string | undefined>;

      const page = Math.max(1, parseInt(pageStr ?? '1', 10));
      const pageSize = Math.min(50, Math.max(1, parseInt(psStr ?? '20', 10)));

      const result = await adminService.listUsers(page, pageSize, search, role);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /users/:userId/lock  (ADMIN only)
// ---------------------------------------------------------------------------

router.patch(
  '/users/:userId/lock',
  authenticate,
  requireRole('ADMIN'),
  validate(toggleLockSchema),
  sanitise,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params as { userId: string };
      const { lock, reason } = req.body as { lock: boolean; reason?: string };
      await adminService.toggleUserLock(userId, lock, reason, req.user!.id);
      res.status(200).json({ message: lock ? 'User locked successfully' : 'User unlocked successfully' });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /accounts
// ---------------------------------------------------------------------------

router.get(
  '/accounts',
  authenticate,
  requireRole('BRANCH_MANAGER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        page: pageStr,
        page_size: psStr,
        user_id,
      } = req.query as Record<string, string | undefined>;

      const page = Math.max(1, parseInt(pageStr ?? '1', 10));
      const pageSize = Math.min(50, Math.max(1, parseInt(psStr ?? '20', 10)));

      const result = await adminService.listAllAccounts(page, pageSize, user_id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /loans
// ---------------------------------------------------------------------------

router.get(
  '/loans',
  authenticate,
  requireRole('BRANCH_MANAGER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        page: pageStr,
        page_size: psStr,
        decision,
      } = req.query as Record<string, string | undefined>;

      const page = Math.max(1, parseInt(pageStr ?? '1', 10));
      const pageSize = Math.min(50, Math.max(1, parseInt(psStr ?? '20', 10)));

      const result = await adminService.listAllLoans(page, pageSize, decision);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /beneficiaries  — pending verification queue
// ---------------------------------------------------------------------------

router.get(
  '/beneficiaries',
  authenticate,
  requireRole('BRANCH_MANAGER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        page: pageStr,
        page_size: psStr,
      } = req.query as Record<string, string | undefined>;

      const page = Math.max(1, parseInt(pageStr ?? '1', 10));
      const pageSize = Math.min(50, Math.max(1, parseInt(psStr ?? '20', 10)));

      const result = await adminService.listPendingBeneficiaries(page, pageSize);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
