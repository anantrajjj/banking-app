/**
 * Unit tests for the AJV-based JSON schema validation middleware.
 *
 * Requirements: 12.2
 */

import type { Request, Response, NextFunction } from 'express';
import { validate, type ValidationErrorResponse } from './validate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(body: unknown = {}): Request {
  return { body } as unknown as Request;
}

interface MockResponse {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (body: unknown) => MockResponse;
}

function makeRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

// A simple schema used across multiple tests
const personSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'integer' },
  },
  required: ['name', 'age'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Happy-path: valid body passes through
// ---------------------------------------------------------------------------

describe('validate middleware — valid body', () => {
  it('calls next() when the request body matches the schema', () => {
    const middleware = validate(personSchema);
    const req = makeReq({ name: 'Alice', age: 30 });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200); // response untouched
  });

  it('does not call next() when validation fails', () => {
    const middleware = validate(personSchema);
    const req = makeReq({ name: 'Alice' }); // missing required "age"
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Missing required field → HTTP 400 with per-field error
// ---------------------------------------------------------------------------

describe('validate middleware — missing required field', () => {
  it('returns HTTP 400 when a required field is absent', () => {
    const middleware = validate(personSchema);
    const req = makeReq({ name: 'Bob' }); // "age" is missing
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(400);
  });

  it('responds with VALIDATION_ERROR code and message', () => {
    const middleware = validate(personSchema);
    const req = makeReq({ name: 'Bob' });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    const body = res.body as ValidationErrorResponse;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
  });

  it('includes a details array with at least one entry referencing the missing field', () => {
    const middleware = validate(personSchema);
    const req = makeReq({ name: 'Bob' }); // missing "age"
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    const body = res.body as ValidationErrorResponse;
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);

    // At least one detail should reference the missing "age" field
    const mentionsAge = body.details.some(
      (d) => d.field.includes('age') || d.message.toLowerCase().includes('age'),
    );
    expect(mentionsAge).toBe(true);
  });

  it('reports all missing required fields when multiple are absent', () => {
    const middleware = validate(personSchema);
    const req = makeReq({}); // both "name" and "age" are missing
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    const body = res.body as ValidationErrorResponse;
    expect(body.details.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Wrong type → HTTP 400
// ---------------------------------------------------------------------------

describe('validate middleware — wrong type', () => {
  it('returns HTTP 400 when a field has the wrong type', () => {
    const middleware = validate(personSchema);
    const req = makeReq({ name: 'Carol', age: 'not-a-number' }); // age should be integer
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('details array references the type-mismatched field', () => {
    const middleware = validate(personSchema);
    const req = makeReq({ name: 123, age: 25 }); // name should be string, not integer
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    const body = res.body as ValidationErrorResponse;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.length).toBeGreaterThan(0);

    const mentionsName = body.details.some(
      (d) => d.field.includes('name') || d.message.toLowerCase().includes('name'),
    );
    expect(mentionsName).toBe(true);
  });

  it('returns HTTP 400 when body is not an object but schema requires one', () => {
    const middleware = validate(personSchema);
    const req = makeReq('this is a string, not an object');
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns HTTP 400 when body is null', () => {
    const middleware = validate(personSchema);
    const req = makeReq(null);
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Additional-properties: schema with additionalProperties: false
// ---------------------------------------------------------------------------

describe('validate middleware — additional properties', () => {
  it('returns HTTP 400 when body contains a field not allowed by the schema', () => {
    const middleware = validate(personSchema); // additionalProperties: false
    const req = makeReq({ name: 'Dave', age: 40, extra: 'forbidden' });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AJV runtime exception → HTTP 400 (try/catch path)
// ---------------------------------------------------------------------------

describe('validate middleware — internal exception handling', () => {
  it('returns HTTP 400 when AJV throws during validation', () => {
    // We compile a schema with a keyword that will validate fine, then replace
    // the compiled validator's callable internals with a throwing function by
    // wrapping at the middleware level using a deliberately broken schema proxy.
    //
    // The simplest, dependency-free approach: pass a schema that compiles fine
    // but monkey-patch the validate function so the compiled validator throws.
    // We achieve this by importing the module internals indirectly via a wrapper.
    //
    // Strategy: create a middleware whose compiledValidator will throw on call,
    // by wrapping the req.body getter to throw after compilation succeeds.

    const middleware = validate(personSchema);

    // Create a req whose body getter throws when AJV accesses it
    const throwingBody = new Proxy(
      {},
      {
        get(_target, prop) {
          // AJV reads constructor and other meta properties before validating;
          // throw only on actual property reads that look like data access
          if (prop === 'constructor') return Object;
          if (prop === Symbol.toPrimitive) return undefined;
          throw new Error('Simulated AJV runtime error');
        },
      },
    );

    const req = { body: throwingBody } as unknown as Request;
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
    const body = res.body as ValidationErrorResponse;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('returns HTTP 400 with VALIDATION_ERROR code when schema compilation fails', () => {
    // Pass a schema that AJV cannot compile (invalid keyword value)
    const badSchema = {
      type: 'object',
      properties: {
        val: { type: 'not-a-valid-type' }, // AJV will reject this
      },
    };

    const middleware = validate(badSchema as Record<string, unknown>);
    const req = makeReq({ val: 'test' });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
    const body = res.body as ValidationErrorResponse;
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('validate middleware — edge cases', () => {
  it('accepts an empty object body when schema has no required fields', () => {
    const optionalSchema = {
      type: 'object',
      properties: {
        note: { type: 'string' },
      },
    };

    const middleware = validate(optionalSchema);
    const req = makeReq({});
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('validates nested objects correctly', () => {
    const nestedSchema = {
      type: 'object',
      properties: {
        address: {
          type: 'object',
          properties: {
            city: { type: 'string' },
          },
          required: ['city'],
        },
      },
      required: ['address'],
    };

    const middleware = validate(nestedSchema);

    // Valid case
    const validReq = makeReq({ address: { city: 'Mumbai' } });
    const validRes = makeRes();
    const nextValid = jest.fn() as unknown as NextFunction;
    middleware(validReq, validRes as unknown as Response, nextValid);
    expect(nextValid).toHaveBeenCalledTimes(1);

    // Invalid case — city is wrong type
    const invalidReq = makeReq({ address: { city: 42 } });
    const invalidRes = makeRes();
    const nextInvalid = jest.fn() as unknown as NextFunction;
    middleware(invalidReq, invalidRes as unknown as Response, nextInvalid);
    expect(invalidRes.statusCode).toBe(400);
    expect(nextInvalid).not.toHaveBeenCalled();
  });
});
