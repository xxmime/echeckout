/**
 * Fallback and retry handling
 */

import {
  DownloadResult,
  DownloadMethod,
  CheckoutOptions,
  MirrorService,
  ErrorCode
} from '../types'
import {DEFAULT_CONFIG} from '../constants'
import {isRetryableError, createActionError} from '../utils/error-utils'
import {logger} from '../utils/logger'
import {DownloadExecutor} from '../download/download-executor'
import {ProxyManager} from '../proxy/proxy-manager'

export class FallbackHandler {
  private options: CheckoutOptions
  private proxyManager: ProxyManager
  private maxRetries: number

  constructor(options: CheckoutOptions, proxyManager: ProxyManager, maxRetries: number = DEFAULT_CONFIG.MAX_RETRY_ATTEMPTS) {
    this.options = options
    this.proxyManager = proxyManager
    this.maxRetries = maxRetries
  }

  /**
   * Execute download with fallback strategy
   */
  async executeWithFallback(
    primaryMethod: DownloadMethod,
    enableFallback = true
  ): Promise<DownloadResult> {
    logger.group('Executing download with fallback strategy')

    try {
      // Try primary method first
      const result = await this.tryDownloadMethod(primaryMethod)
      if (result.success) {
        return result
      }

      if (!enableFallback) {
        logger.warn('Fallback is disabled, returning failed result')
        return result
      }

      // Try fallback methods
      const fallbackMethods = this.getFallbackMethods(primaryMethod)
      
      for (const method of fallbackMethods) {
        logger.info(`Trying fallback method: ${method}`)
        
        const fallbackResult = await this.tryDownloadMethod(method)
        if (fallbackResult.success) {
          fallbackResult.fallbackUsed = true
          return fallbackResult
        }
      }

      // All methods failed
      return {
        success: false,
        method: primaryMethod,
        mirrorUsed: undefined,
        downloadTime: 0,
        downloadSpeed: 0,
        downloadSize: 0,
        commit: undefined,
        ref: undefined,
        errorMessage: 'All download methods failed',
        errorCode: ErrorCode.DOWNLOAD_FAILED,
        retryCount: this.maxRetries,
        fallbackUsed: true
      }
    } finally {
      logger.endGroup()
    }
  }

  /**
   * Try a specific download method with retries
   */
  private async tryDownloadMethod(method: DownloadMethod): Promise<DownloadResult> {
    const executor = new DownloadExecutor(this.options)
    let lastError: Error | null = null
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug(`Attempt ${attempt + 1}/${this.maxRetries + 1} for method ${method}`)

        let mirrorService: MirrorService | null = null
        
        if (method === DownloadMethod.MIRROR) {
          mirrorService = await this.proxyManager.getBestMirror(method)
          if (!mirrorService) {
            throw createActionError(
              'No available mirror services',
              ErrorCode.NO_MIRRORS_AVAILABLE
            )
          }
        }

        const result = await executor.executeDownload(method, mirrorService || undefined)
        
        if (result.success) {
          result.retryCount = attempt
          return result
        }

        lastError = new Error(result.errorMessage || 'Download failed')
        
        // Check if we should retry
        if (attempt < this.maxRetries && this.shouldRetry(result, attempt)) {
          const delay = this.calculateRetryDelay(attempt)
          logger.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
            error: result.errorMessage,
            method
          })
          await this.sleep(delay)
          continue
        }

        // Return the failed result
        result.retryCount = attempt
        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error')
        
        if (attempt < this.maxRetries && isRetryableError(lastError)) {
          const delay = this.calculateRetryDelay(attempt)
          logger.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
            error: lastError.message,
            method
          })
          await this.sleep(delay)
          continue
        }

        // Return failed result
        return {
          success: false,
          method,
          mirrorUsed: undefined,
          downloadTime: 0,
          downloadSpeed: 0,
          downloadSize: 0,
          commit: undefined,
          ref: undefined,
          errorMessage: lastError.message,
          errorCode: 'code' in lastError ? lastError.code as ErrorCode : ErrorCode.DOWNLOAD_FAILED,
          retryCount: attempt,
          fallbackUsed: false
        }
      }
    }

    // This should never be reached, but just in case
    return {
      success: false,
      method,
      mirrorUsed: undefined,
      downloadTime: 0,
      downloadSpeed: 0,
      downloadSize: 0,
      commit: undefined,
      ref: undefined,
      errorMessage: lastError?.message || 'Maximum retries exceeded',
      errorCode: ErrorCode.DOWNLOAD_FAILED,
      retryCount: this.maxRetries,
      fallbackUsed: false
    }
  }

  /**
   * Get fallback methods for a given primary method
   */
  private getFallbackMethods(primaryMethod: DownloadMethod): DownloadMethod[] {
    switch (primaryMethod) {
      case DownloadMethod.AUTO:
      case DownloadMethod.MIRROR:
        return [DownloadMethod.DIRECT, DownloadMethod.GIT]
      
      case DownloadMethod.DIRECT:
        return [DownloadMethod.MIRROR, DownloadMethod.GIT]
      
      case DownloadMethod.GIT:
        return [DownloadMethod.DIRECT, DownloadMethod.MIRROR]
      
      default:
        return []
    }
  }

  /**
   * Determine if we should retry based on the result
   */
  private shouldRetry(result: DownloadResult, attempt: number): boolean {
    // Don't retry if we've reached max attempts
    if (attempt >= this.maxRetries) {
      return false
    }

    // Don't retry certain error codes
    const nonRetryableErrors = [
      ErrorCode.INVALID_REPOSITORY,
      ErrorCode.INVALID_REF,
      ErrorCode.INVALID_TOKEN,
      ErrorCode.REPOSITORY_NOT_FOUND,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.PERMISSION_DENIED
    ]

    if (result.errorCode && nonRetryableErrors.includes(result.errorCode)) {
      return false
    }

    // Retry on network-related errors
    const retryableErrors = [
      ErrorCode.NETWORK_ERROR,
      ErrorCode.TIMEOUT_ERROR,
      ErrorCode.CONNECTION_ERROR,
      ErrorCode.MIRROR_TIMEOUT,
      ErrorCode.MIRROR_ERROR
    ]

    return result.errorCode ? retryableErrors.includes(result.errorCode) : true
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = DEFAULT_CONFIG.RETRY_DELAY_BASE
    const maxDelay = DEFAULT_CONFIG.RETRY_DELAY_MAX
    
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
    
    // Add some jitter to avoid thundering herd
    const jitter = Math.random() * 0.1 * delay
    
    return Math.floor(delay + jitter)
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}