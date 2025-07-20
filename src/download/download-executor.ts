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
  private inputOptions: { mirrorUrl?: string; githubProxyUrl?: string }

  constructor(options: CheckoutOptions, inputOptions?: { mirrorUrl?: string; githubProxyUrl?: string }) {
    this.options = options
    this.inputOptions = inputOptions || {}
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
    logger.group(`Mirror Download: ${mirrorService.name}`)
    logger.info('Target repository for acceleration', {
      repository: this.options.repository,
      ref: this.options.ref || 'default',
      targetPath: this.options.path
    })
    logger.info('Using mirror service', {
      name: mirrorService.name,
      provider: mirrorService.metadata?.['provider'],
      url: mirrorService.url,
      timeout: mirrorService.timeout
    })

    const downloadUrl = this.buildMirrorDownloadUrl(mirrorService)
    logger.info('Constructed download URL', {
      finalUrl: this.maskCredentialsInUrl(downloadUrl),
      urlComponents: this.analyzeUrl(downloadUrl)
    })
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

      logger.info('Mirror download completed successfully', {
        repository: this.options.repository,
        mirror: mirrorService.name,
        downloadTime: `${downloadTime.toFixed(2)}s`,
        downloadSpeed: `${downloadSpeed.toFixed(2)} MB/s`,
        fileSize: `${(fileSize / (1024 * 1024)).toFixed(2)} MB`,
        commit: commit?.substring(0, 7)
      })
      logger.endGroup()

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
    logger.group('Direct GitHub Download')
    logger.info('Target repository for direct download', {
      repository: this.options.repository,
      ref: this.options.ref || 'default',
      targetPath: this.options.path
    })

    // First try Git clone with proxy authentication if available
    const gitCloneResult = await this.tryGitCloneWithProxy()
    if (gitCloneResult) {
      logger.info('Successfully used Git clone with proxy authentication')
      logger.endGroup()
      return gitCloneResult
    }

    // Fallback to archive download
    logger.info('Git clone with proxy failed, falling back to archive download')
    const downloadUrl = this.buildDirectDownloadUrl()
    logger.info('Direct download URL', {
      finalUrl: this.maskCredentialsInUrl(downloadUrl),
      urlComponents: this.analyzeUrl(downloadUrl)
    })
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

      logger.info('Direct download completed successfully', {
        repository: this.options.repository,
        downloadTime: `${downloadTime.toFixed(2)}s`,
        downloadSpeed: `${downloadSpeed.toFixed(2)} MB/s`,
        fileSize: `${(fileSize / (1024 * 1024)).toFixed(2)} MB`,
        commit: commit?.substring(0, 7)
      })
      logger.endGroup()

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
    logger.group('Git Clone Download')
    logger.info('Target repository for Git clone', {
      repository: this.options.repository,
      ref: this.options.ref || 'default',
      targetPath: this.options.path,
      fetchDepth: this.options.fetchDepth
    })

    const startTime = Date.now()
    const gitUrl = `https://github.com/${this.options.repository}.git`
    logger.info('Git clone URL', {
      finalUrl: this.maskCredentialsInUrl(gitUrl),
      urlComponents: this.analyzeUrl(gitUrl)
    })

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
      
      // Build Git URL with embedded token for authentication
      // Format: https://username:token@github.com/org/repo.git
      let finalGitUrl = gitUrl
      if (this.options.token) {
        finalGitUrl = `https://git:${this.options.token}@github.com/${this.options.repository}.git`
        logger.info('Using Git URL with embedded GitHub token', {
          finalUrl: this.maskCredentialsInUrl(finalGitUrl),
          authentication: {
            username: 'git',
            tokenMasked: this.maskPassword(this.options.token)
          }
        })
      }
      
      args.push(finalGitUrl, clonePath)

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

      logger.info('Git clone completed successfully', {
        repository: this.options.repository,
        downloadTime: `${downloadTime.toFixed(2)}s`,
        downloadSpeed: `${downloadSpeed.toFixed(2)} MB/s`,
        directorySize: `${(dirSize / (1024 * 1024)).toFixed(2)} MB`,
        commit: commit?.substring(0, 7)
      })
      logger.endGroup()

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
    
    // Always use plain GitHub URL for proxy services
    const githubUrl = `https://github.com/${this.options.repository}/${archivePath}`
    
    // Parse mirror URL to handle authentication
    const mirrorUrl = this.parseMirrorUrl(mirrorService.url)
    
    // Build final URL with embedded GitHub credentials in proxy URL
    let finalUrl = ''
    
    // Handle different mirror service formats
    if (mirrorUrl.hostname.includes('ghproxy.com')) {
      const cleanBaseUrl = mirrorUrl.baseUrl.replace(/\/$/, '')
      finalUrl = `${cleanBaseUrl}/${githubUrl}`
    } else if (mirrorUrl.hostname.includes('tvv.tw')) {
      // tvv.tw format: https://tvv.tw/https://github.com/...
      const cleanBaseUrl = mirrorUrl.baseUrl.replace(/\/$/, '')
      finalUrl = `${cleanBaseUrl}/${githubUrl}`
    } else if (mirrorUrl.hostname.includes('fastgit.org')) {
      // FastGit format: https://download.fastgit.org/user/repo/archive/ref.zip
      const cleanBaseUrl = mirrorUrl.baseUrl.replace(/\/$/, '')
      finalUrl = `${cleanBaseUrl}/${this.options.repository}/${archivePath}`
    } else {
      // Generic proxy format: proxy_url/github_url
      const cleanBaseUrl = mirrorUrl.baseUrl.replace(/\/$/, '')
      finalUrl = `${cleanBaseUrl}/${githubUrl}`
    }
    
    // Embed GitHub authentication credentials in the proxy URL
    // Format: https://username:token@proxyurl/https://github.com/org/repo
    if (this.options.token) {
      try {
        const finalUrlObj = new URL(finalUrl)
        // GitHub uses token as password, username can be anything (commonly 'git' or the actual username)
        finalUrlObj.username = 'git'
        finalUrlObj.password = this.options.token
        finalUrl = finalUrlObj.toString()
        logger.info('Embedded GitHub credentials in proxy URL', {
          finalUrl: this.maskCredentialsInUrl(finalUrl),
          authentication: {
            username: 'git',
            tokenMasked: this.maskPassword(this.options.token)
          }
        })
      } catch (error) {
        logger.warn('Failed to embed GitHub credentials in proxy URL', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
    
    return finalUrl
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
   * Mask credentials in URL for secure logging
   */
  private maskCredentialsInUrl(url: string): string {
    try {
      const parsedUrl = new URL(url)
      let maskedUrl = url
      
      if (parsedUrl.username) {
        const maskedUsername = this.maskUsername(parsedUrl.username)
        maskedUrl = maskedUrl.replace(parsedUrl.username, maskedUsername)
      }
      
      if (parsedUrl.password) {
        const maskedPassword = this.maskPassword(parsedUrl.password)
        maskedUrl = maskedUrl.replace(parsedUrl.password, maskedPassword)
      }
      
      return maskedUrl
    } catch {
      return '[INVALID_URL]'
    }
  }

  /**
   * Mask username for logging
   */
  private maskUsername(username: string): string {
    if (!username) return ''
    if (username.length <= 3) return '***'
    return username.substring(0, 2) + '***' + username.substring(username.length - 1)
  }

  /**
   * Mask password/token for logging
   */
  private maskPassword(password: string): string {
    if (!password) return ''
    if (password.length <= 8) return '***'
    return password.substring(0, 4) + '***' + password.substring(password.length - 4)
  }

  /**
   * Analyze URL components for detailed logging
   */
  private analyzeUrl(url: string): Record<string, any> {
    try {
      const parsedUrl = new URL(url)
      return {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 'default',
        pathname: parsedUrl.pathname,
        hasUsername: !!parsedUrl.username,
        hasPassword: !!parsedUrl.password,
        usernameLength: parsedUrl.username?.length || 0,
        passwordLength: parsedUrl.password?.length || 0,
        isProxyUrl: this.isProxyUrl(parsedUrl),
        targetRepository: this.extractTargetRepository(parsedUrl)
      }
    } catch {
      return { error: 'Invalid URL format' }
    }
  }

  /**
   * Check if URL is a proxy URL
   */
  private isProxyUrl(parsedUrl: URL): boolean {
    const proxyIndicators = ['tvv.tw', 'ghproxy.com', 'github.moeyy.xyz', 'fastgit.org']
    return proxyIndicators.some(indicator => parsedUrl.hostname.includes(indicator))
  }

  /**
   * Extract target repository from proxy URL
   */
  private extractTargetRepository(parsedUrl: URL): string | null {
    try {
      // For proxy URLs like https://proxy.com/https://github.com/owner/repo
      const pathMatch = parsedUrl.pathname.match(/\/https:\/\/github\.com\/([^\/]+\/[^\/]+)/)
      if (pathMatch && pathMatch[1]) {
        return pathMatch[1]
      }
      
      // For direct GitHub URLs
      if (parsedUrl.hostname === 'github.com') {
        const repoMatch = parsedUrl.pathname.match(/^\/([^\/]+\/[^\/]+)/)
        if (repoMatch && repoMatch[1]) {
          return repoMatch[1]
        }
      }
      
      return null
    } catch {
      return null
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
    
    // Embed GitHub token in the URL for authentication
    // Format: https://username:token@github.com/org/repo
    if (this.options.token) {
      return `https://git:${this.options.token}@github.com/${this.options.repository}/${archivePath}`
    }
    
    return `https://github.com/${this.options.repository}/${archivePath}`
  }

  /**
   * Download archive file
   */
  private async downloadArchive(url: string, timeoutSeconds: number): Promise<string> {
    logger.info('Downloading archive with credentials', {
      finalUrl: this.maskCredentialsInUrl(url),
      urlComponents: this.analyzeUrl(url),
      timeout: timeoutSeconds,
      downloadMethod: 'HTTP Archive'
    })

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

    // Note: GitHub authentication credentials are now embedded in the URL itself
    // Format: https://username:token@proxyurl/https://github.com/org/repo (for proxy)
    // Format: https://username:token@github.com/org/repo (for direct)
    logger.debug('Using URL with embedded GitHub credentials for better compatibility')

    try {
      // Use the full URL (which may contain embedded credentials) instead of parsedUrl.baseUrl
      const response = await axios.get(url, axiosConfig)
      
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
   * Try Git clone with proxy authentication from mirror-url or github-proxy-url
   */
  private async tryGitCloneWithProxy(): Promise<DownloadResult | null> {
    try {
      // Extract proxy authentication from input options
      const proxyAuth = this.extractProxyAuthentication()
      if (!proxyAuth) {
        logger.debug('No proxy authentication found in mirror-url or github-proxy-url')
        return null
      }

      logger.info('Attempting Git clone with proxy authentication', {
        proxyUrl: proxyAuth.proxyUrl,
        authentication: {
          username: proxyAuth.username,
          passwordMasked: this.maskPassword(proxyAuth.password)
        },
        targetRepository: this.options.repository,
        ref: this.options.ref || 'master'
      })

      const startTime = Date.now()
      
      // Prepare Git clone command
      const args = ['clone', '--depth', '1']
      
      // Handle ref/branch
      let gitRef = this.options.ref || 'master'
      if (gitRef.startsWith('refs/heads/')) {
        gitRef = gitRef.replace('refs/heads/', '')
      }
      args.push('--branch', gitRef)

      // Build Git URL with proxy authentication
      const gitUrl = `https://${proxyAuth.username}:${proxyAuth.password}@${proxyAuth.proxyUrl}/https://github.com/${this.options.repository}.git`
      const clonePath = 'temp-clone'
      
      args.push(gitUrl, clonePath)

      logger.info('Git clone command details', {
        command: `git ${args.join(' ')}`.replace(proxyAuth.password, '***'),
        finalUrl: this.maskCredentialsInUrl(gitUrl),
        authentication: {
          username: proxyAuth.username,
          passwordMasked: this.maskPassword(proxyAuth.password)
        }
      })

      // Execute git clone
      const exitCode = await exec.exec('git', args, {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0'
        }
      })

      if (exitCode !== 0) {
        logger.warn('Git clone with proxy failed', { exitCode })
        return null
      }

      // Move content to target location
      if (this.options.path !== clonePath) {
        await this.moveClonedContent(clonePath, this.options.path)
      }

      // Get commit info
      const commit = await this.getCommitInfo()

      const downloadTime = (Date.now() - startTime) / 1000
      const dirSize = await this.getDirectorySize(this.options.path)
      const downloadSpeed = (dirSize / (1024 * 1024)) / downloadTime

      logger.info('Git clone with proxy completed successfully', {
        repository: this.options.repository,
        proxyUrl: this.sanitizeUrl(proxyAuth.proxyUrl),
        downloadTime: `${downloadTime.toFixed(2)}s`,
        downloadSpeed: `${downloadSpeed.toFixed(2)} MB/s`,
        directorySize: `${(dirSize / (1024 * 1024)).toFixed(2)} MB`,
        commit: commit?.substring(0, 7)
      })

      return {
        success: true,
        method: DownloadMethod.GIT,
        mirrorUsed: proxyAuth.proxyUrl,
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
      logger.warn('Git clone with proxy failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return null
    }
  }

  /**
   * Extract proxy authentication from mirror-url or github-proxy-url
   */
  private extractProxyAuthentication(): { proxyUrl: string; username: string; password: string } | null {
    // Check for custom mirror URL from input options
    const inputs = this.getInputOptions()
    const mirrorUrl = inputs.mirrorUrl || inputs.githubProxyUrl
    
    if (!mirrorUrl) {
      return null
    }

    try {
      const parsedUrl = new URL(mirrorUrl)
      if (parsedUrl.username && parsedUrl.password) {
        // Remove credentials from URL to get clean proxy URL
        const cleanUrl = `${parsedUrl.hostname}${parsedUrl.pathname}`
        return {
          proxyUrl: cleanUrl,
          username: parsedUrl.username,
          password: parsedUrl.password
        }
      }
    } catch (error) {
      logger.debug('Failed to parse mirror URL for authentication', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }

    return null
  }

  /**
   * Get input options
   */
  private getInputOptions(): { mirrorUrl?: string; githubProxyUrl?: string } {
    return this.inputOptions
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