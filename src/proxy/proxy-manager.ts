/**
 * Proxy and mirror service management
 */

import axios from 'axios'
import {
  MirrorService,
  MirrorHealthStatus,
  MirrorSpeedTestResult,
  DownloadMethod
} from '../types'
import {BUILTIN_MIRROR_SERVICES, DEFAULT_CONFIG, HTTP_HEADERS} from '../constants'
import {logger} from '../utils/logger'

export class ProxyManager {
  private mirrorServices: MirrorService[]
  private healthCache: Map<string, MirrorHealthStatus>
  private speedCache: Map<string, MirrorSpeedTestResult>
  private cacheTimeout: number

  constructor(customMirrors: MirrorService[] = []) {
    this.mirrorServices = [...BUILTIN_MIRROR_SERVICES, ...customMirrors]
    this.healthCache = new Map()
    this.speedCache = new Map()
    this.cacheTimeout = 5 * 60 * 1000 // 5 minutes
  }

  /**
   * Get all available mirror services
   */
  getMirrorServices(): MirrorService[] {
    return this.mirrorServices.filter(service => service.enabled)
  }

  /**
   * Add custom mirror service
   */
  addMirrorService(service: MirrorService): void {
    // Insert custom service at the beginning for higher priority
    this.mirrorServices.unshift(service)
    logger.debug('Added custom mirror service', {name: service.name, url: service.url})
  }

  /**
   * Get best mirror service based on health and speed
   */
  async getBestMirror(
    method: DownloadMethod = DownloadMethod.MIRROR,
    enableSpeedTest = true
  ): Promise<MirrorService | null> {
    logger.group('Selecting best mirror service')
    
    try {
      const availableServices = this.mirrorServices.filter(
        service => service.enabled && service.supportedMethods.includes(method)
      )

      if (availableServices.length === 0) {
        logger.warn('No available mirror services found')
        return null
      }

      // Check health status for all services
      const healthResults = await this.checkHealthStatus(availableServices)
      const healthyServices = healthResults
        .filter(result => result.isHealthy)
        .map(result => result.service)

      if (healthyServices.length === 0) {
        logger.warn('No healthy mirror services found')
        return null
      }

      // If speed test is disabled, return highest priority healthy service
      if (!enableSpeedTest) {
        const bestService = healthyServices.sort((a, b) => a.priority - b.priority)[0]
        logger.info('Selected mirror service (no speed test)', {
          name: bestService?.name,
          url: bestService?.url
        })
        return bestService || null
      }

      // Perform speed tests
      const speedResults = await this.performSpeedTests(healthyServices)
      const fastestService = this.selectFastestService(speedResults)

      if (fastestService) {
        logger.info('Selected fastest mirror service', {
          name: fastestService.name,
          url: fastestService.url,
          speed: speedResults.find(r => r.service.name === fastestService.name)?.downloadSpeed
        })
      }

      return fastestService
    } catch (error) {
      logger.error('Failed to select best mirror', error)
      return null
    } finally {
      logger.endGroup()
    }
  }

  /**
   * Check health status of mirror services
   */
  async checkHealthStatus(services: MirrorService[]): Promise<MirrorHealthStatus[]> {
    logger.debug('Checking health status of mirror services', {count: services.length})

    const healthChecks = services.map(async service => {
      const cached = this.healthCache.get(service.name)
      if (cached && this.isCacheValid(cached.lastChecked)) {
        return cached
      }

      try {
        const startTime = Date.now()
        let healthUrl = service.healthCheckUrl || service.url
        
        // Use special health check for tvv.tw
        if (service.name === 'TVV.TW') {
          healthUrl = 'https://tvv.tw/https://raw.githubusercontent.com/actions/checkout/main/package.json'
        }
        
        const response = await axios.get(healthUrl, {
          timeout: DEFAULT_CONFIG.HEALTH_CHECK_TIMEOUT * 1000,
          headers: HTTP_HEADERS,
          validateStatus: status => status < 500 // Accept 4xx as healthy
        })

        const responseTime = Date.now() - startTime
        
        // Additional validation for tvv.tw
        let isHealthy = response.status < 400
        if (service.name === 'TVV.TW') {
          // For tvv.tw, we expect text/plain content-type for raw files
          // Accept both application/json and text/plain as healthy responses
          const contentType = response.headers['content-type'] || ''
          isHealthy = response.status < 400 && 
                     (contentType.includes('application/json') || 
                      contentType.includes('text/plain') ||
                      contentType.includes('application/octet-stream'))
          
          // HTML response usually indicates an error page
          if (contentType.includes('text/html')) {
            isHealthy = false
          }
        }
        
        const status: MirrorHealthStatus = {
          service,
          isHealthy,
          responseTime,
          lastChecked: new Date(),
          statusCode: response.status
        }

        this.healthCache.set(service.name, status)
        return status
      } catch (error) {
        const status: MirrorHealthStatus = {
          service,
          isHealthy: false,
          responseTime: DEFAULT_CONFIG.HEALTH_CHECK_TIMEOUT * 1000,
          lastChecked: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        }

        this.healthCache.set(service.name, status)
        return status
      }
    })

    return Promise.all(healthChecks)
  }

  /**
   * Perform speed tests on healthy services
   */
  async performSpeedTests(services: MirrorService[]): Promise<MirrorSpeedTestResult[]> {
    logger.debug('Performing speed tests', {count: services.length})

    const speedTests = services.map(async service => {
      const cached = this.speedCache.get(service.name)
      if (cached && this.isCacheValid(cached.testDuration)) {
        return cached
      }

      try {
        const testUrl = service.speedTestUrl || `${service.url}/test`
        const startTime = Date.now()
        
        const response = await axios.get(testUrl, {
          timeout: DEFAULT_CONFIG.SPEED_TEST_TIMEOUT * 1000,
          headers: HTTP_HEADERS,
          responseType: 'arraybuffer'
        })

        const endTime = Date.now()
        const testDuration = (endTime - startTime) / 1000 // seconds
        const testSize = response.data.byteLength
        const downloadSpeed = (testSize / (1024 * 1024)) / testDuration // MB/s

        const result: MirrorSpeedTestResult = {
          service,
          downloadSpeed,
          latency: testDuration * 1000, // ms
          testDuration,
          testSize,
          success: true
        }

        this.speedCache.set(service.name, result)
        return result
      } catch (error) {
        const result: MirrorSpeedTestResult = {
          service,
          downloadSpeed: 0,
          latency: DEFAULT_CONFIG.SPEED_TEST_TIMEOUT * 1000,
          testDuration: DEFAULT_CONFIG.SPEED_TEST_TIMEOUT,
          testSize: 0,
          success: false,
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        }

        this.speedCache.set(service.name, result)
        return result
      }
    })

    return Promise.all(speedTests)
  }

  /**
   * Select fastest service from speed test results
   */
  private selectFastestService(results: MirrorSpeedTestResult[]): MirrorService | null {
    const successfulResults = results.filter(result => result.success)
    
    if (successfulResults.length === 0) {
      return null
    }

    // Sort by download speed (descending) and then by priority (ascending)
    successfulResults.sort((a, b) => {
      if (Math.abs(a.downloadSpeed - b.downloadSpeed) < 0.1) {
        return a.service.priority - b.service.priority
      }
      return b.downloadSpeed - a.downloadSpeed
    })

    return successfulResults[0]?.service || null
  }

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid(timestamp: Date | number): boolean {
    const now = Date.now()
    const cacheTime = timestamp instanceof Date ? timestamp.getTime() : timestamp
    return (now - cacheTime) < this.cacheTimeout
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.healthCache.clear()
    this.speedCache.clear()
    logger.debug('Cleared mirror service caches')
  }

  /**
   * Get cached health status
   */
  getCachedHealthStatus(): MirrorHealthStatus[] {
    return Array.from(this.healthCache.values())
  }

  /**
   * Get cached speed test results
   */
  getCachedSpeedResults(): MirrorSpeedTestResult[] {
    return Array.from(this.speedCache.values())
  }
}