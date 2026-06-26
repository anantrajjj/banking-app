/**
 * Auth routes — login, MFA verification, logout, token refresh, health check.
 *
 * POST /login    — rate-limit → validate → sanitise → authService.login
 * POST /mfa      — validate → sanitise → authService.verifyMfa
 * POST /logout   — authenticate → authService.logout
 * POST /refresh  — validate → sanitise → authService.refreshToken
 * GET  /health   — { status: 'ok' }
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authRateLimit } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { sanitise } from '../middleware/sanitise';
import { authenticate } from '../middleware/auth';
import { getRedisClient } from '../middleware/auth';
import * as authService from '../services/auth.service';

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const loginSchema = {
  type: 'object',
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 100 },
    password: { type: 'string', minLength: 1, maxLength: 255 },
  },
  additionalProperties: false,
};

const mfaSchema = {
  type: 'object',
  required: ['mfa_challenge_id', 'otp'],
  properties: {
    mfa_challenge_id: { type: 'string', minLength: 1 },
    otp: { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' },
  },
  additionalProperties: false,
};

const refreshSchema = {
  type: 'object',
  required: ['refresh_token'],
  properties: {
    refresh_token: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------

router.post(
  '/login',
  authRateLimit,
  validate(loginSchema),
  sanitise,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { username, password } = req.body as { username: string; password: string };
      const result = await authService.login(username, password);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /mfa
// ---------------------------------------------------------------------------

router.post(
  '/mfa',
  validate(mfaSchema),
  sanitise,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { mfa_challenge_id, otp } = req.body as {
        mfa_challenge_id: string;
        otp: string;
      };
      const redis = getRedisClient();
      const result = await authService.verifyMfa(mfa_challenge_id, otp, redis);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /logout
// ---------------------------------------------------------------------------

router.post(
  '/logout',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication required' });
        return;
      }

      const { refresh_token } = req.body as { refresh_token?: string };
      const redis = getRedisClient();

      await authService.logout(user.jti, refresh_token ?? '', redis);
      res.status(200).json({ message: 'Logged out successfully' });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /refresh
// ---------------------------------------------------------------------------

router.post(
  '/refresh',
  validate(refreshSchema),
  sanitise,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refresh_token } = req.body as { refresh_token: string };
      const redis = getRedisClient();
      const result = await authService.refreshToken(refresh_token, redis);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
