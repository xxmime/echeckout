/**
 * Tests for proxy authentication handling
 */

import {DownloadExecutor} from '../download/download-executor'
import {DownloadMethod, CheckoutOptions, MirrorService} from '../types'

// Mock axios
jest.mock('axios')
const mockAxios = require('axios')

// Mock other dependencies
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
  createWriteStream: jest.fn(),
  statSync: jest.fn(() => ({ size: 1024 })),
  existsSync: jest.fn(() => false),
  readdirSync: jest.fn(() => ['repo-main'])
}))
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  dirname: jest.fn(() => '/tmp')
}))

describe('Proxy Authentication', () => {
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

    downloadExecutor = new DownloadExecutor(mockOptions)
  })

  describe('URL parsing with authentication', () => {
    it('should parse proxy URL with credentials', () => {
      const mirrorService: MirrorService = {
        name: 'Test Proxy',
        url: 'https://username:password@proxy.example.com',
        description: 'Test proxy with auth',
        priority: 1,
        enabled: true,
        timeout: 30,
        retryAttempts: 2,
        supportedMethods: [DownloadMethod.MIRROR],
        regions: ['*']
      }

      // Access private method for testing
      const parseMirrorUrl = (downloadExecutor as any).parseMirrorUrl.bind(downloadExecutor)
      const result = parseMirrorUrl(mirrorService.url)

      expect(result.auth).toEqual({
        username: 'username',
        password: 'password'
      })
      expect(result.baseUrl).toBe('https://proxy.example.com')
      expect(result.hostname).toBe('proxy.example.com')
    })

    it('should handle URL without credentials', () => {
      const mirrorService: MirrorService = {
        name: 'Test Proxy',
        url: 'https://proxy.example.com',
        description: 'Test proxy without auth',
        priority: 1,
        enabled: true,
        timeout: 30,
        retryAttempts: 2,
        supportedMethods: [DownloadMethod.MIRROR],
        regions: ['*']
      }

      const parseMirrorUrl = (downloadExecutor as any).parseMirrorUrl.bind(downloadExecutor)
      const result = parseMirrorUrl(mirrorService.url)

      expect(result.auth).toBeUndefined()
      expect(result.baseUrl).toBe('https://proxy.example.com')
      expect(result.hostname).toBe('proxy.example.com')
    })

    it('should sanitize URLs for logging', () => {
      const sanitizeUrl = (downloadExecutor as any).sanitizeUrl.bind(downloadExecutor)
      
      const urlWithAuth = 'https://user:pass@proxy.example.com/path'
      const sanitized = sanitizeUrl(urlWithAuth)
      
      expect(sanitized).toBe('https://proxy.example.com/path')
      expect(sanitized).not.toContain('user')
      expect(sanitized).not.toContain('pass')
    })

    it('should handle invalid URLs gracefully', () => {
      const sanitizeUrl = (downloadExecutor as any).sanitizeUrl.bind(downloadExecutor)
      
      const invalidUrl = 'not-a-valid-url'
      const sanitized = sanitizeUrl(invalidUrl)
      
      expect(sanitized).toBe('[INVALID_URL]')
    })
  })

  describe('Download with proxy authentication', () => {
    it('should configure axios with proxy auth when credentials are present', async () => {
      const mockResponse = {
        data: {
          pipe: jest.fn()
        }
      }
      mockAxios.get.mockResolvedValue(mockResponse)

      // Mock fs.createWriteStream
      const mockWriter = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(callback, 0) // Simulate async completion
          }
        })
      }
      require('fs').createWriteStream = jest.fn().mockReturnValue(mockWriter)

      const downloadArchive = (downloadExecutor as any).downloadArchive.bind(downloadExecutor)
      const urlWithAuth = 'https://user:pass@proxy.example.com/github.com/owner/repo/archive/main.zip'
      
      await downloadArchive(urlWithAuth, 30)

      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://proxy.example.com/github.com/owner/repo/archive/main.zip',
        expect.objectContaining({
          auth: {
            username: 'user',
            password: 'pass'
          }
        })
      )
    })

    it('should not add auth config when no credentials are present', async () => {
      const mockResponse = {
        data: {
          pipe: jest.fn()
        }
      }
      mockAxios.get.mockResolvedValue(mockResponse)

      const mockWriter = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(callback, 0)
          }
        })
      }
      require('fs').createWriteStream = jest.fn().mockReturnValue(mockWriter)

      const downloadArchive = (downloadExecutor as any).downloadArchive.bind(downloadExecutor)
      const urlWithoutAuth = 'https://proxy.example.com/github.com/owner/repo/archive/main.zip'
      
      await downloadArchive(urlWithoutAuth, 30)

      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://proxy.example.com/github.com/owner/repo/archive/main.zip',
        expect.not.objectContaining({
          auth: expect.anything()
        })
      )
    })
  })
})