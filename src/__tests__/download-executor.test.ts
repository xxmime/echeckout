/**
 * Tests for download executor
 */

import {DownloadExecutor} from '../download/download-executor'
import {CheckoutOptions, DownloadMethod, MirrorService} from '../types'

// Mock dependencies
jest.mock('axios')
jest.mock('@actions/exec', () => ({
  exec: jest.fn()
}))
jest.mock('@actions/io', () => ({
  rmRF: jest.fn(),
  mkdirP: jest.fn(),
  cp: jest.fn()
}))
jest.mock('@actions/tool-cache', () => ({
  extractZip: jest.fn()
}))
jest.mock('fs', () => ({
  createWriteStream: jest.fn(() => ({
    on: jest.fn((event, callback) => {
      if (event === 'finish') {
        setTimeout(callback, 0)
      }
    })
  })),
  statSync: jest.fn(() => ({ size: 1024 })),
  existsSync: jest.fn(() => false),
  readdirSync: jest.fn(() => ['repo-main'])
}))
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  dirname: jest.fn(() => '/tmp')
}))

// Mock logger
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    group: jest.fn(),
    endGroup: jest.fn()
  }
}))

describe('DownloadExecutor', () => {
  let downloadExecutor: DownloadExecutor
  let mockOptions: CheckoutOptions

  beforeEach(() => {
    jest.clearAllMocks()
    
    mockOptions = {
      repository: 'owner/repo',
      ref: 'main',
      token: 'test-token',
      path: './test',
      fetchDepth: 1,
      clean: true,
      timeout: 30,
      retryAttempts: 3
    }
  })

  describe('buildDirectDownloadUrl with github-proxy-url', () => {
    it('should embed github-proxy-url in download URL when configured', () => {
      const inputOptions = {
        githubProxyUrl: 'https://tvv.tw'
      }
      
      downloadExecutor = new DownloadExecutor(mockOptions, inputOptions)
      
      // Access private method for testing
      const buildDirectDownloadUrl = (downloadExecutor as any).buildDirectDownloadUrl.bind(downloadExecutor)
      
      const result = buildDirectDownloadUrl()
      
      // Should return proxy URL format: proxy_url/github_url with embedded credentials
      expect(result).toBe('https://git:test-token@tvv.tw/https://github.com/owner/repo/archive/main.zip')
    })

    it('should extract username and password from github-proxy-url when present', () => {
      const inputOptions = {
        githubProxyUrl: 'https://customuser:custompass@tvv.tw'
      }
      
      downloadExecutor = new DownloadExecutor(mockOptions, inputOptions)
      
      // Access private method for testing
      const buildDirectDownloadUrl = (downloadExecutor as any).buildDirectDownloadUrl.bind(downloadExecutor)
      
      const result = buildDirectDownloadUrl()
      
      // Should use extracted username and password from proxy URL
      expect(result).toBe('https://customuser:custompass@tvv.tw/https://github.com/owner/repo/archive/main.zip')
    })

    it('should fallback to git username and GitHub token when no credentials in github-proxy-url', () => {
      const inputOptions = {
        githubProxyUrl: 'https://tvv.tw'
      }
      
      downloadExecutor = new DownloadExecutor(mockOptions, inputOptions)
      
      // Access private method for testing
      const buildDirectDownloadUrl = (downloadExecutor as any).buildDirectDownloadUrl.bind(downloadExecutor)
      
      const result = buildDirectDownloadUrl()
      
      // Should fallback to 'git' username and GitHub token
      expect(result).toBe('https://git:test-token@tvv.tw/https://github.com/owner/repo/archive/main.zip')
    })

    it('should use extracted username with GitHub token when only username in github-proxy-url', () => {
      const inputOptions = {
        githubProxyUrl: 'https://customuser@tvv.tw'
      }
      
      downloadExecutor = new DownloadExecutor(mockOptions, inputOptions)
      
      // Access private method for testing
      const buildDirectDownloadUrl = (downloadExecutor as any).buildDirectDownloadUrl.bind(downloadExecutor)
      
      const result = buildDirectDownloadUrl()
      
      // Should use extracted username with GitHub token
      expect(result).toBe('https://customuser:test-token@tvv.tw/https://github.com/owner/repo/archive/main.zip')
    })

    it('should use direct GitHub URL when github-proxy-url is not configured', () => {
      downloadExecutor = new DownloadExecutor(mockOptions)
      
      // Access private method for testing
      const buildDirectDownloadUrl = (downloadExecutor as any).buildDirectDownloadUrl.bind(downloadExecutor)
      
      const result = buildDirectDownloadUrl()
      
      // Should return direct GitHub URL with token
      expect(result).toBe('https://git:test-token@github.com/owner/repo/archive/main.zip')
    })

    it('should handle github-proxy-url with trailing slash', () => {
      const inputOptions = {
        githubProxyUrl: 'https://tvv.tw/'
      }
      
      downloadExecutor = new DownloadExecutor(mockOptions, inputOptions)
      
      // Access private method for testing
      const buildDirectDownloadUrl = (downloadExecutor as any).buildDirectDownloadUrl.bind(downloadExecutor)
      
      const result = buildDirectDownloadUrl()
      
      // Should remove trailing slash and return clean URL with credentials
      expect(result).toBe('https://git:test-token@tvv.tw/https://github.com/owner/repo/archive/main.zip')
    })

    it('should handle github-proxy-url without token', () => {
      const optionsWithoutToken = {
        ...mockOptions,
        token: '' // No token
      }
      const inputOptions = {
        githubProxyUrl: 'https://tvv.tw'
      }
      
      downloadExecutor = new DownloadExecutor(optionsWithoutToken, inputOptions)
      
      // Access private method for testing
      const buildDirectDownloadUrl = (downloadExecutor as any).buildDirectDownloadUrl.bind(downloadExecutor)
      
      const result = buildDirectDownloadUrl()
      
      // Should return proxy URL without credentials
      expect(result).toBe('https://tvv.tw/https://github.com/owner/repo/archive/main.zip')
    })
  })

  describe('downloadArchive with github-proxy-url', () => {
    it('should log github-proxy-url when configured', async () => {
      const inputOptions = {
        githubProxyUrl: 'https://proxy.example.com'
      }
      
      downloadExecutor = new DownloadExecutor(mockOptions, inputOptions)
      
      // Mock axios response
      const mockAxios = require('axios')
      const mockResponse = {
        data: {
          pipe: jest.fn()
        },
        headers: {
          'content-type': 'application/zip'
        }
      }
      mockAxios.get.mockResolvedValue(mockResponse)

      // Access private method for testing
      const downloadArchive = (downloadExecutor as any).downloadArchive.bind(downloadExecutor)
      
      await downloadArchive('https://github.com/owner/repo/archive/main.zip', 30)

      // Verify that github-proxy-url was logged
      const {logger} = require('../utils/logger')
      expect(logger.info).toHaveBeenCalledWith(
        'Downloading archive with credentials',
        expect.objectContaining({
          githubProxyUrl: 'https://proxy.example.com'
        })
      )
    })

    it('should log "not configured" when github-proxy-url is not set', async () => {
      downloadExecutor = new DownloadExecutor(mockOptions)
      
      // Mock axios response
      const mockAxios = require('axios')
      const mockResponse = {
        data: {
          pipe: jest.fn()
        },
        headers: {
          'content-type': 'application/zip'
        }
      }
      mockAxios.get.mockResolvedValue(mockResponse)

      // Access private method for testing
      const downloadArchive = (downloadExecutor as any).downloadArchive.bind(downloadExecutor)
      
      await downloadArchive('https://github.com/owner/repo/archive/main.zip', 30)

      // Verify that "not configured" was logged
      const {logger} = require('../utils/logger')
      expect(logger.info).toHaveBeenCalledWith(
        'Downloading archive with credentials',
        expect.objectContaining({
          githubProxyUrl: 'not configured'
        })
      )
    })
  })
}) 

describe('DownloadExecutor - Enhanced Logging', () => {
  it('should log detailed mirror download process', async () => {
    const mockLogger = {
      group: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      endGroup: jest.fn()
    }
    
    // Mock logger
    jest.spyOn(require('../utils/logger'), 'logger').mockReturnValue(mockLogger)
    
    const executor = new DownloadExecutor(mockOptions)
    const mockMirrorService = {
      name: 'Test Mirror',
      url: 'https://test-mirror.com',
      timeout: 30,
      metadata: { provider: 'test' }
    }
    
    // Mock successful download
    jest.spyOn(executor as any, 'downloadArchive').mockResolvedValue('/tmp/test.zip')
    jest.spyOn(executor as any, 'extractArchive').mockResolvedValue('/tmp/extracted')
    jest.spyOn(executor as any, 'moveToTarget').mockResolvedValue()
    jest.spyOn(executor as any, 'getCommitInfo').mockResolvedValue('abc123')
    jest.spyOn(executor as any, 'buildMirrorDownloadUrl').mockReturnValue('https://test-mirror.com/test')
    
    await executor.executeDownload(DownloadMethod.MIRROR, mockMirrorService)
    
    // Verify detailed logging
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Starting archive download via mirror',
      expect.objectContaining({
        mirror: 'Test Mirror',
        url: expect.any(String)
      })
    )
    
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Archive download completed, starting extraction',
      expect.objectContaining({
        archivePath: '/tmp/test.zip',
        mirror: 'Test Mirror'
      })
    )
  })
  
  it('should log detailed error information on mirror download failure', async () => {
    const mockLogger = {
      group: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      endGroup: jest.fn()
    }
    
    jest.spyOn(require('../utils/logger'), 'logger').mockReturnValue(mockLogger)
    
    const executor = new DownloadExecutor(mockOptions)
    const mockMirrorService = {
      name: 'Test Mirror',
      url: 'https://test-mirror.com',
      timeout: 30
    }
    
    // Mock download failure
    const testError = new Error('Connection timeout')
    jest.spyOn(executor as any, 'downloadArchive').mockRejectedValue(testError)
    jest.spyOn(executor as any, 'buildMirrorDownloadUrl').mockReturnValue('https://test-mirror.com/test')
    
    try {
      await executor.executeDownload(DownloadMethod.MIRROR, mockMirrorService)
    } catch (error) {
      // Expected to throw
    }
    
    // Verify detailed error logging
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Mirror download failed',
      expect.objectContaining({
        mirror: 'Test Mirror',
        repository: 'test/repo',
        error: 'Connection timeout',
        errorStack: expect.any(String)
      })
    )
  })
}) 