/**
 * Transfer and beneficiary routes.
 *
 * POST   /transfers                   — authenticate → CUSTOMER → validate → sanitise → createTransfer
 * GET    /transfers/:transferId       — authenticate → CUSTOMER → getTransfer
 * POST   /beneficiaries               — authenticate → CUSTOMER → validate → sanitise → addBeneficiary
 * GET    /beneficiaries               — authenticate → CUSTOMER → listBeneficiaries
 * DELETE /beneficiaries/:id           — authenticate → CUSTOMER → deleteBeneficiary
 * PATCH  /beneficiaries/:id/verify    — authenticate → BRANCH_MANAGER → verifyBeneficiary
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { sanitise } from '../middleware/sanitise';
import * as transferService from '../services/transfer.service';

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const transferSchema = {
  type: 'object',
  required: ['source_account_id', 'dest_account_id', 'amount', 'transfer_mode', 'idempotency_key'],
  properties: {
    source_account_id: { type: 'string', minLength: 1 },
    dest_account_id: { type: 'string', minLength: 1 },
    amount: { type: 'number', exclusiveMinimum: 0 },
    transfer_mode: { type: 'string', enum: ['NEFT', 'IMPS'] },
    idempotency_key: { type: 'string', minLength: 1 },
    narration: { type: 'string', maxLength: 500 },
  },
  additionalProperties: false,
};

const beneficiarySchema = {
  type: 'object',
  required: ['account_number', 'ifsc_code', 'name'],
  properties: {
    account_number: { type: 'string', minLength: 1, maxLength: 20 },
    ifsc_code: { type: 'string', minLength: 1, maxLength: 15 },
    name: { type: 'string', minLength: 1, maxLength: 255 },
    bank_name: { type: 'string', maxLength: 255 },
  },
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// POST /transfers
// ---------------------------------------------------------------------------

router.post(
  '/transfers',
  authenticate,
  requireRole('CUSTOMER'),
  validate(transferSchema),
  sanitise,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const customerId = req.user!.id;
      const {
        source_account_id,
        dest_account_id,
        amount,
        transfer_mode,
        idempotency_key,
        narration,
      } = req.body as {
        source_account_id: string;
        dest_account_id: string;
        amount: number;
        transfer_mode: string;
        idempotency_key: string;
        narration?: string;
      };

      const result = await transferService.createTransfer(
        customerId,
        source_account_id,
        dest_account_id,
        amount,
        transfer_mode,
        idempotency_key,
        narration,
      );

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /transfers/:transferId
// ---------------------------------------------------------------------------

router.get(
  '/transfers/:transferId',
  authenticate,
  requireRole('CUSTOMER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const customerId = req.user!.id;
      const transferId = req.params['transferId'] as string;
      const result = await transferService.getTransfer(transferId, customerId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /beneficiaries
// ---------------------------------------------------------------------------

router.post(
  '/beneficiaries',
  authenticate,
  requireRole('CUSTOMER'),
  validate(beneficiarySchema),
  sanitise,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerUserId = req.user!.id;
      const { account_number, ifsc_code, name, bank_name } = req.body as {
        account_number: string;
        ifsc_code: string;
        name: string;
        bank_name?: string;
      };

      const result = await transferService.addBeneficiary(
        ownerUserId,
        account_number,
        ifsc_code,
        name,
        bank_name,
      );

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /beneficiaries
// ---------------------------------------------------------------------------

router.get(
  '/beneficiaries',
  authenticate,
  requireRole('CUSTOMER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerUserId = req.user!.id;
      const { status } = req.query as { status?: string };
      const result = await transferService.listBeneficiaries(ownerUserId, status);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /beneficiaries/:id
// ---------------------------------------------------------------------------

router.delete(
  '/beneficiaries/:id',
  authenticate,
  requireRole('CUSTOMER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerUserId = req.user!.id;
      const id = req.params['id'] as string;
      await transferService.deleteBeneficiary(id, ownerUserId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /beneficiaries/:id/verify
// ---------------------------------------------------------------------------

router.patch(
  '/beneficiaries/:id/verify',
  authenticate,
  requireRole('BRANCH_MANAGER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const verifiedByUserId = req.user!.id;
      const id = req.params['id'] as string;
      const result = await transferService.verifyBeneficiary(id, verifiedByUserId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
