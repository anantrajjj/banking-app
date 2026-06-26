import http from 'http';
import express from 'express';
import { securityMiddleware } from './security';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Spins up an Express app with only the security middleware, sends a GET /
 *  request, captures response headers, and shuts the server down. */
function getHeaders(): Promise<http.IncomingHttpHeaders> {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(securityMiddleware);
    app.get('/', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        return reject(new Error('Unexpected server address'));
      }

      const req = http.get(
        { hostname: '127.0.0.1', port: address.port, path: '/' },
        (res) => {
          // Drain the body so the socket is released
          res.resume();
          res.on('end', () => {
            server.close(() => resolve(res.headers));
          });
        },
      );

      req.on('error', (err) => {
        server.close(() => reject(err));
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('securityMiddleware — HTTP security headers (Requirement 12.1)', () => {
  let headers: http.IncomingHttpHeaders;

  beforeAll(async () => {
    headers = await getHeaders();
  }, 10_000);

  // ── Content-Security-Policy ───────────────────────────────────────────────

  describe('Content-Security-Policy', () => {
    it('sets the content-security-policy header', () => {
      expect(headers['content-security-policy']).toBeDefined();
    });

    it("includes default-src 'self'", () => {
      const csp = headers['content-security-policy'] as string;
      expect(csp).toMatch(/default-src\s+['"]self['"]/);
    });

    it("includes script-src 'self' without 'unsafe-inline'", () => {
      const csp = headers['content-security-policy'] as string;
      expect(csp).toMatch(/script-src\s+['"]self['"]/);
      // The script-src directive specifically must not permit inline scripts.
      const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    });

    it("includes object-src 'none'", () => {
      const csp = headers['content-security-policy'] as string;
      expect(csp).toMatch(/object-src\s+['"]none['"]/);
    });

    it("includes frame-ancestors 'none' (blocks framing)", () => {
      const csp = headers['content-security-policy'] as string;
      expect(csp).toMatch(/frame-ancestors\s+['"]none['"]/);
    });
  });

  // ── X-Content-Type-Options ────────────────────────────────────────────────

  describe('X-Content-Type-Options', () => {
    it('sets x-content-type-options to nosniff', () => {
      expect(headers['x-content-type-options']).toBe('nosniff');
    });
  });

  // ── X-Frame-Options ───────────────────────────────────────────────────────

  describe('X-Frame-Options', () => {
    it('sets x-frame-options to DENY', () => {
      expect(headers['x-frame-options']).toBe('DENY');
    });
  });

  // ── Strict-Transport-Security (HSTS) ──────────────────────────────────────

  describe('Strict-Transport-Security', () => {
    it('sets the strict-transport-security header', () => {
      expect(headers['strict-transport-security']).toBeDefined();
    });

    it('includes max-age of exactly 31536000 (one year)', () => {
      const hsts = headers['strict-transport-security'] as string;
      expect(hsts).toMatch(/max-age=31536000/);
    });

    it('includes includeSubDomains directive', () => {
      const hsts = headers['strict-transport-security'] as string;
      expect(hsts.toLowerCase()).toContain('includesubdomains');
    });
  });

  // ── Referrer-Policy ───────────────────────────────────────────────────────

  describe('Referrer-Policy', () => {
    it('sets referrer-policy to no-referrer', () => {
      expect(headers['referrer-policy']).toBe('no-referrer');
    });
  });
});
