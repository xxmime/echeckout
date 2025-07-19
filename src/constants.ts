/**
 * Constants and configuration for Accelerated GitHub Checkout Action
 */

import {DownloadMethod, MirrorService} from './types'

// === Built-in Mirror Services ===

export const BUILTIN_MIRROR_SERVICES: MirrorService[] = [
  {
    name: 'TVV.TW',
    url: 'https://tvv.tw',
    description: 'TVV.TW GitHub acceleration service',
    priority: 1,
    enabled: true,
    healthCheckUrl: 'https://tvv.tw/https://raw.githubusercontent.com/actions/checkout/main/README.md',
    speedTestUrl: 'https://tvv.tw/https://github.com/actions/checkout/archive/refs/heads/main.zip',
    timeout: 30,
    retryAttempts: 3,
    supportedMethods: [DownloadMethod.MIRROR],
    regions: ['CN', 'AS'],
    metadata: {
      provider: 'tvv.tw',
      type: 'proxy',
      requiresFullUrl: true
    }
  },
  {
    name: 'GHProxy',
    url: 'https://ghproxy.com',
    description: 'Fast GitHub proxy service',
    priority: 2,
    enabled: true,
    healthCheckUrl: 'https://ghproxy.com',
    speedTestUrl: 'https://ghproxy.com/https://github.com/actions/checkout/archive/refs/heads/main.zip',
    timeout: 30,
    retryAttempts: 2,
    supportedMethods: [DownloadMethod.MIRROR],
    regions: ['CN', 'AS'],
    metadata: {
      provider: 'ghproxy.com',
      type: 'proxy'
    }
  },
  {
    name: 'GitHub Proxy',
    url: 'https://github.moeyy.xyz',
    description: 'Alternative GitHub proxy service',
    priority: 2,
    enabled: true,
    healthCheckUrl: 'https://github.moeyy.xyz',
    speedTestUrl: 'https://github.moeyy.xyz/https://github.com/actions/checkout/archive/refs/heads/main.zip',
    timeout: 30,
    retryAttempts: 2,
    supportedMethods: [DownloadMethod.MIRROR],
    regions: ['CN', 'AS'],
    metadata: {
      provider: 'moeyy.xyz',
      type: 'proxy'
    }
  },
  {
    name: 'FastGit',
    url: 'https://download.fastgit.org',
    description: 'FastGit download service',
    priority: 3,
    enabled: true,
    healthCheckUrl: 'https://download.fastgit.org',
    speedTestUrl: 'https://download.fastgit.org/actions/checkout/archive/refs/heads/main.zip',
    timeout: 30,
    retryAttempts: 2,
    supportedMethods: [DownloadMethod.MIRROR],
    regions: ['CN', 'AS'],
    metadata: {
      provider: 'fastgit.org',
      type: 'mirror'
    }
  },
  {
    name: 'GitHub Direct',
    url: 'https://github.com',
    description: 'Direct GitHub download',
    priority: 10,
    enabled: true,
    healthCheckUrl: 'https://github.com',
    speedTestUrl: 'https://github.com/actions/checkout/archive/refs/heads/main.zip',
    timeout: 60,
    retryAttempts: 3,
    supportedMethods: [DownloadMethod.DIRECT, DownloadMethod.GIT],
    regions: ['*'],
    metadata: {
      provider: 'github.com',
      type: 'direct'
    }
  }
]

// === Default Configuration ===

export const DEFAULT_CONFIG = {
  // Timeouts (in seconds)
  MIRROR_TIMEOUT: 30,
  DIRECT_TIMEOUT: 60,
  GIT_TIMEOUT: 120,
  HEALTH_CHECK_TIMEOUT: 10,
  SPEED_TEST_TIMEOUT: 15,

  // Retry configuration
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY_BASE: 1000, // ms
  RETRY_DELAY_MAX: 10000, // ms

  // Speed test configuration
  SPEED_TEST_SIZE: 1024 * 1024, // 1MB
  SPEED_TEST_DURATION: 10, // seconds
  MIN_SPEED_THRESHOLD: 0.1, // MB/s

  // Performance thresholds
  FAST_SPEED_THRESHOLD: 5.0, // MB/s
  SLOW_SPEED_THRESHOLD: 1.0, // MB/s
  HIGH_LATENCY_THRESHOLD: 1000, // ms

  // File system
  DEFAULT_FETCH_DEPTH: 1,
  MAX_DOWNLOAD_SIZE: 1024 * 1024 * 1024, // 1GB

  // Monitoring
  PERFORMANCE_SAMPLE_INTERVAL: 1000, // ms
  MAX_LOG_ENTRIES: 1000
} as const

// === Error Messages ===

export const ERROR_MESSAGES = {
  INVALID_REPOSITORY: 'Invalid repository format. Expected format: owner/repo',
  INVALID_REF: 'Invalid ref specified',
  INVALID_TOKEN: 'Invalid or missing GitHub token',
  INVALID_PATH: 'Invalid path specified',
  
  NETWORK_ERROR: 'Network error occurred during download',
  TIMEOUT_ERROR: 'Download operation timed out',
  DNS_ERROR: 'DNS resolution failed',
  CONNECTION_ERROR: 'Failed to establish connection',
  
  MIRROR_UNAVAILABLE: 'Mirror service is unavailable',
  MIRROR_TIMEOUT: 'Mirror service request timed out',
  MIRROR_ERROR: 'Mirror service returned an error',
  NO_MIRRORS_AVAILABLE: 'No mirror services are available',
  
  DOWNLOAD_FAILED: 'Download operation failed',
  EXTRACTION_FAILED: 'Failed to extract downloaded archive',
  VERIFICATION_FAILED: 'Downloaded content verification failed',
  DISK_SPACE_ERROR: 'Insufficient disk space',
  
  GIT_CLONE_FAILED: 'Git clone operation failed',
  GIT_CHECKOUT_FAILED: 'Git checkout operation failed',
  GIT_AUTH_FAILED: 'Git authentication failed',
  
  GITHUB_API_ERROR: 'GitHub API error',
  GITHUB_RATE_LIMIT: 'GitHub API rate limit exceeded',
  REPOSITORY_NOT_FOUND: 'Repository not found or access denied',
  UNAUTHORIZED: 'Unauthorized access to repository',
  
  PERMISSION_DENIED: 'Permission denied',
  FILE_SYSTEM_ERROR: 'File system error',
  UNKNOWN_ERROR: 'An unknown error occurred'
} as const

// === URL Patterns ===

export const URL_PATTERNS = {
  GITHUB_REPO: /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\/.*)?$/,
  GITHUB_ARCHIVE: /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/archive\/(.+)\.zip$/,
  GITHUB_API: /^https?:\/\/api\.github\.com\/repos\/([^\/]+)\/([^\/]+)(?:\/.*)?$/
} as const

// === HTTP Headers ===

export const HTTP_HEADERS = {
  USER_AGENT: 'accelerated-github-checkout/1.0.0',
  ACCEPT: 'application/vnd.github.v3+json',
  ACCEPT_ENCODING: 'gzip, deflate',
  CONNECTION: 'keep-alive'
} as const

// === File Extensions ===

export const SUPPORTED_ARCHIVE_FORMATS = [
  '.zip',
  '.tar.gz',
  '.tgz',
  '.tar'
] as const

// === Environment Variables ===

export const ENV_VARS = {
  GITHUB_TOKEN: 'GITHUB_TOKEN',
  GITHUB_REPOSITORY: 'GITHUB_REPOSITORY',
  GITHUB_REF: 'GITHUB_REF',
  GITHUB_SHA: 'GITHUB_SHA',
  GITHUB_WORKSPACE: 'GITHUB_WORKSPACE',
  RUNNER_TEMP: 'RUNNER_TEMP',
  RUNNER_TOOL_CACHE: 'RUNNER_TOOL_CACHE'
} as const

// === Action Input Names ===

export const INPUT_NAMES = {
  REPOSITORY: 'repository',
  REF: 'ref',
  TOKEN: 'token',
  PATH: 'path',
  ENABLE_ACCELERATION: 'enable-acceleration',
  MIRROR_URL: 'mirror-url',
  GITHUB_PROXY_URL: 'github-proxy-url', // Alias for mirror-url
  AUTO_SELECT_MIRROR: 'auto-select-mirror',
  MIRROR_TIMEOUT: 'mirror-timeout',
  FALLBACK_ENABLED: 'fallback-enabled',
  DOWNLOAD_METHOD: 'download-method',
  RETRY_ATTEMPTS: 'retry-attempts',
  SPEED_TEST: 'speed-test',
  FETCH_DEPTH: 'fetch-depth',
  CLEAN: 'clean',
  VERBOSE: 'verbose',
  PERFORMANCE_MONITORING: 'performance-monitoring'
} as const

// === Action Output Names ===

export const OUTPUT_NAMES = {
  REF: 'ref',
  COMMIT: 'commit',
  DOWNLOAD_METHOD: 'download-method',
  MIRROR_USED: 'mirror-used',
  DOWNLOAD_TIME: 'download-time',
  DOWNLOAD_SPEED: 'download-speed',
  DOWNLOAD_SIZE: 'download-size',
  MIRROR_SELECTION_TIME: 'mirror-selection-time',
  SUCCESS_RATE: 'success-rate',
  SUCCESS: 'success',
  FALLBACK_USED: 'fallback-used',
  MIRRORS_TESTED: 'mirrors-tested',
  ERROR_MESSAGE: 'error-message',
  ERROR_CODE: 'error-code'
} as const

// === Regular Expressions ===

export const REGEX_PATTERNS = {
  REPOSITORY_NAME: /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/,
  GIT_REF: /^[a-zA-Z0-9._/-]+$/,
  SHA: /^[a-f0-9]{40}$/,
  SHORT_SHA: /^[a-f0-9]{7,40}$/,
  SEMANTIC_VERSION: /^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/,
  URL: /^https?:\/\/[^\s/$.?#].[^\s]*$/
} as const