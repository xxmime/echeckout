/**
 * Download execution engine
 */

// import * as core from '@actions/core' // Removed unused import
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import * as tc from '@actions/tool-cache'
import axios from 'axios'
import * as path from 'path'
import * as fs from 'fs'
import {
  DownloadResult,
  DownloadMethod,
  CheckoutOptions,
  MirrorService,
  ErrorCode
} from '../types'
import {DEFAULT_CONFIG, HTTP_HEADERS} from '../constants'
import {createActionError} from '../utils/error-utils'
import {logger} from '../utils/logger'

export class DownloadExecutor {
  private options: CheckoutOptions

  constructor(options: CheckoutOptions) {
    this.options = options
  }

  /**
   * Execute download using specified method
   */
  async executeDownload(
    method: DownloadMethod,
    mirrorService?: MirrorService
  ): Promise<DownloadResult> {
    logger.group(`Executing download using ${method} method`)
    
    const startTime = Date.now()
    let result: DownloadResult

    try {
      switch (method) {
        case DownloadMethod.MIRROR:
          if (!mirrorService) {
            throw createActionError(
              'Mirror service is required for mirror download',
              ErrorCode.MIRROR_ERROR
            )
          }
          result = await this.downloadViaMirror(mirrorService)
          break

        case DownloadMethod.DIRECT:
          result = await this.downloadDirect()
          break

        case DownloadMethod.GIT:
          result = await this.downloadViaGit()
          break

        default:
          throw createActionError(
            `Unsupported download method: ${method}`,
            ErrorCode.DOWNLOAD_FAILED
          )
      }

      const totalTime = (Date.now() - startTime) / 1000
      result.downloadTime = totalTime

      logger.info('Download completed successfully', {
        method: result.method,
        time: `${totalTime.toFixed(2)}s`,
        speed: `${result.downloadSpeed.toFixed(2)} MB/s`,
        size: `${(result.downloadSize / (1024 * 1024)).toFixed(2)} MB`
      })

      return result
    } catch (error) {
      const totalTime = (Date.now() - startTime) / 1000
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      logger.error('Download failed', {
        method,
        time: `${totalTime.toFixed(2)}s`,
        error: errorMessage
      })

      return {
        success: false,
        method,
        mirrorUsed: mirrorService?.url,
        downloadTime: totalTime,
        downloadSpeed: 0,
        downloadSize: 0,
        commit: undefined,
        ref: undefined,
        errorMessage,
        errorCode: error instanceof Error && 'code' in error ? error.code as ErrorCode : ErrorCode.DOWNLOAD_FAILED,
        retryCount: 0,
        fallbackUsed: false
      }
    } finally {
      logger.endGroup()
    }
  }

  /**
   * Download via mirror service
   */
  private async downloadViaMirror(mirrorService: MirrorService): Promise<DownloadResult> {
    logger.info('Starting mirror download', {
      mirror: mirrorService.name,
      url: mirrorService.url
    })

    const downloadUrl = this.buildMirrorDownloadUrl(mirrorService)
    const startTime = Date.now()

    try {
      // Download archive
      const archivePath = await this.downloadArchive(downloadUrl, mirrorService.timeout)
      
      // Extract archive
      const extractedPath = await this.extractArchive(archivePath)
      
      // Move to target location
      await this.moveToTarget(extractedPath)
      
      // Get commit info
      const commit = await this.getCommitInfo()

      const downloadTime = (Date.now() - startTime) / 1000
      const fileSize = fs.statSync(archivePath).size
      const downloadSpeed = (fileSize / (1024 * 1024)) / downloadTime

      // Cleanup
      await io.rmRF(archivePath)

      return {
        success: true,
        method: DownloadMethod.MIRROR,
        mirrorUsed: mirrorService.url,
        downloadTime,
        downloadSpeed,
        downloadSize: fileSize,
        commit,
        ref: this.options.ref,
        errorMessage: undefined,
        errorCode: undefined,
        retryCount: 0,
        fallbackUsed: false
      }
    } catch (error) {
      throw createActionError(
        `Mirror download failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.MIRROR_ERROR,
        {mirror: mirrorService.name, url: downloadUrl},
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Download directly from GitHub
   */
  private async downloadDirect(): Promise<DownloadResult> {
    logger.info('Starting direct download from GitHub')

    const downloadUrl = this.buildDirectDownloadUrl()
    const startTime = Date.now()

    try {
      // Download archive
      const archivePath = await this.downloadArchive(downloadUrl, DEFAULT_CONFIG.DIRECT_TIMEOUT)
      
      // Extract archive
      const extractedPath = await this.extractArchive(archivePath)
      
      // Move to target location
      await this.moveToTarget(extractedPath)
      
      // Get commit info
      const commit = await this.getCommitInfo()

      const downloadTime = (Date.now() - startTime) / 1000
      const fileSize = fs.statSync(archivePath).size
      const downloadSpeed = (fileSize / (1024 * 1024)) / downloadTime

      // Cleanup
      await io.rmRF(archivePath)

      return {
        success: true,
        method: DownloadMethod.DIRECT,
        mirrorUsed: undefined,
        downloadTime,
        downloadSpeed,
        downloadSize: fileSize,
        commit,
        ref: this.options.ref,
        errorMessage: undefined,
        errorCode: undefined,
        retryCount: 0,
        fallbackUsed: false
      }
    } catch (error) {
      throw createActionError(
        `Direct download failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.DOWNLOAD_FAILED,
        {url: downloadUrl},
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Download via Git clone
   */
  private async downloadViaGit(): Promise<DownloadResult> {
    logger.info('Starting Git clone')

    const startTime = Date.now()
    const gitUrl = `https://github.com/${this.options.repository}.git`

    try {
      // Prepare target directory
      await this.prepareTargetDirectory()

      // Build git clone command
      const args = ['clone']
      
      if (this.options.fetchDepth > 0) {
        args.push('--depth', this.options.fetchDepth.toString())
      }
      
      // Handle ref format for git clone
      let gitRef = this.options.ref
      if (gitRef && gitRef.startsWith('refs/heads/')) {
        gitRef = gitRef.replace('refs/heads/', '')
      }
      
      if (gitRef) {
        args.push('--branch', gitRef)
      }

      // Use a temporary directory for git clone when path is current directory
      const clonePath = this.options.path === '.' ? 'temp-clone' : this.options.path
      args.push(gitUrl, clonePath)

      // Execute git clone
      const exitCode = await exec.exec('git', args, {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0'
        }
      })

      if (exitCode !== 0) {
        throw new Error(`Git clone failed with exit code ${exitCode}`)
      }

      // If we cloned to a temporary directory, move contents to target
      if (clonePath !== this.options.path) {
        await this.moveClonedContent(clonePath, this.options.path)
      }

      // Get commit info
      const commit = await this.getCommitInfo()

      const downloadTime = (Date.now() - startTime) / 1000
      const dirSize = await this.getDirectorySize(this.options.path)
      const downloadSpeed = (dirSize / (1024 * 1024)) / downloadTime

      return {
        success: true,
        method: DownloadMethod.GIT,
        mirrorUsed: undefined,
        downloadTime,
        downloadSpeed,
        downloadSize: dirSize,
        commit,
        ref: this.options.ref,
        errorMessage: undefined,
        errorCode: undefined,
        retryCount: 0,
        fallbackUsed: false
      }
    } catch (error) {
      throw createActionError(
        `Git clone failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCode.GIT_CLONE_FAILED,
        {repository: this.options.repository, ref: this.options.ref},
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Build mirror download URL
   */
  private buildMirrorDownloadUrl(mirrorService: MirrorService): string {
    let ref = this.options.ref || 'main'
    
    // Handle different ref formats
    let archivePath = ''
    if (ref.startsWith('refs/heads/')) {
      const branch = ref.replace('refs/heads/', '')
      archivePath = `archive/refs/heads/${branch}.zip`
    } else if (ref.startsWith('refs/tags/')) {
      const tag = ref.replace('refs/tags/', '')
      archivePath = `archive/refs/tags/${tag}.zip`
    } else {
      // Assume it's a branch name
      archivePath = `archive/refs/heads/${ref}.zip`
    }
    
    const githubUrl = `https://github.com/${this.options.repository}/${archivePath}`
    
    // Parse mirror URL to handle authentication
    const mirrorUrl = this.parseMirrorUrl(mirrorService.url)
    
    // Handle different mirror service formats
    if (mirrorUrl.hostname.includes('ghproxy.com')) {
      const cleanBaseUrl = mirrorUrl.baseUrl.replace(/\/$/, '')
      return `${cleanBaseUrl}/${githubUrl}`
    } else if (mirrorUrl.hostname.includes('tvv.tw')) {
      // tvv.tw format: https://tvv.tw/https://github.com/...
      // Ensure no double slashes
      const cleanBaseUrl = mirrorUrl.baseUrl.replace(/\/$/, '')
      return `${cleanBaseUrl}/${githubUrl}`
    } else if (mirrorUrl.hostname.includes('fastgit.org')) {
      // FastGit format: https://download.fastgit.org/user/repo/archive/ref.zip
      const cleanBaseUrl = mirrorUrl.baseUrl.replace(/\/$/, '')
      return `${cleanBaseUrl}/${this.options.repository}/${archivePath}`
    } else {
      // Generic proxy format: proxy_url/github_url
      const cleanBaseUrl = mirrorUrl.baseUrl.replace(/\/$/, '')
      return `${cleanBaseUrl}/${githubUrl}`
    }
  }

  /**
   * Parse mirror URL and extract authentication info
   */
  private parseMirrorUrl(url: string): {
    baseUrl: string
    auth: {username: string; password: string} | undefined
    hostname: string
  } {
    try {
      const parsedUrl = new URL(url)
      
      let auth: {username: string; password: string} | undefined = undefined
      if (parsedUrl.username && parsedUrl.password) {
        auth = {
          username: parsedUrl.username,
          password: parsedUrl.password
        }
        
        // Remove auth from URL for logging purposes
        parsedUrl.username = ''
        parsedUrl.password = ''
      }
      
      return {
        baseUrl: parsedUrl.toString().replace(/\/$/, ''), // Remove trailing slash
        auth,
        hostname: parsedUrl.hostname
      }
    } catch (error) {
      logger.warn('Failed to parse mirror URL, using as-is', {url: this.sanitizeUrl(url)})
      return {
        baseUrl: url,
        auth: undefined,
        hostname: url
      }
    }
  }

  /**
   * Sanitize URL for logging (remove credentials)
   */
  private sanitizeUrl(url: string): string {
    try {
      const parsedUrl = new URL(url)
      if (parsedUrl.username || parsedUrl.password) {
        parsedUrl.username = ''
        parsedUrl.password = ''
        return parsedUrl.toString()
      }
      return url
    } catch {
      return '[INVALID_URL]'
    }
  }

  /**
   * Build direct download URL
   */
  private buildDirectDownloadUrl(): string {
    let ref = this.options.ref || 'main'
    
    // Handle different ref formats
    let archivePath = ''
    if (ref.startsWith('refs/heads/')) {
      const branch = ref.replace('refs/heads/', '')
      archivePath = `archive/refs/heads/${branch}.zip`
    } else if (ref.startsWith('refs/tags/')) {
      const tag = ref.replace('refs/tags/', '')
      archivePath = `archive/refs/tags/${tag}.zip`
    } else {
      // Assume it's a branch name
      archivePath = `archive/refs/heads/${ref}.zip`
    }
    
    return `https://github.com/${this.options.repository}/${archivePath}`
  }

  /**
   * Download archive file
   */
  private async downloadArchive(url: string, timeoutSeconds: number): Promise<string> {
    logger.debug('Downloading archive', {url: this.sanitizeUrl(url), timeout: timeoutSeconds})

    // Parse URL to extract authentication if present
    const parsedUrl = this.parseMirrorUrl(url)
    
    // Prepare axios config
    const axiosConfig: any = {
      responseType: 'stream',
      timeout: timeoutSeconds * 1000,
      headers: {
        ...HTTP_HEADERS
      },
      // Add redirect handling
      maxRedirects: 5,
      validateStatus: (status: number) => {
        // tvv.tw may return 302 redirects
        return status < 400 || status === 302
      }
    }

    // Add GitHub token for direct GitHub downloads (but not for proxy services)
    if (url.includes('github.com') && !url.includes('tvv.tw') && !url.includes('ghproxy.com')) {
      axiosConfig.headers.Authorization = `token ${this.options.token}`
    }

    // Add proxy authentication if present
    if (parsedUrl.auth) {
      axiosConfig.auth = {
        username: parsedUrl.auth.username,
        password: parsedUrl.auth.password
      }
      logger.debug('Using proxy authentication', {
        username: parsedUrl.auth.username.substring(0, 3) + '***'
      })
    }

    try {
      const response = await axios.get(parsedUrl.baseUrl, axiosConfig)
      
      // Check for tvv.tw specific error responses
      if (url.includes('tvv.tw') && response.headers['content-type']?.includes('text/html')) {
        throw new Error('tvv.tw returned HTML instead of file content, possibly indicating an error')
      }

      const archivePath = path.join(process.env['RUNNER_TEMP'] || '/tmp', `archive-${Date.now()}.zip`)
      const writer = fs.createWriteStream(archivePath)

      response.data.pipe(writer)

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(archivePath))
        writer.on('error', reject)
      })
    } catch (error: any) {
      // Add tvv.tw specific error handling
      if (url.includes('tvv.tw')) {
        if (error.response?.status === 404) {
          throw new Error(`tvv.tw: Repository or ref not found. Check repository name and ref format.`)
        } else if (error.response?.status === 403) {
          throw new Error(`tvv.tw: Access forbidden. Repository may be private or rate limited.`)
        } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
          throw new Error(`tvv.tw: Connection timeout. Service may be overloaded.`)
        }
      }
      throw error
    }
  }

  /**
   * Extract archive
   */
  private async extractArchive(archivePath: string): Promise<string> {
    logger.debug('Extracting archive', {path: archivePath})
    
    const extractPath = path.join(path.dirname(archivePath), `extracted-${Date.now()}`)
    await tc.extractZip(archivePath, extractPath)
    
    // Find the actual content directory (usually has a suffix like repo-main)
    const contents = fs.readdirSync(extractPath)
    if (contents.length === 1) {
      return path.join(extractPath, contents[0] || '')
    }
    
    return extractPath
  }

  /**
   * Move extracted content to target location
   */
  private async moveToTarget(sourcePath: string): Promise<void> {
    logger.debug('Moving to target location', {source: sourcePath, target: this.options.path})
    
    await this.prepareTargetDirectory()
    
    // Copy all contents from source to target
    const contents = fs.readdirSync(sourcePath)
    for (const item of contents) {
      const srcPath = path.join(sourcePath, item)
      const destPath = path.join(this.options.path, item)
      await io.cp(srcPath, destPath, {recursive: true})
    }
    
    // Cleanup source
    await io.rmRF(sourcePath)
  }

  /**
   * Prepare target directory
   */
  private async prepareTargetDirectory(): Promise<void> {
    // Don't try to remove current directory
    if (this.options.path === '.' || this.options.path === './') {
      if (this.options.clean) {
        // Clean contents of current directory instead of removing it
        const contents = fs.readdirSync(this.options.path)
        for (const item of contents) {
          // Skip hidden files and important directories
          if (!item.startsWith('.') && item !== 'node_modules') {
            await io.rmRF(path.join(this.options.path, item))
          }
        }
      }
    } else {
      if (this.options.clean && fs.existsSync(this.options.path)) {
        await io.rmRF(this.options.path)
      }
      await io.mkdirP(this.options.path)
    }
  }

  /**
   * Get commit information
   */
  private async getCommitInfo(): Promise<string> {
    try {
      let commit = ''
      await exec.exec('git', ['rev-parse', 'HEAD'], {
        cwd: this.options.path,
        listeners: {
          stdout: (data: Buffer) => {
            commit += data.toString().trim()
          }
        }
      })
      return commit
    } catch {
      return this.options.ref || 'unknown'
    }
  }

  /**
   * Get directory size
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    let size = 0
    
    const calculateSize = (itemPath: string): void => {
      const stats = fs.statSync(itemPath)
      if (stats.isFile()) {
        size += stats.size
      } else if (stats.isDirectory()) {
        const items = fs.readdirSync(itemPath)
        for (const item of items) {
          calculateSize(path.join(itemPath, item))
        }
      }
    }
    
    try {
      calculateSize(dirPath)
    } catch {
      // Ignore errors
    }
    
    return size
  }

  /**
   * Move cloned content from temporary directory to target
   */
  private async moveClonedContent(sourcePath: string, targetPath: string): Promise<void> {
    try {
      const contents = fs.readdirSync(sourcePath)
      for (const item of contents) {
        const srcPath = path.join(sourcePath, item)
        const destPath = path.join(targetPath, item)
        await io.cp(srcPath, destPath, {recursive: true})
      }
      
      // Cleanup temporary directory
      await io.rmRF(sourcePath)
    } catch (error) {
      logger.warn('Failed to move cloned content', {
        source: sourcePath,
        target: targetPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }
}