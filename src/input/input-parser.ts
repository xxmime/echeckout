/**
 * Input parser for GitHub Actions inputs
 */

import * as core from '@actions/core'
import {ActionInputs, DownloadMethod, ErrorCode} from '../types'
import {INPUT_NAMES, DEFAULT_CONFIG, REGEX_PATTERNS} from '../constants'
import {createActionError} from '../utils/error-utils'

/**
 * Parse and validate GitHub Actions inputs
 */
export function parseInputs(): ActionInputs {
  // Support both mirror-url and github-proxy-url (aliases)
  const mirrorUrl = getInput(INPUT_NAMES.MIRROR_URL) || getInput(INPUT_NAMES.GITHUB_PROXY_URL) || ''
  
  const inputs: ActionInputs = {
    // Basic configuration
    repository: getInput(INPUT_NAMES.REPOSITORY) || process.env['GITHUB_REPOSITORY'] || '',
    ref: getInput(INPUT_NAMES.REF) || process.env['GITHUB_REF'] || '',
    token: getInput(INPUT_NAMES.TOKEN) || process.env['GITHUB_TOKEN'] || '',
    path: getInput(INPUT_NAMES.PATH) || '.',

    // Proxy acceleration configuration
    enableAcceleration: getBooleanInput(INPUT_NAMES.ENABLE_ACCELERATION, true),
    mirrorUrl,
    // autoSelectMirror removed
    mirrorTimeout: getNumberInput(INPUT_NAMES.MIRROR_TIMEOUT, DEFAULT_CONFIG.MIRROR_TIMEOUT),
    fallbackEnabled: getBooleanInput(INPUT_NAMES.FALLBACK_ENABLED, true),

    // Download strategy
    downloadMethod: getDownloadMethodInput(INPUT_NAMES.DOWNLOAD_METHOD, DownloadMethod.AUTO),
    retryAttempts: getNumberInput(INPUT_NAMES.RETRY_ATTEMPTS, DEFAULT_CONFIG.MAX_RETRY_ATTEMPTS),
    // speedTest removed

    // Advanced configuration
    fetchDepth: getNumberInput(INPUT_NAMES.FETCH_DEPTH, DEFAULT_CONFIG.DEFAULT_FETCH_DEPTH),
    clean: getBooleanInput(INPUT_NAMES.CLEAN, true),

    // Debug and monitoring
    verbose: getBooleanInput(INPUT_NAMES.VERBOSE, false),
    // performanceMonitoring removed
  }

  validateInputs(inputs)
  return inputs
}

/**
 * Validate parsed inputs
 */
export function validateInputs(inputs: ActionInputs): void {
  // Validate repository
  if (!inputs.repository) {
    throw createActionError(
      'Repository is required',
      ErrorCode.INVALID_REPOSITORY,
      {repository: inputs.repository}
    )
  }

  if (!REGEX_PATTERNS.REPOSITORY_NAME.test(inputs.repository)) {
    throw createActionError(
      `Invalid repository format: ${inputs.repository}. Expected format: owner/repo`,
      ErrorCode.INVALID_REPOSITORY,
      {repository: inputs.repository}
    )
  }

  // Validate ref if provided
  if (inputs.ref && !REGEX_PATTERNS.GIT_REF.test(inputs.ref)) {
    throw createActionError(
      `Invalid ref format: ${inputs.ref}`,
      ErrorCode.INVALID_REF,
      {ref: inputs.ref}
    )
  }

  // Validate token
  if (!inputs.token) {
    throw createActionError(
      'GitHub token is required',
      ErrorCode.INVALID_TOKEN,
      {hasToken: !!inputs.token}
    )
  }

  // Validate path
  if (!inputs.path || inputs.path.includes('..')) {
    throw createActionError(
      `Invalid path: ${inputs.path}`,
      ErrorCode.INVALID_PATH,
      {path: inputs.path}
    )
  }

  // Validate mirror URL if provided
  if (inputs.mirrorUrl && !REGEX_PATTERNS.URL.test(inputs.mirrorUrl)) {
    throw createActionError(
      `Invalid mirror URL: ${inputs.mirrorUrl}`,
      ErrorCode.MIRROR_ERROR,
      {mirrorUrl: inputs.mirrorUrl}
    )
  }

  // Validate numeric inputs
  if (inputs.mirrorTimeout <= 0 || inputs.mirrorTimeout > 300) {
    throw createActionError(
      `Invalid mirror timeout: ${inputs.mirrorTimeout}. Must be between 1 and 300 seconds`,
      ErrorCode.INVALID_PATH,
      {mirrorTimeout: inputs.mirrorTimeout}
    )
  }

  if (inputs.retryAttempts < 0 || inputs.retryAttempts > 10) {
    throw createActionError(
      `Invalid retry attempts: ${inputs.retryAttempts}. Must be between 0 and 10`,
      ErrorCode.INVALID_PATH,
      {retryAttempts: inputs.retryAttempts}
    )
  }

  if (inputs.fetchDepth < 0) {
    throw createActionError(
      `Invalid fetch depth: ${inputs.fetchDepth}. Must be 0 or positive`,
      ErrorCode.INVALID_PATH,
      {fetchDepth: inputs.fetchDepth}
    )
  }
}

/**
 * Get environment configuration
 */
export function getEnvironmentConfig(): Record<string, string> {
  return {
    GITHUB_REPOSITORY: process.env['GITHUB_REPOSITORY'] || '',
    GITHUB_REF: process.env['GITHUB_REF'] || '',
    GITHUB_SHA: process.env['GITHUB_SHA'] || '',
    GITHUB_TOKEN: process.env['GITHUB_TOKEN'] || '',
    GITHUB_WORKSPACE: process.env['GITHUB_WORKSPACE'] || '',
    RUNNER_TEMP: process.env['RUNNER_TEMP'] || '',
    RUNNER_TOOL_CACHE: process.env['RUNNER_TOOL_CACHE'] || '',
    NODE_VERSION: process.version,
    PLATFORM: process.platform,
    ARCH: process.arch
  }
}

// === Helper Functions ===

/**
 * Get string input with fallback
 */
function getInput(name: string, fallback = ''): string {
  try {
    return core.getInput(name) || fallback
  } catch {
    return fallback
  }
}

/**
 * Get boolean input with fallback
 */
function getBooleanInput(name: string, fallback = false): boolean {
  try {
    const value = core.getInput(name)
    if (!value) return fallback
    
    const normalized = value.toLowerCase().trim()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  } catch {
    return fallback
  }
}

/**
 * Get number input with fallback
 */
function getNumberInput(name: string, fallback = 0): number {
  try {
    const value = core.getInput(name)
    if (!value) return fallback
    
    const parsed = parseInt(value, 10)
    return isNaN(parsed) ? fallback : parsed
  } catch {
    return fallback
  }
}

/**
 * Get download method input with validation
 */
function getDownloadMethodInput(name: string, fallback: DownloadMethod): DownloadMethod {
  try {
    const value = core.getInput(name)
    if (!value) return fallback
    
    const normalized = value.toLowerCase().trim() as DownloadMethod
    if (Object.values(DownloadMethod).includes(normalized)) {
      return normalized
    }
    
    core.warning(`Invalid download method: ${value}. Using fallback: ${fallback}`)
    return fallback
  } catch {
    return fallback
  }
}