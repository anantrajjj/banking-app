/**
 * JSON schema validation middleware using AJV 8.
 *
 * Usage:
 *   router.post('/endpoint', validate(mySchema), handler);
 *
 * Behaviour:
 *   - On success:            calls next() unchanged.
 *   - On validation failure: returns HTTP 400 with per-field error details.
 *   - On internal exception: returns HTTP 400 (pass/fail cannot be determined).
 *
 * Error response shape:
 *   {
 *     "code":    "VALIDATION_ERROR",
 *     "message": "Request body validation failed",
 *     "details": [
 *       { "field": "/fieldName", "message": "must be string" },
 *       ...
 *     ]
 *   }
 *
 * Requirements: 12.2
 */

import Ajv, { type JSONSchemaType, type ValidateFunction, type ErrorObject } from 'ajv';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

// ---------------------------------------------------------------------------
// Shared AJV instance
// ---------------------------------------------------------------------------

/**
 * Single AJV instance reused across all compiled validators.
 *
 * - `allErrors: true`   — collect every violation, not just the first one.
 * - `coerceTypes: false` — never silently mutate input values.
 * - `useDefaults: false` — do not inject schema defaults into the request body.
 */
const ajv = new Ajv({ allErrors: true, coerceTypes: false, useDefaults: false });

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Shape of a single field-level validation error returned to callers. */
export interface ValidationErrorDetail {
  field: string;
  message: string;
}

/** Standard 400 response body emitted on any validation failure. */
export interface ValidationErrorResponse {
  code: 'VALIDATION_ERROR';
  message: string;
  details: ValidationErrorDetail[];
}

/**
 * Converts AJV `ErrorObject` array into the public `ValidationErrorDetail` array.
 * Defaults the `field` to `"/"` for errors that lack an `instancePath`.
 */
function formatErrors(errors: ErrorObject[]): ValidationErrorDetail[] {
  return errors.map((err) => ({
    field: err.instancePath !== '' ? err.instancePath : `/${err.params?.missingProperty ?? ''}`,
    message: err.message ?? 'invalid value',
  }));
}

/**
 * Builds and sends the standard HTTP 400 validation-error response.
 */
function sendValidationError(res: Response, details: ValidationErrorDetail[]): void {
  const body: ValidationErrorResponse = {
    code: 'VALIDATION_ERROR',
    message: 'Request body validation failed',
    details,
  };
  res.status(400).json(body);
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates an Express middleware that validates `req.body` against the supplied
 * JSON schema.
 *
 * The schema is compiled once when `validate()` is called (at route registration
 * time) and the resulting `ValidateFunction` is reused for every request,
 * keeping per-request overhead minimal.
 *
 * @param schema  A plain JSON Schema object (draft-07 compatible).
 * @returns       Express `RequestHandler` middleware.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validate(schema: JSONSchemaType<any> | Record<string, unknown>): RequestHandler {
  // Compile at registration time so startup surfaxces schema errors early.
  let compiledValidator: ValidateFunction;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compiledValidator = ajv.compile(schema as JSONSchemaType<any>);
  } catch (compileError) {
    // Schema itself is invalid — always return 400 for every request.
    return (_req: Request, res: Response, _next: NextFunction): void => {
      sendValidationError(res, [
        { field: '/', message: 'Schema compilation error; validation cannot be performed' },
      ]);
    };
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    let isValid: boolean;

    try {
      isValid = compiledValidator(req.body) as boolean;
    } catch (runtimeError) {
      // AJV threw unexpectedly — pass/fail cannot be determined (Req 12.2).
      sendValidationError(res, [
        { field: '/', message: 'Validation could not be completed due to an internal error' },
      ]);
      return;
    }

    if (!isValid) {
      const errors = compiledValidator.errors ?? [];
      sendValidationError(res, formatErrors(errors));
      return;
    }

    next();
  };
}
