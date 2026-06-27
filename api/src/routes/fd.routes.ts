/**
 * Fixed Deposit routes.
 *
 * GET  /v1/fd                    — list customer's FDs
 * POST /v1/fd                    — open a new FD
 * GET  /v1/fd/rates              — get interest rate slabs (public preview)
 * GET  /v1/fd/:fdId              — get single FD details
 * DELETE /v1/fd/:fdId            — premature closure
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { sanitise } from '../middleware/sanitise';
import * as fdService from '../services/fd.service';

const router = Router();

const openFDSchema = {
  type: 'object',
  required: ['source_account_id', 'principal', 'tenure_months'],
  properties: {
    source_account_id: { type: 'string', minLength: 1 },
    principal: { type: 'number', minimum: 1000 },
    tenure_months: { type: 'integer', enum: [3, 6, 12, 24, 36, 60] },
  },
  additionalProperties: false,
};

// GET /rates — no auth needed, used by UI previewer
router.get('/rates', (_req: Request, res: Response) => {
  const slabs = fdService.TENURE_OPTIONS.map((opt) => ({
    ...opt,
    rate: fdService.getInterestRate(opt.months),
    preview: fdService.calculateMaturity(100000, fdService.getInterestRate(opt.months), opt.months),
  }));
  res.status(200).json({ data: slabs });
});

// GET /
router.get(
  '/',
  authenticate,
  requireRole('CUSTOMER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const fds = await fdService.listFDs(req.user!.id);
      res.status(200).json({ data: fds });
    } catch (err) { next(err); }
  },
);

// POST /
router.post(
  '/',
  authenticate,
  requireRole('CUSTOMER'),
  validate(openFDSchema),
  sanitise,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { source_account_id, principal, tenure_months } = req.body as {
        source_account_id: string;
        principal: number;
        tenure_months: number;
      };
      const fd = await fdService.openFD(req.user!.id, source_account_id, principal, tenure_months);
      res.status(201).json(fd);
    } catch (err) { next(err); }
  },
);

// GET /:fdId
router.get(
  '/:fdId',
  authenticate,
  requireRole('CUSTOMER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const fd = await fdService.getFD(req.params['fdId'] as string, req.user!.id);
      res.status(200).json(fd);
    } catch (err) { next(err); }
  },
);

// DELETE /:fdId  — premature closure
router.delete(
  '/:fdId',
  authenticate,
  requireRole('CUSTOMER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await fdService.closeFDPrematurely(req.params['fdId'] as string, req.user!.id);
      res.status(200).json(result);
    } catch (err) { next(err); }
  },
);

export default router;
