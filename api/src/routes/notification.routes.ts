/**
 * Notification routes.
 *
 * GET /v1/notifications — return derived activity notifications for the
 *                         authenticated user (no minimum role beyond auth).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import * as notificationService from '../services/notification.service';

const router = Router();

router.get(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const notifications = await notificationService.getNotifications(req.user!.id);
      res.status(200).json({ data: notifications });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
