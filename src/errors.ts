// Errors a caller can act on, each with an HTTP status and a code a client can test for. Anything
// else is a 500 with no detail (see app.ts).

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `No ${what} with that id.`);

/** The request is well formed but breaks a booking rule: the message says which. */
export const ruleBroken = (code: string, message: string) => new ApiError(422, code, message);

/** The request clashes with what is already there. */
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
