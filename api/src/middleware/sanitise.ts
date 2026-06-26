import type { Request, Response, NextFunction } from 'express';

/**
 * Strips HTML tags and JavaScript event handler attributes from a string.
 *
 * Two-pass approach:
 *  1. Remove JS event handler attributes (e.g. onerror="...", onclick='...', onload=alert(1))
 *  2. Remove all remaining HTML/XML tags (e.g. <script>...</script>, <img>, etc.)
 */
export function sanitiseString(value: string): string {
  // Pass 1: strip JS event handler attributes (on* = "..." or on* = '...' or bare on*=value)
  // Matches: onXxx="...", onXxx='...', onXxx=value (no quotes), case-insensitive
  let result = value.replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');

  // Pass 2: strip all HTML/XML tags including self-closing ones
  result = result.replace(/<[^>]*>/g, '');

  return result;
}

/**
 * Recursively walks an object/array and sanitises every string value in-place.
 */
export function sanitiseObject(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string') {
      obj[key] = sanitiseString(val);
    } else if (val !== null && typeof val === 'object') {
      sanitiseObject(val as Record<string, unknown>);
    }
    // numbers, booleans, null, undefined — left unchanged
  }
}

/**
 * Express middleware that sanitises all string fields in req.body, req.query,
 * and req.params, stripping HTML tags and JavaScript event handlers.
 *
 * Mutates the request objects in-place and calls next().
 */
export function sanitise(req: Request, _res: Response, next: NextFunction): void {
  if (req.body !== null && typeof req.body === 'object') {
    sanitiseObject(req.body as Record<string, unknown>);
  }

  if (req.query !== null && typeof req.query === 'object') {
    sanitiseObject(req.query as unknown as Record<string, unknown>);
  }

  if (req.params !== null && typeof req.params === 'object') {
    sanitiseObject(req.params as Record<string, unknown>);
  }

  next();
}
