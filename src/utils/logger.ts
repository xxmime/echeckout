/**
 * Logging utilities
 */

import * as core from '@actions/core'
//

/**
 * Public helper to sanitize a URL string by:
 * - removing username/password from authority
 * - redacting sensitive query parameters (e.g. sig, token, access_token, X-Amz-*, X-Goog-*)
 */
export function sanitizeUrl(urlString: string): string {
  try {
    const url = new URL(urlString)

    // Strip credentials in authority
    url.username = ''
    url.password = ''

    // Redact sensitive query parameters (case-insensitive match)
    const sensitiveParams = new Set([
      'sig',
      'signature',
      'token',
      'access_token',
      'auth',
      'authorization',
      'apikey',
      'api_key',
      'key',
      'x-amz-signature',
      'x-amz-credential',
      'x-amz-security-token',
      'x-amz-signedheaders',
      'x-goog-signature',
      'x-goog-credential',
      'x-goog-algorithm',
      'x-goog-date',
      'x-goog-expires',
      'client_secret',
      'password',
      'sas',
      'sastoken'
    ])

    const params = url.searchParams
    // Collect keys first to avoid live-iteration pitfalls
    const keys: string[] = []
    params.forEach((_, k) => keys.push(k))
    for (const key of keys) {
      const lower = key.toLowerCase()
      if (
        sensitiveParams.has(lower) ||
        lower.endsWith('token') ||
        lower.endsWith('signature')
      ) {
        params.set(key, '***')
      }
    }

    return url.toString()
  } catch {
    // If it's not a valid absolute URL, best effort mask any user:pass@ pattern
    return urlString.replace(
      /(https?:\/\/)([^:@\s]+):([^@\s]+)@/gi,
      '$1***:***@'
    )
  }
}

export class Logger {
  private verbose: boolean
  private prefix: string

  constructor(verbose = false, prefix = '[AcceleratedCheckout]') {
    this.verbose = verbose
    this.prefix = prefix
  }

  debug(message: string, data?: unknown): void {
    if (this.verbose) {
      const formattedMessage = this.formatMessage(message, data)
      core.debug(formattedMessage)
    }
  }

  info(message: string, data?: unknown): void {
    const formattedMessage = this.formatMessage(message, data)
    core.info(formattedMessage)
  }

  warn(message: string, data?: unknown): void {
    const formattedMessage = this.formatMessage(message, data)
    core.warning(formattedMessage)
  }

  error(message: string, data?: unknown): void {
    const formattedMessage = this.formatMessage(message, data)
    core.error(formattedMessage)
  }

  group(name: string): void {
    core.startGroup(`${this.prefix} ${name}`)
  }

  endGroup(): void {
    core.endGroup()
  }

  private formatMessage(message: string, data?: unknown): string {
    let formatted = `${this.prefix} ${message}`

    if (data !== undefined) {
      if (typeof data === 'object') {
        const sanitizedData = this.sanitizeData(data)
        formatted += ` ${JSON.stringify(sanitizedData, null, 2)}`
      } else {
        const sanitizedString = this.sanitizeString(String(data))
        formatted += ` ${sanitizedString}`
      }
    }

    return formatted
  }

  /**
   * Sanitize data to remove sensitive information
   */
  private sanitizeData(data: unknown): unknown {
    if (data === null || data === undefined) {
      return data
    }

    if (typeof data === 'string') {
      return this.sanitizeString(data)
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeData(item))
    }

    if (typeof data === 'object') {
      const sanitized: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(data)) {
        // Sanitize sensitive keys
        if (this.isSensitiveKey(key)) {
          sanitized[key] = this.maskSensitiveValue(String(value))
        } else {
          sanitized[key] = this.sanitizeData(value)
        }
      }
      return sanitized
    }

    return data
  }

  /**
   * Sanitize string to remove URLs with credentials
   */
  private sanitizeString(str: string): string {
    // 1) Redact basic user:pass@ patterns fast
    let sanitized = str.replace(
      /(https?:\/\/)([^:@\s]+):([^@\s]+)@/gi,
      '$1***:***@'
    )

    // 2) Redact sensitive query parameters in all http(s) URLs
    //    This regex picks up most URL tokens in logs without being overly greedy
    sanitized = sanitized.replace(/https?:\/\/[^\s"'()<>]+/g, m =>
      sanitizeUrl(m)
    )

    return sanitized
  }

  /**
   * Check if a key contains sensitive information
   */
  private isSensitiveKey(key: string): boolean {
    const sensitiveKeys = [
      'token',
      'password',
      'secret',
      'key',
      'auth',
      'credential',
      'authorization',
      'bearer',
      'api_key',
      'apikey',
      'access_token',
      'refresh_token',
      'private_key',
      'passphrase'
    ]

    const lowerKey = key.toLowerCase()
    return sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))
  }

  /**
   * Mask sensitive values
   */
  private maskSensitiveValue(value: string): string {
    if (!value || value.length === 0) {
      return value
    }

    if (value.length <= 4) {
      return '*'.repeat(value.length)
    }

    // Show first 2 and last 2 characters, mask the middle
    return `${value.substring(0, 2)}${'*'.repeat(value.length - 4)}${value.substring(value.length - 2)}`
  }
}

// Default logger instance
export const logger = new Logger()
