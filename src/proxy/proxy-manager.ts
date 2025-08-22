/**
 * Proxy and mirror service management
 */

import { MirrorService, DownloadMethod } from '../types'
import { BUILTIN_MIRROR_SERVICES } from '../constants'
import {logger} from '../utils/logger'

export class ProxyManager {
  private mirrorServices: MirrorService[]
  // Health checks and speed tests have been removed; ProxyManager now only stores services

  constructor(customMirrors: MirrorService[] = []) {
    this.mirrorServices = [...BUILTIN_MIRROR_SERVICES, ...customMirrors]
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

  // Select best mirror: simple priority-based selection among enabled and supported services
  async getBestMirror(
    method: DownloadMethod = DownloadMethod.MIRROR
  ): Promise<MirrorService | null> {
    const availableServices = this.mirrorServices
      .filter(service => service.enabled && service.supportedMethods.includes(method))
      .sort((a, b) => (a.priority || 0) - (b.priority || 0))
    return availableServices[0] || null
  }

  // Health checks removed

  /**
   * Perform speed tests on healthy services
   */
  // Speed tests removed

  /**
   * Select fastest service from speed test results
   */
  // Fastest service selection removed

  /**
   * Check if cache entry is still valid
   */
  // Cache validation removed

  /**
   * Clear all caches
   */
  clearCache(): void {
    // No-op after removing health/speed caches
  }

  /**
   * Get cached health status
   */
  getCachedHealthStatus(): [] { return [] }

  /**
   * Get cached speed test results
   */
  getCachedSpeedResults(): [] { return [] }
}