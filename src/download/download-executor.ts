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
      finalUrl: this.sanitizeUrl(this.maskCredentialsInUrl(downloadUrl)),
      urlComponents: this.analyzeUrl(downloadUrl)
    })
    const startTime = Date.now()

    try {
      // Download archive
      logger.info('Starting archive download via mirror', {
        mirror: mirrorService.name,
        url: this.sanitizeUrl(this.maskCredentialsInUrl(downloadUrl)),
        timeout: mirrorService.timeout
      })
      
      const archivePath = await this.downloadArchive(downloadUrl, mirrorService.timeout)
      
      logger.info('Archive download completed, starting extraction', {
        archivePath,
        mirror: mirrorService.name
      })
      
      // Extract archive
      const extractedPath = await this.extractArchive(archivePath)
      
      logger.info('Archive extraction completed, moving to target', {
        extractedPath,
        targetPath: this.options.path
      })
      
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
      const downloadTime = (Date.now() - startTime) / 1000
      
      // 添加详细的错误日志
      logger.error('Mirror download failed', {
        mirror: mirrorService.name,
        repository: this.options.repository,
        ref: this.options.ref,
        downloadTime: `${downloadTime.toFixed(2)}s`,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        url: this.maskCredentialsInUrl(downloadUrl)
      })
      
      // 根据错误类型提供更具体的错误信息
      let errorMessage = error instanceof Error ? error.message : 'Unknown error'
      let errorCode = ErrorCode.MIRROR_ERROR
      
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          errorCode = ErrorCode.MIRROR_TIMEOUT
          errorMessage = `Mirror service ${mirrorService.name} request timed out after ${mirrorService.timeout}s`
        } else if (error.message.includes('404')) {
          errorCode = ErrorCode.REPOSITORY_NOT_FOUND
          errorMessage = `Repository or ref not found via mirror ${mirrorService.name}`
        } else if (error.message.includes('403')) {
          errorCode = ErrorCode.UNAUTHORIZED
          errorMessage = `Access forbidden via mirror ${mirrorService.name}`
        } else if (error.message.includes('ECONNRESET') || error.message.includes('ETIMEDOUT')) {
          errorCode = ErrorCode.CONNECTION_ERROR
          errorMessage = `Connection error with mirror ${mirrorService.name}`
        }
      }
      
      logger.endGroup()
      
      throw createActionError(
        errorMessage,
        errorCode,
        {mirror: mirrorService.name, url: downloadUrl, downloadTime},
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
      finalUrl: this.sanitizeUrl(this.maskCredentialsInUrl(downloadUrl)),
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

  /**
   * Build mirror download URL
   */
  private buildMirrorDownloadUrl(mirrorService: MirrorService): string {
    // 使用 archive/{ref}.zip 方式构建
    const archivePath = this.buildArchivePath()
    const githubUrl = `https://github.com/${this.options.repository}/${archivePath}`
    const mirrorUrl = this.parseMirrorUrl(mirrorService.url)
    
    // 构建基础URL（代理前置 + GitHub归档URL）
    const finalUrl = `${mirrorUrl.baseUrl}/${githubUrl}`
    
    // 返回不带认证信息的URL，认证将在下载时通过HTTP头部传递
    return finalUrl
  }
  
  /**
   * Build archive path from ref
   */
  private buildArchivePath(): string {
    const ref = this.options.ref || 'main'
    
    // 兼容不同 ref 格式
    if (ref.startsWith('refs/heads/')) {
      const branch = ref.replace('refs/heads/', '')
      return `archive/${branch}.zip`
    }
    
    if (ref.startsWith('refs/tags/')) {
      const tag = ref.replace('refs/tags/', '')
      return `archive/${tag}.zip`
    }
    
    if (ref.startsWith('refs/pull/')) {
      // 处理 PR 格式 refs/pull/<id>/merge
      const prMatch = ref.match(/refs\/pull\/(\d+)\/merge/)
      if (prMatch) {
        return `archive/refs/pull/${prMatch[1]}/merge.zip`
      }
      return `archive/${ref}.zip`
    }
    
    // 简单分支/标签名
    return `archive/${ref}.zip`
  }

  /**
   * Add authentication to URL if token is available
   */
  private addAuthenticationToUrl(url: string, hostname: string): string {
    if (!this.options.token) {
      logger.info('Built proxy URL without authentication', {
        finalUrl: this.maskCredentialsInUrl(url),
        proxyService: hostname,
        authenticationMethod: 'none'
      })
      return url
    }
    
    try {
      const urlObj = new URL(url)
      urlObj.username = 'git'
      urlObj.password = this.options.token
      const authenticatedUrl = urlObj.toString()
      
      logger.info('Added GitHub authentication to proxy URL', {
        finalUrl: this.maskCredentialsInUrl(authenticatedUrl),
        proxyService: hostname,
        authenticationMethod: 'proxy-embedded'
      })
      
      return authenticatedUrl
    } catch (error) {
      logger.warn('Failed to add authentication to proxy URL', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return url
    }
  }

  /**
   * Build direct download URL
   */
  private buildDirectDownloadUrl(): string {
    let ref = this.options.ref || 'main'
    
    // Handle different ref formats - GitHub archive API uses simple format
    let archivePath = ''
    if (ref.startsWith('refs/heads/')) {
      const branch = ref.replace('refs/heads/', '')
      archivePath = `archive/${branch}.zip`
    } else if (ref.startsWith('refs/tags/')) {
      const tag = ref.replace('refs/tags/', '')
      archivePath = `archive/${tag}.zip`
    } else if (ref.startsWith('refs/pull/')) {
      // Handle pull request refs
      const prMatch = ref.match(/refs\/pull\/(\d+)\/merge/)
      if (prMatch) {
        archivePath = `archive/refs/pull/${prMatch[1]}/merge.zip`
      } else {
        archivePath = `archive/${ref}.zip`
      }
    } else {
      // For simple names, GitHub archive API uses simple format
      archivePath = `archive/${ref}.zip`
    }
    
    // Build the base GitHub URL
    const githubUrl = `https://github.com/${this.options.repository}/${archivePath}`
    
    // Check if github-proxy-url is configured
    const githubProxyUrl = this.getInputOptions().githubProxyUrl
    if (githubProxyUrl) {
      // Use proxy URL format: proxy_url/github_url
      const cleanProxyUrl = githubProxyUrl.replace(/\/$/, '') // Remove trailing slash
      let finalUrl = `${cleanProxyUrl}/${githubUrl}`
      
      // Add authentication to proxy URL if token is available
      // Format: https://git:token@proxyurl/https://github.com/user/repo
      // Parse github-proxy-url to extract credentials if present
      const parsedProxyUrl = this.parseMirrorUrl(githubProxyUrl)
      const username = parsedProxyUrl.auth?.username || 'git' // Use extracted username or fallback to 'git'
      const password = parsedProxyUrl.auth?.password || this.options.token // Use extracted password or fallback to GitHub token
      
      if (username && password) {
        try {
          const finalUrlObj = new URL(finalUrl)
          finalUrlObj.username = username
          finalUrlObj.password = password
          finalUrl = finalUrlObj.toString()
          
          logger.info('Added authentication to proxy URL', {
            finalUrl: this.maskCredentialsInUrl(finalUrl),
            proxyService: new URL(cleanProxyUrl).hostname,
            authenticationMethod: parsedProxyUrl.auth ? 'proxy-embedded' : 'github-token',
            username: this.maskUsername(username),
            passwordSource: parsedProxyUrl.auth ? 'proxy-url' : 'github-token'
          })
        } catch (error) {
          logger.warn('Failed to add authentication to proxy URL', {
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      } else {
        logger.info('Built proxy URL without authentication', {
          finalUrl: this.maskCredentialsInUrl(finalUrl),
          proxyService: new URL(cleanProxyUrl).hostname,
          authenticationMethod: 'none'
        })
      }
      
      return finalUrl
    }
    
    // Embed GitHub token in the URL for authentication if no proxy
    // Format: https://username:token@github.com/org/repo
    if (this.options.token) {
      return `https://git:${this.options.token}@github.com/${this.options.repository}/${archivePath}`
    }
    
    return githubUrl
  }

  /**
   * Download archive file
   */
  private async downloadArchive(url: string, timeoutSeconds: number): Promise<string> {
    // Get github-proxy-url from input options
    const githubProxyUrl = this.getInputOptions().githubProxyUrl
    
    logger.info('Downloading archive with credentials', {
      finalUrl: this.sanitizeUrl(this.maskCredentialsInUrl(url)),
      urlComponents: this.analyzeUrl(url),
      timeout: timeoutSeconds,
      downloadMethod: 'HTTP Archive',
      githubProxyUrl: githubProxyUrl || 'not configured'
    })
    
    // 解析URL获取认证信息
    const parsedUrl = new URL(url)
    
    // 提取认证信息
    let authHeader = ''
    if (parsedUrl.username || parsedUrl.password) {
      // 构建Basic Auth头部
      const credentials = Buffer.from(`${parsedUrl.username || ''}:${parsedUrl.password || ''}`).toString('base64')
      authHeader = `Basic ${credentials}`
      
      // 从URL中移除认证信息
      parsedUrl.username = ''
      parsedUrl.password = ''
      url = parsedUrl.toString()
    }

    // Determine if we should use parallel download
    const useParallelDownload = DEFAULT_CONFIG.PARALLEL_DOWNLOAD_ENABLED && 
                               !url.includes('statically.io')

    // Prepare axios config
    const axiosConfig: any = {
      timeout: timeoutSeconds * 1000,
      headers: {
        ...HTTP_HEADERS,
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
      },
    
    // 添加认证头部（如果存在）
    if (authHeader) {
      axiosConfig.headers['Authorization'] = authHeader
    }
      // Add redirect handling
      maxRedirects: 5,
      validateStatus: (status: number) => {
        // Accept 200-299 and 302 redirects
        return (status >= 200 && status < 300) || status === 302
      }
    }

    // Note: GitHub authentication credentials are now embedded in the URL itself
    // Format: https://username:token@proxyurl/https://github.com/org/repo (for proxy)
    // Format: https://username:token@github.com/org/repo (for direct)
    logger.debug('Using URL with embedded GitHub credentials for better compatibility')

    try {
      const archivePath = path.join(process.env['RUNNER_TEMP'] || '/tmp', `archive-${Date.now()}.zip`)
      
      if (useParallelDownload) {
        // Try parallel download first
        try {
          await this.downloadWithParallelChunks(url, archivePath, axiosConfig)
          return archivePath
        } catch (parallelError) {
          logger.warn('Parallel download failed, falling back to standard download', {
            error: parallelError instanceof Error ? parallelError.message : 'Unknown error'
          })
          // Fall back to standard download if parallel download fails
        }
      }
      
      // Standard download
      axiosConfig.responseType = 'stream'
      const response = await axios.get(url, axiosConfig)
      
      // Check for specific error responses
      if (response.headers['content-type']?.includes('text/html') && 
          !url.includes('statically.io')) {
        throw new Error('Service returned HTML instead of file content, possibly indicating an error')
      }

      const writer = fs.createWriteStream(archivePath)
      response.data.pipe(writer)

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(archivePath))
        writer.on('error', reject)
      })
    } catch (error: any) {
      // Service-specific error handling
      if (url.includes('tvv.tw')) {
        if (error.response?.status === 404) {
          throw new Error(`tvv.tw: Repository or ref not found. Check repository name and ref format.`)
        } else if (error.response?.status === 403) {
          throw new Error(`tvv.tw: Access forbidden. Repository may be private or rate limited.`)
        } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
          throw new Error(`tvv.tw: Connection timeout. Service may be overloaded.`)
        }
      } else if (url.includes('ghproxy.com')) {
        if (error.response?.status === 404) {
          throw new Error(`ghproxy.com: Repository or ref not found.`)
        } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
          throw new Error(`ghproxy.com: Connection timeout. Service may be overloaded.`)
        }
      }
      throw error
    }
  }
  
  /**
   * Download file using parallel chunks for better performance
   */
  private async downloadWithParallelChunks(url: string, filePath: string, axiosConfig: any): Promise<void> {
    logger.debug('Starting parallel download')
    
    // First, get the content length with a HEAD request
    const headResponse = await axios.head(url, axiosConfig)
    const contentLength = parseInt(headResponse.headers['content-length'] || '0', 10)
    const acceptRanges = (headResponse.headers['accept-ranges'] || '').toString().toLowerCase()
    
    if (!contentLength || contentLength <= 0) {
      throw new Error('Could not determine file size for parallel download')
    }
    // Some mirrors/proxies do not support range requests; in such case, fall back to standard download
    if (!acceptRanges.includes('bytes')) {
      throw new Error('Server does not support range requests; falling back to standard download')
    }
    
    logger.debug('File size for parallel download', { 
      size: `${(contentLength / (1024 * 1024)).toFixed(2)} MB` 
    })
    
    // Create file of the right size
    const fileHandle = await fs.promises.open(filePath, 'w')
    await fileHandle.close()
    
    const chunkSize = DEFAULT_CONFIG.CHUNK_SIZE
    const chunks = []
    
    // Calculate chunks
    for (let start = 0; start < contentLength; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, contentLength - 1)
      chunks.push({ start, end })
    }
    
    logger.debug('Downloading in parallel chunks', { 
      chunks: chunks.length,
      chunkSize: `${(chunkSize / (1024 * 1024)).toFixed(2)} MB`
    })
    
    // Download chunks in parallel with a limit on concurrency
    const maxConcurrent = DEFAULT_CONFIG.MAX_PARALLEL_DOWNLOADS
    const chunkPromises = []
    
    for (let i = 0; i < chunks.length; i += maxConcurrent) {
      const batch = chunks.slice(i, i + maxConcurrent)
      const batchPromises = batch.map(chunk => this.downloadChunk(url, filePath, chunk.start, chunk.end, axiosConfig))
      
      // Wait for the current batch to complete before starting the next batch
      await Promise.all(batchPromises)
      chunkPromises.push(...batchPromises)
      
      logger.debug(`Downloaded chunks ${i + 1} to ${Math.min(i + maxConcurrent, chunks.length)} of ${chunks.length}`)
    }
    
    // Ensure all chunks are downloaded
    // Ensure all chunks are downloaded
    await Promise.all(chunkPromises)
    logger.debug('Parallel download completed successfully')
  }
  
  /**
   * Download a single chunk of a file
   */
  private async downloadChunk(url: string, filePath: string, start: number, end: number, axiosConfig: any): Promise<void> {
    const chunkConfig = {
      ...axiosConfig,
      headers: {
        ...axiosConfig.headers,
        Range: `bytes=${start}-${end}`
      },
      responseType: 'arraybuffer'
    }
    
    const response = await axios.get(url, chunkConfig)
    
    // Write chunk to the correct position in the file
    const fileHandle = await fs.promises.open(filePath, 'r+')
    await fileHandle.write(Buffer.from(response.data), 0, response.data.byteLength, start)
    await fileHandle.close()
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
      const clonePath = `temp-clone-${Date.now()}` // Use timestamp to avoid conflicts
      
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
