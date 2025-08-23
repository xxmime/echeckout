/**
 * Main entry point for Accelerated GitHub Checkout Action
 */

import * as core from '@actions/core'
import {parseInputs, getEnvironmentConfig} from './input/input-parser'
import {FallbackHandler} from './fallback/fallback-handler'
import {OutputHandler} from './output/output-handler'
import {Logger} from './utils/logger'
import {formatError} from './utils/error-utils'
import {DownloadMethod, CheckoutOptions, DownloadResult, ErrorCode} from './types'

/**
 * Main action execution function
 */
async function run(): Promise<void> {
  let logger: Logger | undefined
  let result: DownloadResult | null = null
  const startTime = Date.now()

  try {
    // Parse and validate inputs
    const inputs = parseInputs()
    
    // Initialize logger with verbose setting
    logger = new Logger(inputs.verbose)
    logger.group('Accelerated GitHub Checkout Action')
    logger.info('Starting accelerated checkout process')
    
    // Log target repository information
    logger.group('Target Repository Information')
    logger.info('Repository details', {
      repository: inputs.repository,
      ref: inputs.ref || 'default branch',
      path: inputs.path,
      fetchDepth: inputs.fetchDepth
    })
    
    if (inputs.enableAcceleration) {
      logger.info('Acceleration enabled - will attempt to use proxy services for faster downloads')
      logger.info('Download strategy', {
        method: inputs.downloadMethod,
        fallbackEnabled: inputs.fallbackEnabled
      })
    } else {
      logger.info('Acceleration disabled - will use direct GitHub download')
    }
    logger.endGroup()
    
    // Log environment information
    const envConfig = getEnvironmentConfig()
    logger.debug('Parsed inputs', inputs)

    // No proxy manager; proxy is provided directly via inputs

    // Prepare checkout options
    const checkoutOptions: CheckoutOptions = {
      repository: inputs.repository,
      ref: inputs.ref,
      token: inputs.token,
      path: inputs.path,
      fetchDepth: inputs.fetchDepth,
      clean: inputs.clean,
      timeout: inputs.mirrorTimeout,
      retryAttempts: inputs.retryAttempts
    }

    // Initialize fallback handler with input options for proxy authentication
    const inputOptions = {
      mirrorUrl: inputs.mirrorUrl,
      githubProxyUrl: inputs.mirrorUrl // github-proxy-url is an alias for mirror-url
    }
    
    const fallbackHandler = new FallbackHandler(
      checkoutOptions,
      inputs.retryAttempts,
      inputOptions
    )

    // Determine download method
    let downloadMethod = inputs.downloadMethod
    
    if (downloadMethod === DownloadMethod.AUTO) {
      if (inputs.enableAcceleration && inputs.mirrorUrl) {
        downloadMethod = DownloadMethod.MIRROR
        logger.info('Auto-selected mirror download method')
      } else {
        downloadMethod = DownloadMethod.GIT
        logger.info('Auto-selected Git download method (no mirror configured)')
      }
    }

    logger.info('Starting download process', {
      repository: inputs.repository,
      ref: inputs.ref,
      method: downloadMethod,
      enableAcceleration: inputs.enableAcceleration,
      fallbackEnabled: inputs.fallbackEnabled
    })

    

    // Execute download with fallback
    
    // 添加下载执行前的详细日志
    logger.info('Starting download execution', {
      selectedMethod: downloadMethod,
      repository: inputs.repository,
      ref: inputs.ref || 'default',
      enableAcceleration: inputs.enableAcceleration,
      fallbackEnabled: inputs.fallbackEnabled,
      retryAttempts: inputs.retryAttempts,
      mirrorTimeout: inputs.mirrorTimeout
    })
    
    result = await fallbackHandler.executeWithFallback(
      downloadMethod,
      inputs.fallbackEnabled
    )

    // Calculate additional metrics
    const totalTime = (Date.now() - startTime) / 1000

    // Set outputs
    OutputHandler.setOutputs(result)

    // Set summary
    await OutputHandler.setSummary(result, {
      totalExecutionTime: `${totalTime.toFixed(2)}s`,
      availableMirrors: inputs.mirrorUrl ? 1 : 0,
      environment: envConfig
    })

    if (result.success) {
      logger.info('✅ Checkout completed successfully', {
        method: result.method,
        mirror: result.mirrorUsed,
        time: `${result.downloadTime.toFixed(2)}s`,
        speed: `${result.downloadSpeed.toFixed(2)} MB/s`,
        size: `${(result.downloadSize / (1024 * 1024)).toFixed(2)} MB`,
        fallbackUsed: result.fallbackUsed
      })
    } else {
      logger.error('❌ Checkout failed', {
        method: result.method,
        error: result.errorMessage,
        errorCode: result.errorCode,
        retryCount: result.retryCount,
        fallbackUsed: result.fallbackUsed
      })
      
      core.setFailed(result.errorMessage || 'Checkout operation failed')
    }

  } catch (error) {
    const errorMessage = formatError(error instanceof Error ? error : new Error('Unknown error'))
    
    // Initialize logger if not already done
    if (!logger) {
      logger = new Logger(false)
    }
    
    logger.error('❌ Action execution failed', error)

    // Set failed outputs
    if (!result) {
      result = {
        success: false,
        method: DownloadMethod.AUTO,
        downloadTime: (Date.now() - startTime) / 1000,
        downloadSpeed: 0,
        downloadSize: 0,
        errorMessage,
        errorCode: (error instanceof Error && 'code' in error ? (error as any).code : 'UNKNOWN_ERROR') as ErrorCode,
        retryCount: 0,
        fallbackUsed: false,
        mirrorUsed: undefined,
        commit: undefined,
        ref: undefined
      }
    }

    OutputHandler.setOutputs(result)
    await OutputHandler.setSummary(result, {
      totalExecutionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
      error: errorMessage
    })

    core.setFailed(errorMessage)
  }
}

/**
 * Cleanup function for post-action
 */
async function cleanup(): Promise<void> {
  try {
    const logger = new Logger()
    logger.info('Running post-action cleanup')
    
    // Add any cleanup logic here if needed
    // For example: clearing temporary files, caches, etc.
    
    logger.info('Cleanup completed successfully')
  } catch (error) {
    core.warning(`Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Execute the action
if (require.main === module) {
  run()
}

// Export functions for testing
export {run, cleanup}