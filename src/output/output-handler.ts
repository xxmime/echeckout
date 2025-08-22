/**
 * Output handling for GitHub Actions
 */

import * as core from '@actions/core'
import {DownloadResult} from '../types'
import {OUTPUT_NAMES} from '../constants'
import {logger} from '../utils/logger'

export class OutputHandler {
  /**
   * Set action outputs based on download result
   */
  static setOutputs(result: DownloadResult, additionalOutputs: Record<string, any> = {}): void {
    logger.debug('Setting action outputs')

    try {
      // Basic outputs
      core.setOutput(OUTPUT_NAMES.REF, result.ref || '')
      core.setOutput(OUTPUT_NAMES.COMMIT, result.commit || '')

      // Download information
      core.setOutput(OUTPUT_NAMES.DOWNLOAD_METHOD, result.method)
      core.setOutput(OUTPUT_NAMES.MIRROR_USED, result.mirrorUsed || '')
      core.setOutput(OUTPUT_NAMES.DOWNLOAD_TIME, result.downloadTime.toString())
      core.setOutput(OUTPUT_NAMES.DOWNLOAD_SPEED, result.downloadSpeed.toFixed(2))
      core.setOutput(OUTPUT_NAMES.DOWNLOAD_SIZE, result.downloadSize.toString())

      // Performance metrics
      core.setOutput(OUTPUT_NAMES.MIRROR_SELECTION_TIME, additionalOutputs['mirrorSelectionTime']?.toString() || '0')
      core.setOutput(OUTPUT_NAMES.SUCCESS_RATE, additionalOutputs['successRate']?.toString() || '0')

      // Status information
      core.setOutput(OUTPUT_NAMES.SUCCESS, result.success.toString())
      core.setOutput(OUTPUT_NAMES.FALLBACK_USED, result.fallbackUsed.toString())
      core.setOutput(OUTPUT_NAMES.MIRRORS_TESTED, additionalOutputs['mirrorsTested']?.toString() || '0')

      // Error information
      core.setOutput(OUTPUT_NAMES.ERROR_MESSAGE, result.errorMessage || '')
      core.setOutput(OUTPUT_NAMES.ERROR_CODE, result.errorCode || '')

      logger.info('Action outputs set successfully', {
        success: result.success,
        method: result.method,
        downloadTime: result.downloadTime,
        downloadSpeed: result.downloadSpeed
      })
    } catch (error) {
      logger.error('Failed to set action outputs', error)
    }
  }

  /**
   * Set summary for the action run
   */
  static async setSummary(result: DownloadResult, additionalInfo: Record<string, unknown> = {}): Promise<void> {
    try {
      // Extract network info if available
      const networkInfo = additionalInfo['networkInfo'] as any
      
      const summary = core.summary
        .addHeading('🚀 Accelerated GitHub Checkout Results')
        .addTable([
          [
            {data: 'Metric', header: true},
            {data: 'Value', header: true}
          ],
          ['Status', result.success ? '✅ Success' : '❌ Failed'],
          ['Download Method', result.method],
          ['Mirror Used', result.mirrorUsed || 'N/A'],
          ['Download Time', `${result.downloadTime.toFixed(2)}s`],
          ['Download Speed', `${result.downloadSpeed.toFixed(2)} MB/s`],
          ['Download Size', `${(result.downloadSize / (1024 * 1024)).toFixed(2)} MB`],
          ['Fallback Used', result.fallbackUsed ? 'Yes' : 'No'],
          ['Retry Count', result.retryCount.toString()]
        ])

      // Add network information if available
      if (networkInfo) {
        summary.addHeading('🌐 Network Information', 3)
          .addTable([
            [
              {data: 'Network Metric', header: true},
              {data: 'Value', header: true}
            ],
            ['Region', networkInfo.region || 'Unknown'],
            ['Connection Type', networkInfo.connectionType || 'Unknown'],
            ['GitHub Latency', networkInfo.latencyToGitHub ? `${networkInfo.latencyToGitHub.toFixed(0)} ms` : 'Unknown'],
            ['Estimated Bandwidth', networkInfo.estimatedBandwidth ? `${networkInfo.estimatedBandwidth.toFixed(2)} Mbps` : 'Unknown']
          ])
      }

      // Add basic mirror information (health/speed tests removed)
      if (additionalInfo['availableMirrors'] !== undefined) {
        summary.addHeading('🔄 Mirror Services', 3)
          .addTable([
            [
              {data: 'Mirror Metric', header: true},
              {data: 'Value', header: true}
            ],
            ['Available Mirrors', additionalInfo['availableMirrors']?.toString() || '0'],
            ['Mirror Selection Time', additionalInfo['mirrorSelectionTime']?.toString() || '0s']
          ])
      }

      if (result.errorMessage) {
        summary.addHeading('❌ Error Details', 3)
          .addCodeBlock(result.errorMessage, 'text')
      }

      // Add remaining additional information
      const filteredInfo = {...additionalInfo}
      delete filteredInfo['networkInfo']
      delete filteredInfo['availableMirrors']
      delete filteredInfo['mirrorSelectionTime']
      delete filteredInfo['availableMirrors']
      
      if (Object.keys(filteredInfo).length > 0) {
        summary.addHeading('📊 Additional Information', 3)
          .addCodeBlock(JSON.stringify(filteredInfo, null, 2), 'json')
      }

      await summary.write()
      logger.debug('Action summary written successfully')
    } catch (error) {
      logger.error('Failed to write action summary', error)
    }
  }
}