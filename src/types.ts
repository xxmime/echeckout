/**
 * Core type definitions for Accelerated GitHub Checkout Action
 */

// === Action Input/Output Types ===

export interface ActionInputs {
  // Basic configuration
  repository: string
  ref: string
  token: string
  path: string

  // Proxy acceleration configuration
  enableAcceleration: boolean
  mirrorUrl: string
  autoSelectMirror: boolean
  mirrorTimeout: number
  fallbackEnabled: boolean

  // Download strategy
  downloadMethod: DownloadMethod
  retryAttempts: number
  speedTest: boolean

  // Advanced configuration
  fetchDepth: number
  clean: boolean

  // Debug and monitoring
  verbose: boolean
  performanceMonitoring: boolean
}

export interface ActionOutputs {
  // Basic outputs
  ref: string
  commit: string

  // Download information
  downloadMethod: DownloadMethod
  mirrorUsed: string
  downloadTime: number
  downloadSpeed: number
  downloadSize: number

  // Performance metrics
  mirrorSelectionTime: number
  successRate: number

  // Status information
  success: boolean
  fallbackUsed: boolean
  mirrorsTested: number

  // Error information
  errorMessage: string
  errorCode: string
}

// === Mirror Service Types ===

export interface MirrorService {
  name: string
  url: string
  description: string
  priority: number
  enabled: boolean
  timeout: number
  retryAttempts: number
  supportedMethods: DownloadMethod[]
  regions: string[]
  metadata?: Record<string, unknown>
}

// === Download Types ===

export interface DownloadResult {
  success: boolean
  method: DownloadMethod
  mirrorUsed: string | undefined
  downloadTime: number
  downloadSpeed: number
  downloadSize: number
  commit: string | undefined
  ref: string | undefined
  errorMessage: string | undefined
  errorCode: ErrorCode | undefined
  retryCount: number
  fallbackUsed: boolean
}

export interface CheckoutOptions {
  repository: string
  ref: string
  token: string
  path: string
  fetchDepth: number
  clean: boolean
  timeout: number
  retryAttempts: number
}

// === Network and Performance Types ===

export interface NetworkInfo {
  region: string
  country: string
  isp: string
  connectionType: string
  estimatedBandwidth: number // Mbps
  latencyToGitHub: number // ms
}

export interface PerformanceMetrics {
  totalTime: number
  mirrorSelectionTime: number
  downloadTime: number
  extractionTime: number
  cleanupTime: number
  memoryUsage: number
  cpuUsage: number
}

// === Error Types ===

export interface ActionError extends Error {
  code: ErrorCode
  details: Record<string, unknown> | undefined
  retryable: boolean
  originalError: Error | undefined
}

// === Enums ===

export enum DownloadMethod {
  AUTO = 'auto',
  MIRROR = 'mirror',
  DIRECT = 'direct',
  GIT = 'git'
}

export enum ErrorCode {
  // Input validation errors
  INVALID_REPOSITORY = 'INVALID_REPOSITORY',
  INVALID_REF = 'INVALID_REF',
  INVALID_TOKEN = 'INVALID_TOKEN',
  INVALID_PATH = 'INVALID_PATH',

  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  DNS_ERROR = 'DNS_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',

  // Mirror service errors
  MIRROR_UNAVAILABLE = 'MIRROR_UNAVAILABLE',
  MIRROR_TIMEOUT = 'MIRROR_TIMEOUT',
  MIRROR_ERROR = 'MIRROR_ERROR',
  NO_MIRRORS_AVAILABLE = 'NO_MIRRORS_AVAILABLE',

  // Download errors
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
  DISK_SPACE_ERROR = 'DISK_SPACE_ERROR',

  // Git errors
  GIT_CLONE_FAILED = 'GIT_CLONE_FAILED',
  GIT_CHECKOUT_FAILED = 'GIT_CHECKOUT_FAILED',
  GIT_AUTH_FAILED = 'GIT_AUTH_FAILED',

  // GitHub API errors
  GITHUB_API_ERROR = 'GITHUB_API_ERROR',
  GITHUB_RATE_LIMIT = 'GITHUB_RATE_LIMIT',
  REPOSITORY_NOT_FOUND = 'REPOSITORY_NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',

  // System errors
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  FILE_SYSTEM_ERROR = 'FILE_SYSTEM_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

// === Utility Types ===

export type Awaitable<T> = T | Promise<T>

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

export type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K
}[keyof T]

export type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never
}[keyof T]