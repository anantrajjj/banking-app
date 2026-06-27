/**
 * Profile routes — view and update the authenticated user's own profile.
 *
 * GET  /v1/profile             — return non-sensitive profile fields
 * PUT  /v1/profile/password    — change password (requires current password)
 * PUT  /v1/profile/otp-channel — switch MFA delivery channel (EMAIL | SMS)
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { sanitise } from '../middleware/sanitise';
import * as profileService from '../services/profile.service';

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const changePasswordSchema = {
  type: 'object',
  required: ['current_password', 'new_password'],
  properties: {
    current_password: { type: 'string', minLength: 1, maxLength: 255 },
    new_password: { type: 'string', minLength: 8, maxLength: 255 },
  },
  additionalProperties: false,
};

const otpChannelSchema = {
  type: 'object',
  required: ['channel'],
  properties: {
    channel: { type: 'string', enum: ['EMAIL', 'SMS'] },
  },
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// GET /
// ---------------------------------------------------------------------------

router.get(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const profile = await profileService.getProfile(req.user!.id);
      res.status(200).json(profile);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /password
// ---------------------------------------------------------------------------

router.put(
  '/password',
  authenticate,
  validate(changePasswordSchema),
  sanitise,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { current_password, new_password } = req.body as {
        current_password: string;
        new_password: string;
      };
      await profileService.changePassword(req.user!.id, current_password, new_password);
      res.status(200).json({ message: 'Password updated successfully' });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /otp-channel
// ---------------------------------------------------------------------------

router.put(
  '/otp-channel',
  authenticate,
  validate(otpChannelSchema),
  sanitise,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { channel } = req.body as { channel: 'EMAIL' | 'SMS' };
      await profileService.updateOtpChannel(req.user!.id, channel);
      res.status(200).json({ message: 'OTP channel updated successfully' });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
