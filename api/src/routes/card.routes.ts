/**
 * Debit Card routes.
 *
 * GET   /v1/cards              — list all cards for the authenticated customer (masked)
 * GET   /v1/cards/:cardId/reveal — decrypt and return full card details
 * PATCH /v1/cards/:cardId/settings — update controls and limits
 * POST  /v1/admin/seed-cards   — ADMIN: seed demo cards for all card-less accounts
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { sanitise } from '../middleware/sanitise';
import * as cardService from '../services/card.service';

const router = Router();

const settingsSchema = {
  type: 'object',
  properties: {
    is_domestic_enabled:      { type: 'boolean' },
    is_international_enabled: { type: 'boolean' },
    is_atm_enabled:           { type: 'boolean' },
    is_online_enabled:        { type: 'boolean' },
    daily_atm_limit:          { type: 'number', minimum: 0 },
    daily_pos_limit:          { type: 'number', minimum: 0 },
    per_transaction_limit:    { type: 'number', minimum: 0 },
    monthly_limit:            { type: 'number', minimum: 0 },
  },
  additionalProperties: false,
  minProperties: 1,
};

// GET /
router.get(
  '/',
  authenticate,
  requireRole('CUSTOMER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cards = await cardService.listCardsForCustomer(req.user!.id);
      res.status(200).json({ data: cards });
    } catch (err) { next(err); }
  },
);

// GET /:cardId/reveal
router.get(
  '/:cardId/reveal',
  authenticate,
  requireRole('CUSTOMER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const details = await cardService.revealCard(
        req.params['cardId'] as string,
        req.user!.id,
      );
      res.status(200).json(details);
    } catch (err) { next(err); }
  },
);

// PATCH /:cardId/settings
router.patch(
  '/:cardId/settings',
  authenticate,
  requireRole('CUSTOMER'),
  validate(settingsSchema),
  sanitise,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const card = await cardService.updateCardSettings(
        req.params['cardId'] as string,
        req.user!.id,
        req.body as cardService.CardSettings,
      );
      res.status(200).json(card);
    } catch (err) { next(err); }
  },
);

// POST /admin/seed-cards (mounted separately in app.ts under /v1/admin)
export const adminSeedCardsHandler = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const result = await cardService.seedDemoCards();
    res.status(200).json({ message: `Created ${result.created} demo card(s)`, ...result });
  } catch (err) { next(err); }
};

export default router;
