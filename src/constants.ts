/**
 * Constants and configuration for Accelerated GitHub Checkout Action
 */

// Constants for Accelerated GitHub Checkout Action

// === Default Configuration ===

export const DEFAULT_CONFIG = {
  // Timeouts (in seconds)
  MIRROR_TIMEOUT: 30,
  DIRECT_TIMEOUT: 60,
  GIT_TIMEOUT: 120,
  // Retry configuration
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY_BASE: 1000, // ms
  RETRY_DELAY_MAX: 10000, // ms

  // File system
  DEFAULT_FETCH_DEPTH: 1
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

// === HTTP Headers ===

export const HTTP_HEADERS = {
  USER_AGENT: 'accelerated-github-checkout/1.0.0',
  ACCEPT: 'application/vnd.github.v3+json',
  ACCEPT_ENCODING: 'gzip, deflate',
  CONNECTION: 'keep-alive'
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
  MIRROR_TIMEOUT: 'mirror-timeout',
  FALLBACK_ENABLED: 'fallback-enabled',
  DOWNLOAD_METHOD: 'download-method',
  RETRY_ATTEMPTS: 'retry-attempts',
  FETCH_DEPTH: 'fetch-depth',
  CLEAN: 'clean',
  VERBOSE: 'verbose',
  // performance-monitoring removed
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