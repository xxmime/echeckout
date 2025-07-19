/**
 * Logging utilities
 */

import * as core from '@actions/core'
// import {LogLevel} from '../types' // Removed unused import

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
        formatted += ` ${JSON.stringify(data, null, 2)}`
      } else {
        formatted += ` ${String(data)}`
      }
    }
    
    return formatted
  }
}

// Default logger instance
export const logger = new Logger()