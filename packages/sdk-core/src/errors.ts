/**
 * Error categories matching server-side categories
 */
export enum ErrorCategory {
  AUTH = "AUTH",
  VALIDATION = "VALIDATION",
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  RATE_LIMIT = "RATE_LIMIT",
  INTERNAL = "INTERNAL",
  NETWORK = "NETWORK",
}

/**
 * Error codes matching server-side codes
 */
export enum ErrorCode {
  // Authentication errors
  AUTH_UNAUTHORIZED = "AUTH_001",
  AUTH_INVALID_TOKEN = "AUTH_002",
  AUTH_TOKEN_EXPIRED = "AUTH_003",
  AUTH_INVALID_API_KEY = "AUTH_004",
  AUTH_API_KEY_EXPIRED = "AUTH_005",
  AUTH_INSUFFICIENT_PERMS = "AUTH_006",
  AUTH_SESSION_EXPIRED = "AUTH_007",

  // Validation errors
  VAL_INVALID_REQUEST = "VAL_001",
  VAL_MISSING_FIELD = "VAL_002",
  VAL_INVALID_FORMAT = "VAL_003",
  VAL_INVALID_VALUE = "VAL_004",

  // Not found errors
  NOT_FOUND_GENERIC = "NOT_FOUND_001",
  NOT_FOUND_FLAG = "NOT_FOUND_005",

  // Rate limit errors
  RATE_LIMITED = "RATE_001",
  RATE_TOO_MANY_REQUESTS = "RATE_002",

  // Internal errors
  INTERNAL_ERROR = "INTERNAL_001",
  INTERNAL_DATABASE = "INTERNAL_002",
  INTERNAL_CACHE = "INTERNAL_003",
  INTERNAL_SERVICE_UNAVAILABLE = "INTERNAL_004",

  // Network errors (client-side only)
  NETWORK_ERROR = "NETWORK_001",
  NETWORK_TIMEOUT = "NETWORK_002",
  NETWORK_ABORTED = "NETWORK_003",
}

/**
 * API error response from server
 */
export interface APIErrorResponse {
  error: {
    code: string;
    category: string;
    message: string;
    details?: string;
    field?: string;
    retryable: boolean;
  };
}

/**
 * Base class for Rollgate errors
 */
export class RollgateError extends Error {
  readonly code: ErrorCode | string;
  readonly category: ErrorCategory;
  readonly details?: string;
  readonly field?: string;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(
    message: string,
    code: ErrorCode | string,
    category: ErrorCategory,
    options?: {
      details?: string;
      field?: string;
      retryable?: boolean;
      statusCode?: number;
    },
  ) {
    super(message);
    this.name = "RollgateError";
    this.code = code;
    this.category = category;
    this.details = options?.details;
    this.field = options?.field;
    this.retryable = options?.retryable ?? false;
    this.statusCode = options?.statusCode;

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RollgateError);
    }
  }

  /**
   * Create from API error response
   */
  static fromResponse(
    response: APIErrorResponse,
    statusCode?: number,
  ): RollgateError {
    const { error } = response;
    const category =
      (error.category as ErrorCategory) || ErrorCategory.INTERNAL;

    // Default retryable based on status code if not explicitly set
    const retryable =
      error.retryable !== undefined
        ? error.retryable
        : statusCode !== undefined && statusCode >= 500;

    return new RollgateError(error.message, error.code, category, {
      details: error.details,
      field: error.field,
      retryable,
      statusCode,
    });
  }

  /**
   * Create from HTTP response
   */
  static async fromHTTPResponse(response: Response): Promise<RollgateError> {
    try {
      const data = (await response.json()) as APIErrorResponse;
      if (data.error) {
        return RollgateError.fromResponse(data, response.status);
      }
    } catch {
      // Failed to parse JSON
    }

    // Fallback for non-JSON responses
    return new RollgateError(
      response.statusText || `HTTP ${response.status}`,
      ErrorCode.INTERNAL_ERROR,
      ErrorCategory.INTERNAL,
      { statusCode: response.status, retryable: response.status >= 500 },
    );
  }

  /**
   * Convert to JSON
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      details: this.details,
      field: this.field,
      retryable: this.retryable,
      statusCode: this.statusCode,
    };
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends RollgateError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.AUTH_UNAUTHORIZED,
    options?: { details?: string; statusCode?: number },
  ) {
    super(message, code, ErrorCategory.AUTH, {
      ...options,
      retryable: false,
    });
    this.name = "AuthenticationError";
  }
}

/**
 * Validation error
 */
export class ValidationError extends RollgateError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.VAL_INVALID_REQUEST,
    options?: { details?: string; field?: string; statusCode?: number },
  ) {
    super(message, code, ErrorCategory.VALIDATION, {
      ...options,
      retryable: false,
    });
    this.name = "ValidationError";
  }
}

/**
 * Not found error
 */
export class NotFoundError extends RollgateError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.NOT_FOUND_GENERIC,
    options?: { details?: string; statusCode?: number },
  ) {
    super(message, code, ErrorCategory.NOT_FOUND, {
      ...options,
      retryable: false,
      statusCode: options?.statusCode ?? 404,
    });
    this.name = "NotFoundError";
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends RollgateError {
  readonly retryAfter?: number;

  constructor(
    message: string,
    options?: { retryAfter?: number; details?: string; statusCode?: number },
  ) {
    super(message, ErrorCode.RATE_LIMITED, ErrorCategory.RATE_LIMIT, {
      ...options,
      retryable: true,
      statusCode: options?.statusCode ?? 429,
    });
    this.name = "RateLimitError";
    this.retryAfter = options?.retryAfter;
  }
}

/**
 * Network error (client-side)
 */
export class NetworkError extends RollgateError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.NETWORK_ERROR,
    options?: { details?: string },
  ) {
    super(message, code, ErrorCategory.NETWORK, {
      ...options,
      retryable: true,
    });
    this.name = "NetworkError";
  }

  static timeout(message: string = "Request timed out"): NetworkError {
    return new NetworkError(message, ErrorCode.NETWORK_TIMEOUT);
  }

  static aborted(message: string = "Request was aborted"): NetworkError {
    return new NetworkError(message, ErrorCode.NETWORK_ABORTED);
  }
}

/**
 * Internal server error
 */
export class InternalError extends RollgateError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    options?: { details?: string; statusCode?: number },
  ) {
    super(message, code, ErrorCategory.INTERNAL, {
      ...options,
      retryable: true,
      statusCode: options?.statusCode ?? 500,
    });
    this.name = "InternalError";
  }
}

// --- Helper functions ---

/**
 * Check if an error is retryable
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof RollgateError) {
    return error.retryable;
  }

  // Network errors are generally retryable
  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    if (
      name.includes("network") ||
      name.includes("timeout") ||
      name.includes("abort")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if error is an authentication error
 */
export function isAuthError(error: unknown): error is AuthenticationError {
  return (
    error instanceof RollgateError && error.category === ErrorCategory.AUTH
  );
}

/**
 * Check if error is a validation error
 */
export function isValidationError(error: unknown): error is ValidationError {
  return (
    error instanceof RollgateError &&
    error.category === ErrorCategory.VALIDATION
  );
}

/**
 * Check if error is a not found error
 */
export function isNotFoundError(error: unknown): error is NotFoundError {
  return (
    error instanceof RollgateError && error.category === ErrorCategory.NOT_FOUND
  );
}

/**
 * Check if error is a rate limit error
 */
export function isRateLimitError(error: unknown): error is RateLimitError {
  return (
    error instanceof RollgateError &&
    error.category === ErrorCategory.RATE_LIMIT
  );
}

/**
 * Check if error is a network error
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return (
    error instanceof RollgateError && error.category === ErrorCategory.NETWORK
  );
}

/**
 * Check if error is an internal server error
 */
export function isInternalError(error: unknown): error is InternalError {
  return (
    error instanceof RollgateError && error.category === ErrorCategory.INTERNAL
  );
}

/**
 * Classify a raw error into a RollgateError
 */
export function classifyError(error: unknown): RollgateError {
  // Already a RollgateError
  if (error instanceof RollgateError) {
    return error;
  }

  // AbortError (timeout)
  if (error instanceof Error && error.name === "AbortError") {
    return NetworkError.timeout();
  }

  // TypeError (network failure in fetch)
  if (error instanceof TypeError) {
    return new NetworkError(error.message, ErrorCode.NETWORK_ERROR, {
      details: "Network request failed",
    });
  }

  // Generic Error
  if (error instanceof Error) {
    return new InternalError(error.message, ErrorCode.INTERNAL_ERROR, {
      details: error.stack,
    });
  }

  // Unknown error
  return new InternalError(String(error), ErrorCode.INTERNAL_ERROR);
}
