/**
 * Account routes — account summary and mini-statement.
 *
 * GET /          — authenticate → requireRole('CUSTOMER') → accountService.getAccountSummary
 * GET /:accountId/mini-statement
 *               — authenticate → requireRole('CUSTOMER') → accountService.getMiniStatement
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import * as accountService from '../services/account.service';

const router = Router();

// ---------------------------------------------------------------------------
// GET /
// ---------------------------------------------------------------------------

router.get(
  '/',
  authenticate,
  requireRole('CUSTOMER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const accounts = await accountService.getAccountSummary(userId);
      res.status(200).json({ data: accounts });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /:accountId/mini-statement
// ---------------------------------------------------------------------------

router.get(
  '/:accountId/mini-statement',
  authenticate,
  requireRole('CUSTOMER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const accountId = req.params['accountId'] as string;
      const transactions = await accountService.getMiniStatement(accountId, userId);
      res.status(200).json({ data: transactions });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
