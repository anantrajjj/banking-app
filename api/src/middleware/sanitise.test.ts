import type { Request, Response, NextFunction } from 'express';
import { sanitise, sanitiseString, sanitiseObject } from './sanitise';

// ---------------------------------------------------------------------------
// sanitiseString — unit tests
// ---------------------------------------------------------------------------

describe('sanitiseString', () => {
  describe('HTML tag stripping', () => {
    it('strips a <script>...</script> block', () => {
      expect(sanitiseString("<script>alert('xss')</script>")).toBe("alert('xss')");
    });

    it('strips self-closing <img> tag', () => {
      expect(sanitiseString('<img src="x">')).toBe('');
    });

    it('strips <img> with onerror inline — full tag removed', () => {
      // The whole tag is removed; even if it contains an event handler
      const result = sanitiseString('<img src="x" onerror="alert(1)">');
      expect(result).toBe('');
    });

    it('strips nested/multiple tags', () => {
      expect(sanitiseString('<b>bold</b> and <i>italic</i>')).toBe('bold and italic');
    });

    it('strips <script> tag with no content', () => {
      expect(sanitiseString('<script></script>')).toBe('');
    });

    it('strips a bare <svg> tag', () => {
      expect(sanitiseString('<svg onload="alert(1)">')).toBe('');
    });

    it('preserves plain text with no HTML', () => {
      expect(sanitiseString('Hello, World!')).toBe('Hello, World!');
    });

    it('preserves numbers-as-strings', () => {
      expect(sanitiseString('42')).toBe('42');
    });
  });

  describe('JS event handler stripping', () => {
    it('strips onerror= attribute with double-quoted value', () => {
      const result = sanitiseString('onerror="alert(1)"');
      expect(result).toBe('');
    });

    it('strips onerror= attribute with single-quoted value', () => {
      const result = sanitiseString("onerror='alert(1)'");
      expect(result).toBe('');
    });

    it('strips onclick= attribute', () => {
      const result = sanitiseString('onclick=doSomething()');
      expect(result).toBe('');
    });

    it('strips onload= attribute', () => {
      const result = sanitiseString('onload="evilFn()"');
      expect(result).toBe('');
    });

    it('strips event handler regardless of case (ONCLICK=)', () => {
      const result = sanitiseString('ONCLICK="bad()"');
      expect(result).toBe('');
    });

    it('strips event handlers but keeps surrounding safe text', () => {
      const result = sanitiseString('hello onerror=alert(1) world');
      expect(result.trim()).toBe('hello  world');
    });

    it('strips multiple event handlers from the same string', () => {
      const result = sanitiseString('onclick="a()" onfocus="b()"');
      expect(result.trim()).toBe('');
    });
  });

  describe('combined HTML + event handler payloads', () => {
    it('strips <script>alert("xss")</script> leaving empty string', () => {
      expect(sanitiseString('<script>alert("xss")</script>')).toBe('alert("xss")');
    });

    it('a value-with-tag + safe text returns only safe text', () => {
      expect(sanitiseString('Safe text <b>bold</b>')).toBe('Safe text bold');
    });
  });
});

// ---------------------------------------------------------------------------
// sanitiseObject — unit tests
// ---------------------------------------------------------------------------

describe('sanitiseObject', () => {
  it('sanitises top-level string values in-place', () => {
    const obj: Record<string, unknown> = { name: "<script>evil()</script>" };
    sanitiseObject(obj);
    expect(obj.name).toBe('evil()');
  });

  it('sanitises nested object string values in-place', () => {
    const obj: Record<string, unknown> = {
      user: { bio: 'Hello <img src="x" onerror="alert(1)">' },
    };
    sanitiseObject(obj);
    expect((obj.user as Record<string, unknown>).bio).toBe('Hello ');
  });

  it('leaves number values unchanged', () => {
    const obj: Record<string, unknown> = { amount: 1000 };
    sanitiseObject(obj);
    expect(obj.amount).toBe(1000);
  });

  it('leaves boolean values unchanged', () => {
    const obj: Record<string, unknown> = { active: true };
    sanitiseObject(obj);
    expect(obj.active).toBe(true);
  });

  it('leaves null values unchanged', () => {
    const obj: Record<string, unknown> = { ref: null };
    sanitiseObject(obj);
    expect(obj.ref).toBeNull();
  });

  it('sanitises array elements that are strings', () => {
    const obj: Record<string, unknown> = { tags: ['<b>tag1</b>', 'safe'] };
    sanitiseObject(obj);
    expect(obj.tags).toEqual(['tag1', 'safe']);
  });

  it('sanitises deeply nested objects', () => {
    const obj: Record<string, unknown> = {
      level1: { level2: { level3: { val: 'onerror=bad()' } } },
    };
    sanitiseObject(obj);
    const l3 = ((obj.level1 as Record<string, unknown>).level2 as Record<string, unknown>)
      .level3 as Record<string, unknown>;
    expect(l3.val).toBe('');
  });
});

// ---------------------------------------------------------------------------
// sanitise middleware — unit tests
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  return {} as Response;
}

describe('sanitise middleware', () => {
  it('calls next() after sanitisation', () => {
    const next = jest.fn() as NextFunction;
    const req = makeReq({ body: { name: 'Alice' } });
    sanitise(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sanitises req.body string fields in-place', () => {
    const next = jest.fn() as NextFunction;
    const req = makeReq({ body: { comment: "<script>alert('xss')</script>" } });
    sanitise(req, makeRes(), next);
    expect(req.body.comment).toBe("alert('xss')");
  });

  it('sanitises req.query string fields in-place', () => {
    const next = jest.fn() as NextFunction;
    const req = makeReq({ query: { search: 'onerror=alert(1)' } });
    sanitise(req, makeRes(), next);
    expect(req.query.search).toBe('');
  });

  it('sanitises req.params string fields in-place', () => {
    const next = jest.fn() as NextFunction;
    const req = makeReq({ params: { id: '<b>1</b>' } });
    sanitise(req, makeRes(), next);
    expect(req.params.id).toBe('1');
  });

  it('leaves non-string body values unchanged', () => {
    const next = jest.fn() as NextFunction;
    const req = makeReq({ body: { amount: 500, active: false, ref: null } });
    sanitise(req, makeRes(), next);
    expect(req.body.amount).toBe(500);
    expect(req.body.active).toBe(false);
    expect(req.body.ref).toBeNull();
  });

  it('sanitises nested body objects', () => {
    const next = jest.fn() as NextFunction;
    const req = makeReq({
      body: { user: { bio: '<img src="x" onerror="evil()">' } },
    });
    sanitise(req, makeRes(), next);
    expect(req.body.user.bio).toBe('');
  });

  it('handles null body gracefully', () => {
    const next = jest.fn() as NextFunction;
    const req = makeReq({ body: null });
    expect(() => sanitise(req, makeRes(), next)).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('handles undefined body gracefully', () => {
    const next = jest.fn() as NextFunction;
    const req = makeReq({ body: undefined });
    expect(() => sanitise(req, makeRes(), next)).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
