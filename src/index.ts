/**
 * Main entry point for Accelerated GitHub Checkout Action
 */

import * as core from '@actions/core'
import {parseInputs, getEnvironmentConfig} from './input/input-parser'
import {ProxyManager} from './proxy/proxy-manager'
import {FallbackHandler} from './fallback/fallback-handler'
import {OutputHandler} from './output/output-handler'
import {Logger} from './utils/logger'
import {formatError} from './utils/error-utils'
import {NetworkAnalyzer} from './utils/network-analyzer'
import {DownloadMethod, CheckoutOptions, DownloadResult, ErrorCode, NetworkInfo} from './types'

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
        autoSelectMirror: inputs.autoSelectMirror,
        fallbackEnabled: inputs.fallbackEnabled,
        speedTestEnabled: inputs.speedTest
      })
    } else {
      logger.info('Acceleration disabled - will use direct GitHub download')
    }
    logger.endGroup()
    
    // Log environment information
    const envConfig = getEnvironmentConfig()
    logger.debug('Environment configuration', envConfig)
    logger.debug('Parsed inputs', inputs)

    // Initialize components
    const proxyManager = new ProxyManager()
    
    // Add custom mirror if specified
    if (inputs.mirrorUrl) {
      logger.info('Adding custom mirror service', {
        url: inputs.mirrorUrl,
        timeout: inputs.mirrorTimeout
      })
      proxyManager.addMirrorService({
        name: 'Custom Mirror',
        url: inputs.mirrorUrl,
        description: 'User-specified mirror service',
        priority: 0, // Highest priority
        enabled: true,
        timeout: inputs.mirrorTimeout,
        retryAttempts: inputs.retryAttempts,
        supportedMethods: [DownloadMethod.MIRROR],
        regions: ['*']
      })
    }

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
      proxyManager,
      inputs.retryAttempts,
      inputOptions
    )

    // Determine download method
    let downloadMethod = inputs.downloadMethod
    
    if (downloadMethod === DownloadMethod.AUTO) {
      if (inputs.enableAcceleration) {
        // Perform network analysis to determine the best method
        logger.info('Performing network analysis to determine optimal download method')
        
        try {
          // Analyze network conditions
          const networkInfo = await NetworkAnalyzer.analyzeNetwork()
          
          // Check if any mirror services are healthy
          const availableServices = proxyManager.getMirrorServices()
          const healthResults = await proxyManager.checkHealthStatus(availableServices)
          const healthyServices = healthResults.filter(result => result.isHealthy)
          
          // Log network analysis results
          logger.info('Network analysis results', {
            region: networkInfo.region,
            country: networkInfo.country,
            connectionType: networkInfo.connectionType,
            bandwidth: `${networkInfo.estimatedBandwidth.toFixed(2)} Mbps`,
            latency: `${networkInfo.latencyToGitHub.toFixed(0)} ms`,
            healthyMirrors: healthyServices.length
          })
          
          // Determine if acceleration is recommended based on network conditions
          const accelerationRecommended = NetworkAnalyzer.isAccelerationRecommended(networkInfo)
          
          if (!accelerationRecommended && networkInfo.latencyToGitHub < 300) {
            // Good GitHub connectivity, use direct
            downloadMethod = DownloadMethod.DIRECT
            logger.info('Auto-selected direct download method (good GitHub connectivity)')
          } else if (healthyServices.length === 0) {
            // No healthy mirrors, use direct
            downloadMethod = DownloadMethod.DIRECT
            logger.info('Auto-selected direct download method (no healthy mirrors available)')
          } else {
            // Use mirror for better performance
            downloadMethod = DownloadMethod.MIRROR
            logger.info('Auto-selected mirror download method (better performance expected)')
            
            // If network is very poor, try Git method as it's more resilient
            if (networkInfo.connectionType === 'very-poor') {
              logger.info('Network conditions are poor, considering Git method as fallback')
            }
          }
        } catch (error) {
          // Default to mirror on error
          downloadMethod = DownloadMethod.MIRROR
          logger.info('Auto-selected mirror download method (default choice)')
          logger.debug('Network analysis error', error)
        }
      } else {
        downloadMethod = DownloadMethod.DIRECT
        logger.info('Auto-selected direct download method (acceleration disabled)')
      }
    }

    logger.info('Starting download process', {
      repository: inputs.repository,
      ref: inputs.ref,
      method: downloadMethod,
      enableAcceleration: inputs.enableAcceleration,
      fallbackEnabled: inputs.fallbackEnabled
    })

    // Analyze network conditions
    let networkInfo: NetworkInfo | undefined
    try {
      networkInfo = await NetworkAnalyzer.analyzeNetwork()
      logger.debug('Network analysis completed', networkInfo)
    } catch (error) {
      logger.warn('Network analysis failed', error)
    }

    // Execute download with fallback
    const mirrorSelectionStartTime = Date.now()
    result = await fallbackHandler.executeWithFallback(
      downloadMethod,
      inputs.fallbackEnabled
    )
    const mirrorSelectionTime = (Date.now() - mirrorSelectionStartTime) / 1000

    // Calculate additional metrics
    const totalTime = (Date.now() - startTime) / 1000
    const successRate = result.success ? 100 : 0

    // Get mirror service information
    const mirrorServices = proxyManager.getMirrorServices()
    const healthStatus = proxyManager.getCachedHealthStatus()
    const speedResults = proxyManager.getCachedSpeedResults()

    // Set outputs
    OutputHandler.setOutputs(result, {
      mirrorSelectionTime,
      successRate,
      mirrorsTested: speedResults.length
    })

    // Set summary
    await OutputHandler.setSummary(result, {
      totalExecutionTime: `${totalTime.toFixed(2)}s`,
      mirrorSelectionTime: `${mirrorSelectionTime.toFixed(2)}s`,
      availableMirrors: mirrorServices.length,
      healthyMirrors: healthStatus.filter(h => h.isHealthy).length,
      testedMirrors: speedResults.length,
      networkInfo,
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