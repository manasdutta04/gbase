export class GBaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GBaseError';
  }
}

export class RateLimitError extends GBaseError {
  public retryAfter: number;

  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class ConflictError extends GBaseError {
  public filePath: string;

  constructor(message: string, filePath: string) {
    super(message);
    this.name = 'ConflictError';
    this.filePath = filePath;
  }
}

export class NotFoundError extends GBaseError {
  public resource: string;

  constructor(message: string, resource: string) {
    super(message);
    this.name = 'NotFoundError';
    this.resource = resource;
  }
}

export class ValidationError extends GBaseError {
  public errors: { field: string; message: string }[];

  constructor(message: string, errors: { field: string; message: string }[]) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export class AuthenticationError extends GBaseError {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}
