/**
 * Error handling utilities
 */

import {ActionError, ErrorCode} from '../types'
import {ERROR_MESSAGES} from '../constants'

/**
 * Create a standardized ActionError
 */
export function createActionError(
  message: string,
  code: ErrorCode,
  details?: Record<string, unknown>,
  retryable = false,
  originalError?: Error
): ActionError {
  const error = new Error(message) as ActionError
  error.code = code
  error.details = details
  error.retryable = retryable
  error.originalError = originalError
  error.name = 'ActionError'

  return error
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: Error | ActionError): boolean {
  if ('retryable' in error) {
    return error.retryable
  }

  // Network errors are generally retryable
  if (
    error.message.includes('ECONNRESET') ||
    error.message.includes('ETIMEDOUT') ||
    error.message.includes('ENOTFOUND')
  ) {
    return true
  }

  return false
}

/**
 * Get error message by code
 */
export function getErrorMessage(code: ErrorCode): string {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN_ERROR
}

/**
 * Format error for logging
 */
export function formatError(error: Error | ActionError): string {
  if ('code' in error) {
    return `[${error.code}] ${error.message}`
  }
  return error.message
}

/**
 * Extract error details for debugging
 */
export function extractErrorDetails(
  error: Error | ActionError
): Record<string, unknown> {
  const details: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack
  }

  if ('code' in error) {
    details['code'] = (error as any)['code']
    details['retryable'] = (error as any)['retryable']
    details['details'] = (error as any)['details']
  }

  if ('originalError' in error && (error as any)['originalError']) {
    details['originalError'] = extractErrorDetails(
      (error as any)['originalError']
    )
  }

  return details
}
