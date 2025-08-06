/**
 * Network analyzer for optimizing download performance
 */

import axios from 'axios'
import { NetworkInfo } from '../types'
import { logger } from './logger'
import { DEFAULT_CONFIG, HTTP_HEADERS } from '../constants'

export class NetworkAnalyzer {
  /**
   * Analyze network conditions to determine optimal download strategy
   */
  static async analyzeNetwork(): Promise<NetworkInfo> {
    logger.debug('Analyzing network conditions')
    
    try {
      logger.info('Starting network analysis')
      
      // Measure GitHub latency
      logger.debug('Measuring latency to GitHub')
      const githubLatency = await this.measureLatency('https://api.github.com/zen')
      logger.info('GitHub latency measurement completed', {
        latency: `${githubLatency.toFixed(0)}ms`
      })
      
      // Estimate bandwidth using a small download test
      logger.debug('Estimating bandwidth')
      const bandwidth = await this.estimateBandwidth()
      logger.info('Bandwidth estimation completed', {
        bandwidth: `${bandwidth.toFixed(2)} Mbps`
      })
      
      // Determine region if possible
      logger.debug('Determining region and ISP')
      const region = await this.determineRegion()
      logger.info('Region determination completed', {
        region: region.region,
        country: region.country,
        isp: region.isp
      })
      
      const connectionType = this.classifyConnectionType(bandwidth, githubLatency)
      logger.info('Connection type classification', {
        connectionType,
        bandwidth: `${bandwidth.toFixed(2)} Mbps`,
        latency: `${githubLatency.toFixed(0)}ms`
      })
      
      const networkInfo: NetworkInfo = {
        region: region.region,
        country: region.country,
        isp: region.isp,
        connectionType: connectionType,
        estimatedBandwidth: bandwidth,
        latencyToGitHub: githubLatency
      }
      
      // 添加加速建议
      const accelerationRecommended = this.isAccelerationRecommended(networkInfo)
      logger.info('Network analysis completed', {
        ...networkInfo,
        accelerationRecommended,
        recommendation: accelerationRecommended ? 
          'Acceleration is recommended for this network condition' : 
          'Direct download should work well for this network condition'
      })
      
      return networkInfo
    } catch (error) {
      logger.warn('Network analysis failed', error)
      
      // Return default values on error
      const defaultInfo = {
        region: 'unknown',
        country: 'unknown',
        isp: 'unknown',
        connectionType: 'unknown',
        estimatedBandwidth: 0,
        latencyToGitHub: 0
      }
      
      logger.info('Using default network info due to analysis failure', defaultInfo)
      return defaultInfo
    }
  }
  
  /**
   * Measure latency to a given URL
   */
  private static async measureLatency(url: string): Promise<number> {
    try {
      const samples = []
      const maxSamples = 3
      
      for (let i = 0; i < maxSamples; i++) {
        const start = Date.now()
        await axios.get(url, {
          timeout: 5000,
          headers: HTTP_HEADERS
        })
        const latency = Date.now() - start
        samples.push(latency)
      }
      
      // Remove outliers and calculate average
      samples.sort((a, b) => a - b)
      const validSamples = samples.slice(0, samples.length - 1) // Remove highest value
      const sum = validSamples.reduce((acc, val) => acc + val, 0)
      return sum / validSamples.length
    } catch (error) {
      logger.debug('Latency measurement failed', error)
      return DEFAULT_CONFIG.HIGH_LATENCY_THRESHOLD // Default to high latency on error
    }
  }
  
  /**
   * Estimate bandwidth using a small download test
   */
  private static async estimateBandwidth(): Promise<number> {
    try {
      const testUrl = 'https://raw.githubusercontent.com/actions/checkout/main/README.md'
      const start = Date.now()
      
      const response = await axios.get(testUrl, {
        timeout: 5000,
        headers: HTTP_HEADERS,
        responseType: 'arraybuffer'
      })
      
      const duration = (Date.now() - start) / 1000 // seconds
      const size = response.data.byteLength
      
      // Calculate bandwidth in Mbps (megabits per second)
      const bandwidth = (size * 8) / (1024 * 1024) / duration
      
      return bandwidth
    } catch (error) {
      logger.debug('Bandwidth estimation failed', error)
      return 0
    }
  }
  
  /**
   * Determine region and country based on IP
   */
  private static async determineRegion(): Promise<{region: string, country: string, isp: string}> {
    try {
      // Use a public IP info service
      const response = await axios.get('https://ipinfo.io/json', {
        timeout: 3000
      })
      
      return {
        region: response.data.region || 'unknown',
        country: response.data.country || 'unknown',
        isp: response.data.org || 'unknown'
      }
    } catch (error) {
      logger.debug('Region determination failed', error)
      return {
        region: 'unknown',
        country: 'unknown',
        isp: 'unknown'
      }
    }
  }
  
  /**
   * Classify connection type based on bandwidth and latency
   */
  private static classifyConnectionType(bandwidth: number, latency: number): string {
    if (bandwidth > 50 && latency < 100) {
      return 'excellent'
    } else if (bandwidth > 20 && latency < 200) {
      return 'good'
    } else if (bandwidth > 5 && latency < 500) {
      return 'average'
    } else if (bandwidth > 1) {
      return 'poor'
    } else {
      return 'very-poor'
    }
  }
  
  /**
   * Determine if acceleration is recommended based on network conditions
   */
  static isAccelerationRecommended(networkInfo: NetworkInfo): boolean {
    // Acceleration is recommended for:
    // 1. High latency to GitHub (> 300ms)
    // 2. Low bandwidth (< 10 Mbps)
    // 3. Certain regions known to have GitHub access issues
    
    const highLatency = networkInfo.latencyToGitHub > 300
    const lowBandwidth = networkInfo.estimatedBandwidth < 10
    
    // Regions that typically benefit from acceleration
    const accelerationRegions = ['CN', 'Asia', 'Africa', 'South America']
    const regionMatch = accelerationRegions.some(r => 
      networkInfo.region.includes(r) || networkInfo.country.includes(r)
    )
    
    return highLatency || lowBandwidth || regionMatch
  }
}