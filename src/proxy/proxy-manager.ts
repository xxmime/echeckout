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
      // Filter services by method support and enabled status
      const availableServices = this.mirrorServices.filter(
        service => service.enabled && service.supportedMethods.includes(method)
      )

      if (availableServices.length === 0) {
        logger.warn('No available mirror services found')
        return null
      }

      // Check health status for all services in parallel
      const healthResults = await this.checkHealthStatus(availableServices)
      
      // Filter healthy services and sort by response time
      const healthyServices = healthResults
        .filter(result => result.isHealthy)
        .sort((a, b) => a.responseTime - b.responseTime)
        .map(result => result.service)

      if (healthyServices.length === 0) {
        logger.warn('No healthy mirror services found')
        
        // Try to use the service with the lowest response time even if not fully healthy
        const bestUnhealthyService = healthResults
          .sort((a, b) => a.responseTime - b.responseTime)[0]?.service
        
        if (bestUnhealthyService) {
          logger.warn('Using best unhealthy service as fallback', {
            name: bestUnhealthyService.name,
            url: bestUnhealthyService.url
          })
          return bestUnhealthyService
        }
        
        return null
      }

      // If speed test is disabled, use a weighted selection based on priority and response time
      if (!enableSpeedTest) {
        // Get the top 3 services with lowest response times
        const topServices = healthResults
          .filter(result => result.isHealthy)
          .sort((a, b) => a.responseTime - b.responseTime)
          .slice(0, 3)
          .map(result => ({
            service: result.service,
            score: (1000 - result.responseTime) / (result.service.priority || 1)
          }))
          .sort((a, b) => b.score - a.score)
        
        const bestService = topServices[0]?.service
        
        logger.info('Selected mirror service (no speed test)', {
          name: bestService?.name,
          url: bestService?.url,
          responseTime: healthResults.find(r => r.service.name === bestService?.name)?.responseTime
        })
        
        return bestService || null
      }

      // For speed test, only test the top 3-5 services with best response times
      const servicesToTest = healthyServices.slice(0, 5)
      
      // Perform speed tests in parallel
      const speedResults = await this.performSpeedTests(servicesToTest)
      const fastestService = this.selectFastestService(speedResults)

      if (fastestService) {
        const speedResult = speedResults.find(r => r.service.name === fastestService.name)
        logger.info('Selected fastest mirror service', {
          name: fastestService.name,
          url: fastestService.url,
          speed: `${speedResult?.downloadSpeed.toFixed(2)} MB/s`,
          latency: `${speedResult?.latency.toFixed(2)} ms`
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
    
    // 添加健康检查开始日志
    logger.info('Starting mirror service health checks', {
      totalServices: services.length,
      services: services.map(s => ({ name: s.name, url: s.url, priority: s.priority }))
    })

    const healthChecks = services.map(async service => {
      const cached = this.healthCache.get(service.name)
      if (cached && this.isCacheValid(cached.lastChecked)) {
        logger.debug(`Using cached health status for ${service.name}`)
        return cached
      }

      try {
        const startTime = Date.now()
        let healthUrl = service.healthCheckUrl || service.url
        
        // Use special health check URLs for specific services
        if (service.name.includes('AKAMS.CN')) {
          // AKAMS.CN services use the same format as other proxy services
          healthUrl = service.healthCheckUrl || `${service.url}/https://raw.githubusercontent.com/actions/checkout/main/package.json`
        } else if (service.name === 'TVV.TW') {
          healthUrl = 'https://tvv.tw/https://raw.githubusercontent.com/actions/checkout/main/package.json'
        } else if (service.name === 'GHProxy') {
          healthUrl = 'https://ghproxy.com/https://raw.githubusercontent.com/actions/checkout/main/package.json'
        } else if (service.name === 'GitHub Proxy') {
          healthUrl = 'https://github.moeyy.xyz/https://raw.githubusercontent.com/actions/checkout/main/package.json'

        } else if (service.name === 'Statically') {
          healthUrl = 'https://cdn.statically.io/gh/actions/checkout/main/package.json'
        } else if (service.name === 'Gitclone') {
          healthUrl = 'https://gitclone.com/github.com/actions/checkout/raw/main/package.json'
        }
        
        // Add a cache-busting parameter to avoid cached responses
        const cacheBuster = `?_=${Date.now()}`
        if (healthUrl.includes('?')) {
          healthUrl += `&_=${Date.now()}`
        } else {
          healthUrl += cacheBuster
        }
        
        logger.debug(`Health check for ${service.name}`, { url: healthUrl })
        
        const response = await axios.get(healthUrl, {
          timeout: DEFAULT_CONFIG.HEALTH_CHECK_TIMEOUT * 1000,
          headers: {
            ...HTTP_HEADERS,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          },
          validateStatus: status => status < 500, // Accept 4xx as potentially healthy
          maxRedirects: 3 // Limit redirects
        })

        const responseTime = Date.now() - startTime
        
        // Service-specific health validation
        let isHealthy = response.status < 400
        const contentType = response.headers['content-type'] || ''
        
        // For proxy services, check content type and response body
        if (['TVV.TW', 'GHProxy', 'GitHub Proxy', 'Gitclone'].includes(service.name) || service.name.includes('AKAMS.CN')) {
          isHealthy = response.status < 400 && 
                     (contentType.includes('application/json') || 
                      contentType.includes('text/plain') ||
                      contentType.includes('application/octet-stream'))
          
          // HTML response usually indicates an error page
          if (contentType.includes('text/html')) {
            isHealthy = false
            logger.debug(`${service.name} returned HTML, marking as unhealthy`)
          }
          
          // Check if response contains actual JSON content
          if (contentType.includes('application/json') && response.data) {
            try {
              const jsonData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
              if (!jsonData || !jsonData.name) {
                isHealthy = false
                logger.debug(`${service.name} returned invalid JSON, marking as unhealthy`)
              }
            } catch (e) {
              isHealthy = false
              logger.debug(`${service.name} returned malformed JSON, marking as unhealthy`)
            }
          }
        }
        
        // For CDN services, they should return text or JSON
        if (['Statically'].includes(service.name)) {
          isHealthy = response.status < 400 && 
                     (contentType.includes('application/json') || 
                      contentType.includes('text/plain'))
          
          // Additional validation for CDN services
          if (response.data && typeof response.data === 'string' && response.data.length < 50) {
            isHealthy = false
            logger.debug(`${service.name} returned suspiciously small response, marking as unhealthy`)
          }
        }
        
        // Check response body size - empty responses are suspicious
        if (response.data && 
            ((typeof response.data === 'string' && response.data.length < 10) ||
             (response.data instanceof Buffer && response.data.length < 10))) {
          isHealthy = false
          logger.debug(`${service.name} returned empty response, marking as unhealthy`)
        }
        
        const status: MirrorHealthStatus = {
          service,
          isHealthy,
          responseTime,
          lastChecked: new Date(),
          statusCode: response.status,
          contentType
        }

        this.healthCache.set(service.name, status)
        
        // 添加详细的健康检查结果日志
        logger.info(`Health check result for ${service.name}`, {
          healthy: isHealthy,
          responseTime: `${responseTime}ms`,
          statusCode: response.status,
          contentType: contentType.substring(0, 50), // 限制长度
          priority: service.priority,
          url: service.url
        })
        
        return status
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.debug(`Health check failed for ${service.name}`, { error: errorMessage })
        
        const status: MirrorHealthStatus = {
          service,
          isHealthy: false,
          responseTime: DEFAULT_CONFIG.HEALTH_CHECK_TIMEOUT * 1000,
          lastChecked: new Date(),
          errorMessage
        }

        this.healthCache.set(service.name, status)
        
        // 添加失败的健康检查日志
        logger.warn(`Health check failed for ${service.name}`, {
          error: errorMessage,
          priority: service.priority,
          url: service.url,
          timeout: DEFAULT_CONFIG.HEALTH_CHECK_TIMEOUT
        })
        
        return status
      }
    })

    const results = await Promise.all(healthChecks)
    const healthyCount = results.filter(r => r.isHealthy).length
    
    logger.debug(`Health check completed: ${healthyCount}/${results.length} services healthy`)
    
    // 添加健康检查总结日志
    logger.info('Mirror service health check summary', {
      totalServices: results.length,
      healthyServices: healthyCount,
      unhealthyServices: results.length - healthyCount,
      healthyServicesList: results.filter(r => r.isHealthy).map(r => r.service.name),
      unhealthyServicesList: results.filter(r => !r.isHealthy).map(r => ({ 
        name: r.service.name, 
        error: r.errorMessage || `Status: ${r.statusCode}` 
      }))
    })
    
    return results
  }

  /**
   * Perform speed tests on healthy services
   */
  async performSpeedTests(services: MirrorService[]): Promise<MirrorSpeedTestResult[]> {
    logger.debug('Performing speed tests', {count: services.length})

    const speedTests = services.map(async service => {
      const cached = this.speedCache.get(service.name)
      // Check if cached result exists and is still valid (within cache timeout)
      if (cached && (cached as any).lastTested && this.isCacheValid((cached as any).lastTested)) {
        return cached
      }

      try {
        // Determine appropriate test URL based on service type
        let testUrl = service.speedTestUrl || `${service.url}/test`
        
        // For CDN services that have size limitations, use a smaller test file
        if (service.metadata?.['limitedToSmallFiles']) {
          testUrl = service.speedTestUrl || `${service.url}/actions/checkout@main/package.json`
        }
        
        // Add cache busting parameter
        if (testUrl.includes('?')) {
          testUrl += `&_=${Date.now()}`
        } else {
          testUrl += `?_=${Date.now()}`
        }
        
        // Measure initial latency; some mirrors may block HEAD, fallback to tiny ranged GET
        let latency = 0
        const latencyStartTime = Date.now()
        try {
          await axios.head(testUrl, {
            timeout: 5000,
            headers: HTTP_HEADERS,
            validateStatus: () => true
          })
          latency = Date.now() - latencyStartTime
        } catch {
          try {
            await axios.get(testUrl, {
              timeout: 5000,
              headers: { ...HTTP_HEADERS, Range: 'bytes=0-1023' },
              responseType: 'arraybuffer',
              validateStatus: () => true
            })
          } catch {
            // ignore
          } finally {
            latency = Date.now() - latencyStartTime
          }
        }
        
        // Now perform the actual download test
        const startTime = Date.now()
        
        const response = await axios.get(testUrl, {
          timeout: DEFAULT_CONFIG.SPEED_TEST_TIMEOUT * 1000,
          headers: {
            ...HTTP_HEADERS,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          },
          responseType: 'arraybuffer'
        })

        const endTime = Date.now()
        const testDuration = (endTime - startTime) / 1000 // seconds
        const testSize = response.data.byteLength
        
        // Calculate download speed in MB/s
        // Use a minimum test size to avoid division by zero or unrealistic speeds
        const effectiveSize = Math.max(testSize, 1024)
        const downloadSpeed = (effectiveSize / (1024 * 1024)) / testDuration
        
        // Apply a correction factor for very small files to avoid unrealistic speed measurements
        let correctedSpeed = downloadSpeed
        if (testSize < 100 * 1024) { // Less than 100KB
          correctedSpeed = downloadSpeed * 0.7 // Apply a penalty factor
        }

        const result: MirrorSpeedTestResult = {
          service,
          downloadSpeed: correctedSpeed,
          latency,
          testDuration,
          testSize,
          success: true,
          contentType: response.headers['content-type']
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

    // Calculate a composite score based on download speed, latency, and priority
    const scoredResults = successfulResults.map(result => {
      // Normalize values (higher is better)
      const speedScore = result.downloadSpeed * 10; // MB/s * 10
      const latencyScore = 1000 / (result.latency + 100); // Inverse of latency
      const priorityScore = 10 / (result.service.priority || 1); // Inverse of priority
      
      // Calculate weighted composite score
      // Weight: 70% speed, 20% latency, 10% priority
      const compositeScore = (speedScore * 0.7) + (latencyScore * 0.2) + (priorityScore * 0.1);
      
      return {
        service: result.service,
        score: compositeScore,
        downloadSpeed: result.downloadSpeed,
        latency: result.latency
      };
    });

    // Sort by composite score (descending)
    scoredResults.sort((a, b) => b.score - a.score);
    
    // Log the top 3 services for debugging
    const topServices = scoredResults.slice(0, 3);
    logger.debug('Top mirror services by score:', topServices.map(s => ({
      name: s.service.name,
      score: s.score.toFixed(2),
      speed: `${s.downloadSpeed.toFixed(2)} MB/s`,
      latency: `${s.latency.toFixed(0)} ms`,
      priority: s.service.priority
    })));

    return scoredResults[0]?.service || null;
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