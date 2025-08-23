# 🚀 Accelerated GitHub Checkout

A high-performance GitHub repository checkout tool that significantly improves download speeds through proxy acceleration services.

## 📋 Project Overview
Based on `https://github.com/actions/checkout`, Accelerated GitHub Checkout is a TypeScript project designed specifically for GitHub Actions, aimed at solving network latency and download speed issues during GitHub repository checkout processes. It achieves fast and reliable code repository cloning through proxy mirror services.


## New Features

### Proxy Acceleration
- **Mirror Service Support**: Supports proxy services like ghproxy.com, gitclone.com, etc.

## 🎯 Input Parameters

| Parameter | Description | Default | Required |
|-----------|-------------|---------|----------|
| `repository` | Repository name (owner/repo format) | `${{ github.repository }}` | No |
| `ref` | Branch, tag, or SHA | - | No |
| `token` | GitHub authentication token | `${{ github.token }}` | No |
| `path` | Checkout path | `.` | No |
| `enable-acceleration` | Enable proxy acceleration | `true` | No |
| `mirror-url` | Proxy service URL | - | No |
| `github-proxy-url` | Proxy service URL (alias) | - | No |
| `mirror-timeout` | Proxy connection timeout (seconds) | `30` | No |
| `fallback-enabled` | Enable fallback mechanism | `true` | No |
| `download-method` | Download method (auto/mirror/direct/git) | `auto` | No |
| `retry-attempts` | Number of retry attempts | `3` | No |
| `fetch-depth` | Fetch depth (0 for full history) | `1` | No |
| `clean` | Execute git clean before fetch | `true` | No |
| `verbose` | Enable verbose logging | `false` | No |

## 📊 Output Parameters

| Output | Description |
|--------|-------------|
| `ref` | Checked out branch, tag, or SHA |
| `commit` | Checked out commit SHA |
| `download-method` | Actual download method used |
| `mirror-used` | Proxy service URL used |
| `download-time` | Total download time (seconds) |
| `download-speed` | Average download speed (MB/s) |
| `download-size` | Total download size (bytes) |
| `success` | Whether checkout operation succeeded |
| `fallback-used` | Whether fallback mechanism was used |
| `error-message` | Error message (if failed) |
| `error-code` | Error code (for programmatic handling) |

## 🚀 Quick Start

### Basic Usage

```yaml
- name: Checkout Repository
  uses: xxmime/echeckout@v0.1.0
  with:
    repository: owner/repo
    token: ${{ secrets.GITHUB_TOKEN }}
```

### Using Proxy Acceleration

```yaml
- name: Accelerated Checkout
  uses: xxmime/echeckout@v0.1.0
  with:
    repository: owner/repo
    enable-acceleration: true
    mirror-url: https://ghproxy.com
    token: ${{ secrets.GITHUB_TOKEN }}
```

### Advanced Configuration

```yaml
- name: Advanced Checkout
  uses: xxmime/echeckout@v0.1.0
  with:
    repository: owner/repo
    ref: main
    path: ./my-repo
    enable-acceleration: true
    mirror-url: https://ghproxy.com
    fallback-enabled: true
    download-method: auto
    retry-attempts: 5
    fetch-depth: 0
    verbose: true
```

## 🔧 Development Guide

### Environment Requirements

- Node.js 20+
- npm 9+

### Install Dependencies

```bash
npm install
```

### Build Project

```bash
npm run build
```

### Run Tests

```bash
npm test
```

### Code Quality Checks

```bash
npm run lint
npm run format:check
```

### Complete Build Process

```bash
npm run all
```

## 📈 Performance Features

### Download Acceleration
- **Proxy Acceleration**: Improves download speed by 50-200% through mirror services

## 📄 License

This project is open source under the [MIT License](LICENSE).

## 🙏 Acknowledgments

[actions/checkout](https://github.com/actions/checkout)


---