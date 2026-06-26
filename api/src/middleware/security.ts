import helmet from 'helmet';
import type { RequestHandler } from 'express';

/**
 * Configured Helmet.js middleware enforcing the following security headers
 * on every HTTP response (Requirement 12.1):
 *
 *  - Content-Security-Policy   — same-origin / 'self'; no inline scripts
 *  - X-Content-Type-Options    — nosniff
 *  - X-Frame-Options           — DENY
 *  - Strict-Transport-Security — max-age=31536000; includeSubDomains (1 year)
 *  - Referrer-Policy           — no-referrer
 */
export const securityMiddleware: RequestHandler = helmet({
  // ── Content-Security-Policy ────────────────────────────────────────────────
  // Restrict all fetch directives to 'self'; explicitly block inline scripts by
  // omitting 'unsafe-inline' from script-src.
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      // script-src stays strict — no inline scripts allowed.
      scriptSrc: ["'self'"],
      // The SPA uses React inline styles and Google Fonts, so allow inline
      // styles and the Google Fonts stylesheet origin.
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      // Google Fonts / Material Symbols glyph files.
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      // 'data:' covers inline SVG background-images used in the CSS.
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },

  // ── X-Content-Type-Options: nosniff ────────────────────────────────────────
  xContentTypeOptions: true,

  // ── X-Frame-Options: DENY ─────────────────────────────────────────────────
  xFrameOptions: { action: 'deny' },

  // ── Strict-Transport-Security ─────────────────────────────────────────────
  // max-age = 31 536 000 s (1 year), includeSubDomains
  strictTransportSecurity: {
    maxAge: 31_536_000,
    includeSubDomains: true,
  },

  // ── Referrer-Policy: no-referrer ──────────────────────────────────────────
  referrerPolicy: { policy: 'no-referrer' },
}) as RequestHandler;
