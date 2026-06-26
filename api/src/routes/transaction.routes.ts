/**
 * Transaction routes — transaction history and CSV export.
 *
 * GET /:accountId/transactions        — authenticate → requireRole('CUSTOMER') → getTransactionHistory
 * GET /:accountId/transactions/export — authenticate → requireRole('CUSTOMER') → exportCsvStatement
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import * as transactionService from '../services/transaction.service';
import type { TransactionFilters } from '../services/transaction.service';

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// GET /:accountId/transactions/export
// Must come before /:accountId/transactions to avoid route shadowing
// ---------------------------------------------------------------------------

router.get(
  '/:accountId/transactions/export',
  authenticate,
  requireRole('CUSTOMER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const accountId = req.params['accountId'] as string;
      const { start_date, end_date } = req.query as {
        start_date?: string;
        end_date?: string;
      };

      const result = await transactionService.exportCsvStatement(
        accountId,
        userId,
        start_date,
        end_date,
      );

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`,
      );
      res.status(200).send(result.csv);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /:accountId/transactions
// ---------------------------------------------------------------------------

router.get(
  '/:accountId/transactions',
  authenticate,
  requireRole('CUSTOMER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const accountId = req.params['accountId'] as string;

      const {
        start_date,
        end_date,
        min_amount,
        max_amount,
        type,
        page: pageStr,
        page_size: pageSizeStr,
      } = req.query as Record<string, string | undefined>;

      const filters: TransactionFilters = {
        start_date,
        end_date,
        min_amount: min_amount !== undefined ? parseFloat(min_amount) : undefined,
        max_amount: max_amount !== undefined ? parseFloat(max_amount) : undefined,
        type:
          type === 'DEBIT' || type === 'CREDIT' ? type : undefined,
      };

      const page = pageStr ? parseInt(pageStr, 10) : 1;
      const pageSize = pageSizeStr ? parseInt(pageSizeStr, 10) : 25;

      const result = await transactionService.getTransactionHistory(
        accountId,
        userId,
        filters,
        page,
        pageSize,
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
