// Load .env file in development before anything else.
// In production (Render) configuration comes from the service environment.
import 'dotenv/config';

/**
 * SecureBank Express application entry point.
 *
 * Middleware pipeline:
 *   requestLogger → securityMiddleware → CORS (optional) → express.json({ limit: '100kb' })
 *   → sanitise
 *   → /v1/auth (with authRateLimit)
 *   → /v1/accounts
 *   → /v1/transactions
 *   → /v1/transfers + /v1/beneficiaries
 *   → /v1/loans
 *   → static frontend (if a build is present) with SPA fallback
 *   → centralised error handler
 *
 * All configuration is supplied via environment variables — nothing is
 * hardcoded. See .env.example for the full list.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { requestLogger } from './utils/logger';
import { securityMiddleware } from './middleware/security';
import { sanitise } from './middleware/sanitise';
import { logger } from './utils/logger';

import { authRateLimit } from './middleware/rateLimit';
import authRouter from './routes/auth.routes';
import accountRouter from './routes/account.routes';
import transactionRouter from './routes/transaction.routes';
import transferRouter from './routes/transfer.routes';
import loanRouter from './routes/loan.routes';

import { AuthError } from './services/auth.service';
import { ServiceError } from './services/account.service';
import { TransferError } from './services/transfer.service';
import { LoanError } from './services/loan.service';

// ---------------------------------------------------------------------------
// Application assembly
// ---------------------------------------------------------------------------

const app = express();

// Trust the Render/ALB proxy so secure cookies, rate-limit IPs, and protocol
// detection work behind the load balancer.
app.set('trust proxy', 1);

// ── Global middleware (always active) ──────────────────────────────────────
app.use(requestLogger);
app.use(securityMiddleware);

// ── CORS (optional) ────────────────────────────────────────────────────────
// Only needed when the frontend is served from a DIFFERENT origin than the API.
// When the API serves the built frontend itself (default on Render), requests
// are same-origin and this is unnecessary. Configure CORS_ORIGIN with a
// comma-separated list of allowed origins (or "*") to enable it.
const corsOriginEnv = process.env['CORS_ORIGIN'];
if (corsOriginEnv) {
  const allowed = corsOriginEnv.split(',').map((o) => o.trim()).filter(Boolean);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (allowed.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Correlation-Id');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

app.use(express.json({ limit: '100kb' }));
app.use(sanitise);

// ── Health check ───────────────────────────────────────────────────────────
app.get('/v1/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// ---------------------------------------------------------------------------
// API routes — real DB, Redis, JWT, RBAC.
// ---------------------------------------------------------------------------
app.use('/v1/auth', authRateLimit, authRouter);
app.use('/v1/accounts', accountRouter);
app.use('/v1/accounts', transactionRouter);
app.use('/v1', transferRouter);
app.use('/v1', loanRouter);

// ---------------------------------------------------------------------------
// Static frontend (single-service deploy).
// When a built frontend is present, serve it and fall back to index.html for
// client-side routes. The directory can be overridden with FRONTEND_DIR.
// ---------------------------------------------------------------------------
const FRONTEND_DIR = process.env['FRONTEND_DIR'] ?? path.join(__dirname, 'public');
if (fs.existsSync(path.join(FRONTEND_DIR, 'index.html'))) {
  app.use(express.static(FRONTEND_DIR));
  // SPA fallback for any non-API GET route.
  app.get(/^(?!\/v1\/).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
  logger.info('Serving static frontend', { dir: FRONTEND_DIR });
} else {
  logger.info('No static frontend build found; running API only', { dir: FRONTEND_DIR });
}

// ── Centralised error handler ─────────────────────────────────────────────
interface ErrorBody {
  code: string;
  message: string;
  detail?: unknown;
  retry_after?: number;
  correlation_id?: string;
}

app.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const correlationId =
      (res.locals['correlation_id'] as string | undefined) ??
      (req.headers['x-correlation-id'] as string | undefined);

    if (err instanceof AuthError) {
      const body: ErrorBody = { code: err.code, message: err.detail ?? err.code, correlation_id: correlationId };
      res.status(err.statusCode).json(body);
      return;
    }
    if (err instanceof ServiceError) {
      const body: ErrorBody = { code: err.code, message: err.detail ?? err.code, correlation_id: correlationId };
      if (err.retryAfter !== undefined) {
        body.retry_after = err.retryAfter;
        res.setHeader('Retry-After', String(err.retryAfter));
      }
      res.status(err.statusCode).json(body);
      return;
    }
    if (err instanceof TransferError) {
      const body: ErrorBody = {
        code: err.code,
        message: typeof err.detail === 'string' ? err.detail : err.code,
        correlation_id: correlationId,
      };
      if (err.detail && typeof err.detail === 'object') body.detail = err.detail;
      res.status(err.statusCode).json(body);
      return;
    }
    if (err instanceof LoanError) {
      const body: ErrorBody = {
        code: err.code,
        message: typeof err.detail === 'string' ? err.detail : err.code,
        correlation_id: correlationId,
      };
      if (err.detail && typeof err.detail === 'object') body.detail = err.detail;
      res.status(err.statusCode).json(body);
      return;
    }

    logger.error('Unhandled error', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      correlationId,
    });
    res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      correlation_id: correlationId,
    });
  },
);

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

if (require.main === module) {
  app.listen(PORT, () => {
    logger.info('SecureBank API started', { port: PORT });
  });
}

export default app;
