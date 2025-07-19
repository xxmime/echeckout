/**
 * Tests for input parser
 */

import {parseInputs, validateInputs} from '../input/input-parser'
import {DownloadMethod} from '../types'

// Mock @actions/core
jest.mock('@actions/core', () => ({
  getInput: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn()
}))

describe('Input Parser', () => {
  const mockGetInput = require('@actions/core').getInput as jest.MockedFunction<typeof import('@actions/core').getInput>

  beforeEach(() => {
    jest.clearAllMocks()
    // Set default environment variables
    process.env['GITHUB_REPOSITORY'] = 'owner/repo'
    process.env['GITHUB_REF'] = 'refs/heads/main'
    process.env['GITHUB_TOKEN'] = 'test-token'
  })

  afterEach(() => {
    // Clean up environment variables
    delete process.env['GITHUB_REPOSITORY']
    delete process.env['GITHUB_REF']
    delete process.env['GITHUB_TOKEN']
  })

  describe('parseInputs', () => {
    it('should parse inputs with default values', () => {
      mockGetInput.mockReturnValue('')

      const inputs = parseInputs()

      expect(inputs.repository).toBe('owner/repo')
      expect(inputs.ref).toBe('refs/heads/main')
      expect(inputs.token).toBe('test-token')
      expect(inputs.path).toBe('.')
      expect(inputs.enableAcceleration).toBe(true)
      expect(inputs.downloadMethod).toBe(DownloadMethod.AUTO)
    })

    it('should parse custom inputs', () => {
      mockGetInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          'repository': 'custom/repo',
          'ref': 'feature-branch',
          'path': './src',
          'enable-acceleration': 'false',
          'download-method': 'direct',
          'verbose': 'true'
        }
        return inputs[name] || ''
      })

      const inputs = parseInputs()

      expect(inputs.repository).toBe('custom/repo')
      expect(inputs.ref).toBe('feature-branch')
      expect(inputs.path).toBe('./src')
      expect(inputs.enableAcceleration).toBe(false)
      expect(inputs.downloadMethod).toBe(DownloadMethod.DIRECT)
      expect(inputs.verbose).toBe(true)
    })
  })

  describe('validateInputs', () => {
    it('should validate valid inputs', () => {
      const validInputs = {
        repository: 'owner/repo',
        ref: 'main',
        token: 'test-token',
        path: './src',
        enableAcceleration: true,
        mirrorUrl: '',
        autoSelectMirror: true,
        mirrorTimeout: 30,
        fallbackEnabled: true,
        downloadMethod: DownloadMethod.AUTO,
        retryAttempts: 3,
        speedTest: true,
        fetchDepth: 1,
        clean: true,
        verbose: false,
        performanceMonitoring: true
      }

      expect(() => validateInputs(validInputs)).not.toThrow()
    })

    it('should throw error for invalid repository', () => {
      const invalidInputs = {
        repository: 'invalid-repo',
        ref: 'main',
        token: 'test-token',
        path: '.',
        enableAcceleration: true,
        mirrorUrl: '',
        autoSelectMirror: true,
        mirrorTimeout: 30,
        fallbackEnabled: true,
        downloadMethod: DownloadMethod.AUTO,
        retryAttempts: 3,
        speedTest: true,
        fetchDepth: 1,
        clean: true,
        verbose: false,
        performanceMonitoring: true
      }

      expect(() => validateInputs(invalidInputs)).toThrow()
    })

    it('should throw error for missing token', () => {
      const invalidInputs = {
        repository: 'owner/repo',
        ref: 'main',
        token: '',
        path: '.',
        enableAcceleration: true,
        mirrorUrl: '',
        autoSelectMirror: true,
        mirrorTimeout: 30,
        fallbackEnabled: true,
        downloadMethod: DownloadMethod.AUTO,
        retryAttempts: 3,
        speedTest: true,
        fetchDepth: 1,
        clean: true,
        verbose: false,
        performanceMonitoring: true
      }

      expect(() => validateInputs(invalidInputs)).toThrow()
    })

    it('should throw error for invalid path', () => {
      const invalidInputs = {
        repository: 'owner/repo',
        ref: 'main',
        token: 'test-token',
        path: '../invalid',
        enableAcceleration: true,
        mirrorUrl: '',
        autoSelectMirror: true,
        mirrorTimeout: 30,
        fallbackEnabled: true,
        downloadMethod: DownloadMethod.AUTO,
        retryAttempts: 3,
        speedTest: true,
        fetchDepth: 1,
        clean: true,
        verbose: false,
        performanceMonitoring: true
      }

      expect(() => validateInputs(invalidInputs)).toThrow()
    })
  })
})