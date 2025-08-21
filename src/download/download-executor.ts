/**
 * Download execution engine
 */

// import * as core from '@actions/core' // Removed unused import
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import * as path from 'path'
import * as fs from 'fs'
import {
  DownloadResult,
  DownloadMethod,
  CheckoutOptions,
  MirrorService,
  ErrorCode
} from '../types'
// Removed DEFAULT_CONFIG usage after dropping archive download path
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

    const startTime = Date.now()

    // Resolve target path to original repository directory name when default path is used
    this.resolveAndApplyTargetPath()

    try {
      // Prepare target directory behavior
      await this.prepareTargetDirectory()

      // Determine auth from mirror URL, fallback to GitHub token
      const parsed = this.parseMirrorUrl(mirrorService.url)
      const username = parsed.auth?.username || 'git'
      const password = parsed.auth?.password || this.options.token || ''

      if (!password) {
        throw createActionError('No credentials available for mirror git clone', ErrorCode.GIT_AUTH_FAILED)
      }

      // Build proxy git clone URL: https://username:password@<proxyHost><proxyPath>/https://github.com/owner/repo.git
      const plainGitHubUrl = `https://github.com/${this.options.repository}.git`
      const proxyHostAndPath = parsed.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
      const gitUrl = `https://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${proxyHostAndPath}/${plainGitHubUrl}`

      // Build args
      const args = ['clone']
      if (this.options.fetchDepth > 0) {
        args.push('--depth', this.options.fetchDepth.toString())
      }

      // Handle ref
      let gitRef = this.options.ref
      if (gitRef && gitRef.startsWith('refs/heads/')) {
        gitRef = gitRef.replace('refs/heads/', '')
        args.push('--branch', gitRef)
      } else if (gitRef && gitRef.startsWith('refs/tags/')) {
        gitRef = gitRef.replace('refs/tags/', '')
        args.push('--branch', gitRef)
      } else if (gitRef && !gitRef.startsWith('refs/')) {
        args.push('--branch', gitRef)
      }

      // Always omit explicit destination to avoid temp path in command
      const repoDirName = this.extractRepositoryName(this.options.repository)
      if (fs.existsSync(repoDirName)) {
        await io.rmRF(repoDirName)
      }
      args.push(gitUrl)

      logger.info('Starting git clone via mirror proxy', {
        mirror: mirrorService.name,
        finalUrl: this.maskCredentialsInUrl(gitUrl)
      })

      const exitCode = await exec.exec('git', args, {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      })

      if (exitCode !== 0) {
        throw createActionError(`Git clone failed with exit code ${exitCode}`, ErrorCode.GIT_CLONE_FAILED)
      }

      // Move contents from default clone folder to target path
      const sourcePath = repoDirName
      if (this.options.path !== sourcePath) {
        await this.moveClonedContent(sourcePath, this.options.path)
      }

      // Collect metrics
      const commit = await this.getCommitInfo()
      const downloadTime = (Date.now() - startTime) / 1000
      const dirSize = await this.getDirectorySize(this.options.path)
      const downloadSpeed = (dirSize / (1024 * 1024)) / downloadTime

      logger.info('Mirror git clone completed successfully', {
        repository: this.options.repository,
        mirror: mirrorService.name,
        downloadTime: `${downloadTime.toFixed(2)}s`,
        downloadSpeed: `${downloadSpeed.toFixed(2)} MB/s`,
        directorySize: `${(dirSize / (1024 * 1024)).toFixed(2)} MB`,
        commit: commit?.substring(0, 7)
      })
      logger.endGroup()

      return {
        success: true,
        method: DownloadMethod.MIRROR,
        mirrorUsed: mirrorService.url,
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Mirror git clone failed', {
        mirror: mirrorService.name,
        repository: this.options.repository,
        ref: this.options.ref,
        error: errorMessage
      })

      throw createActionError(
        errorMessage,
        ErrorCode.MIRROR_ERROR,
        { mirror: mirrorService.name, url: mirrorService.url },
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

    // Ensure target path follows original repo directory name when default path is used
    this.resolveAndApplyTargetPath()

    // Prefer Git clone with proxy if configured, otherwise standard Git clone
    const gitCloneResult = await this.tryGitCloneWithProxy()
    if (gitCloneResult) {
      logger.info('Successfully used Git clone with proxy authentication')
      logger.endGroup()
      return gitCloneResult
    }

    // Fall back to direct Git clone
    logger.info('Proxy clone not available; using direct Git clone')
    const result = await this.downloadViaGit()
    logger.endGroup()
    return result
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

    // Ensure target path follows original repo directory name when default path is used
    this.resolveAndApplyTargetPath()
    const gitUrl = `https://github.com/${this.options.repository}.git`
    // Build Git URL with embedded token for authentication early so both branches can use it
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
    } else {
      logger.info('Git clone URL', {
        finalUrl: this.maskCredentialsInUrl(gitUrl),
        urlComponents: this.analyzeUrl(gitUrl)
      })
    }

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
        args.push('--branch', gitRef)
      } else if (gitRef && gitRef.startsWith('refs/tags/')) {
        gitRef = gitRef.replace('refs/tags/', '')
        args.push('--branch', gitRef)
      } else if (gitRef && !gitRef.startsWith('refs/')) {
        // It's a simple branch or tag name
        args.push('--branch', gitRef)
      }

      // Use the target directory directly for git clone
      const clonePath = this.options.path
      
      // Clean up any existing clone path
      if (fs.existsSync(clonePath) && this.options.clean) {
        await io.rmRF(clonePath)
      } else if (fs.existsSync(clonePath) && !this.options.clean) {
        // If target directory exists and clean is false, we need to clone into a temporary directory first
        // to avoid conflicts, then merge contents
        const tempClonePath = `temp-clone-${Date.now()}`
        
        // Execute git clone to temporary directory
        const tempArgs = [...args, finalGitUrl, tempClonePath]
        const exitCode = await exec.exec('git', tempArgs, {
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0'
          }
        })
        
        if (exitCode !== 0) {
          throw new Error(`Git clone failed with exit code ${exitCode}`)
        }
        
        // Move contents from temp directory to target directory
        await this.moveClonedContent(tempClonePath, this.options.path)
        
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
      }
      
      // Ensure target directory exists
      if (!fs.existsSync(clonePath)) {
        await io.mkdirP(path.dirname(clonePath))
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
      if (parsedUrl.username) {
        auth = {
          username: parsedUrl.username,
          password: parsedUrl.password || ''
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
      if (parsedUrl.username || parsedUrl.password) {
        const maskedUsername = parsedUrl.username ? this.maskUsername(parsedUrl.username) : ''
        const maskedPassword = parsedUrl.password ? this.maskPassword(parsedUrl.password) : ''
        
        // Reconstruct URL with masked credentials
        parsedUrl.username = maskedUsername
        parsedUrl.password = maskedPassword
        return parsedUrl.toString()
      }
      return url
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
        username: parsedUrl.username ? this.maskUsername(parsedUrl.username) : undefined,
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
    const proxyIndicators = ['tvv.tw', 'gh.llkk.cc', 'gh.wzdi.cn']
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

  // Removed archive-based URL building and HTTP archive download/extraction methods

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
      let proxyAuth = this.extractProxyAuthentication()

      // If no explicit proxy credentials are provided, but a proxy URL and GitHub token exist,
      // fall back to using the GitHub token as Basic auth with username 'git'.
      if (!proxyAuth) {
        const inputs = this.getInputOptions()
        const proxyUrlCandidate = inputs.githubProxyUrl || inputs.mirrorUrl
        if (!proxyUrlCandidate) {
          logger.debug('No proxy URL configured in mirror-url or github-proxy-url')
          return null
        }

        if (!this.options.token) {
          logger.debug('Proxy URL configured but no GitHub token available for auth fallback')
          return null
        }

        try {
          const parsed = new URL(proxyUrlCandidate)
          const cleanUrl = `${parsed.hostname}${parsed.pathname}`
          proxyAuth = {
            proxyUrl: cleanUrl,
            username: 'git',
            password: this.options.token
          }
          logger.info('Using GitHub token for proxy authentication fallback', {
            proxyHost: parsed.hostname,
            username: 'git',
            tokenMasked: this.maskPassword(this.options.token)
          })
        } catch (e) {
          logger.debug('Failed to parse proxy URL for auth fallback', {
            error: e instanceof Error ? e.message : 'Unknown error'
          })
          return null
        }
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
        args.push('--branch', gitRef)
      } else if (gitRef.startsWith('refs/tags/')) {
        gitRef = gitRef.replace('refs/tags/', '')
        args.push('--branch', gitRef)
      } else if (!gitRef.startsWith('refs/')) {
        // It's a simple branch or tag name
        args.push('--branch', gitRef)
      }

      // Build Git URL with proxy authentication
      // Format: https://username:password@proxyurl/https://github.com/user/repo.git (tvv.tw official format)
      const plainGitHubUrl = `https://github.com/${this.options.repository}.git`
      const cleanProxyUrl = proxyAuth.proxyUrl.replace(/\/$/, '') // Remove trailing slash
      const gitUrl = `https://${proxyAuth.username}:${proxyAuth.password}@${cleanProxyUrl}/${plainGitHubUrl}`
      const repoDirName = this.extractRepositoryName(this.options.repository)
      if (fs.existsSync(repoDirName)) {
        await io.rmRF(repoDirName)
      }
      // Omit destination so the command is: git clone <url>
      args.push(gitUrl)

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

      // Move content to target location from default clone folder
      if (this.options.path !== repoDirName) {
        await this.moveClonedContent(repoDirName, this.options.path)
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

  /**
   * Resolve and apply the target path to the original repository directory name
   * when the input path is '.' or './'. This makes the clone folder match repo name.
   */
  private resolveAndApplyTargetPath(): void {
    if (this.options.path === '.' || this.options.path === './') {
      const repoName = this.extractRepositoryName(this.options.repository)
      this.options.path = repoName
      logger.info('Adjusted target path to repository directory name', { targetPath: this.options.path })
    }
  }

  /**
   * Extract repository name from 'owner/repo'
   */
  private extractRepositoryName(repository: string): string {
    const parts = repository.split('/')
    return parts[parts.length - 1] || 'repository'
  }
}
