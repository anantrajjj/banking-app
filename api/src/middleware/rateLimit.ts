/**
 * Rate-limiting middleware for authentication endpoints.
 *
 * Enforces a limit of 100 requests per minute per source IP on all `/auth/*`
 * routes. Exceeding the limit results in an HTTP 429 response with the
 * standard structured JSON error body.
 *
 * Error response shape:
 *   {
 *     "code":    "RATE_LIMIT_EXCEEDED",
 *     "message": "Too many requests, please try again later."
 *   }
 *
 * Requirements: 1.11, 12.1
 */

import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import type { RequestHandler } from 'express';

// ---------------------------------------------------------------------------
// Response body type
// ---------------------------------------------------------------------------

/** Standard error body emitted when the rate limit is breached. */
export interface RateLimitErrorResponse {
  code: 'RATE_LIMIT_EXCEEDED';
  message: string;
}

// ---------------------------------------------------------------------------
// Rate-limit handler
// ---------------------------------------------------------------------------

/**
 * Custom handler invoked by `express-rate-limit` when a client exceeds the
 * configured request threshold.
 *
 * Sends HTTP 429 with the structured JSON error body required by the spec.
 * Exported separately so unit tests can exercise the handler directly without
 * needing to trigger the full rate-limit machinery.
 */
export function rateLimitHandler(_req: Request, res: Response): void {
  const body: RateLimitErrorResponse = {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests, please try again later.',
  };
  res.status(429).json(body);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * `express-rate-limit` middleware configured for authentication routes:
 *
 *  - Window  : 60 000 ms (1 minute)
 *  - Max     : 100 requests per IP per window
 *  - Headers : emits `RateLimit-*` headers (RFC-compliant); disables legacy
 *              `X-RateLimit-*` headers
 *  - Handler : returns HTTP 429 with structured JSON on limit breach
 *
 * Apply to auth routes:
 *   app.use('/auth', authRateLimit, authRouter);
 */
export const authRateLimit: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
}) as RequestHandler;
