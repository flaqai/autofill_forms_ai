import type { ProductProfile } from '@/types'
import { STORAGE_KEYS } from '@/config/constants'
import {
  getSeoListingFormDiagnosis,
} from '@/utils/formIntent'
import {
  type ExtractedFormField,
  extractFormFieldsFromTab,
  isBrowserErrorPageError,
  runProductProfileFormFill,
  wait,
  waitForTabComplete
} from '@/utils/formAutomation'
import {
  clearRunLogs,
  exportRunLogsText,
  readRunLogs,
  type RunFeedbackValue,
  type RunLogEntry,
  updateRunLogFeedback,
  upsertRunLog
} from '@/utils/runLogs'
import {
  areDiscoveryUrlsEquivalent,
  canonicalizeDiscoveryUrl as getCanonicalUrl,
  createLinkSubmissionCandidates,
  createPathGuessSubmissionCandidates,
  getDiscoveryHost as getUrlHost,
  isHighConfidenceSubmissionCandidate,
  mergeSubmissionCandidates,
  normalizeDiscoveryText,
  type SubmissionCandidate,
  type SubmissionPageSnapshot as PageSnapshot
} from '@/utils/submissionDiscovery'

export type HumanGateType = 'authentication' | 'verification' | 'confirmation'

export type HumanGate = {
  type: HumanGateType
  detectedUrl: string
  resumeUrl: string
  actionLabel?: string
  interactionTabId?: number
  googleAttempted?: boolean
  googleAccountSelected?: boolean
  googleConsentApproved?: boolean
  googleQueueState?: 'queued' | 'running' | 'waiting_human' | 'completed' | 'skipped'
  detectedAt: number
}

export type BatchStatus = 'pending' | 'opening' | 'preflight' | 'checking' | 'finding' | 'awaiting_human' | 'verifying' | 'filling' | 'review' | 'failed'

export type LoginQueueStatus = 'idle' | 'queued' | 'processing' | 'waiting_human'

export type BatchItem = {
  id: string
  inputUrl: string
  currentUrl?: string
  submitUrl?: string
  tabId?: number
  status: BatchStatus
  message: string
  filledCount?: number
  failedCount?: number
  diagnostics?: string[]
  feedback?: RunFeedbackValue
  humanGate?: HumanGate
}

export type BatchRunnerState = {
  urlText: string
  items: BatchItem[]
  running: boolean
  useDedicatedWindow: boolean
  runLogs: RunLogEntry[]
  logStatus: string
  loginQueueStatus: LoginQueueStatus
  loginQueueCount: number
  activeLoginItemId?: string
  authenticatedHostCount: number
  loginQueueMessage: string
}

type BatchRunnerListener = (state: BatchRunnerState) => void

const SUBMIT_CACHE_KEY = 'batchSubmitPageCache'
const AUTH_SUCCESS_CACHE_KEY = 'batchAuthenticatedHostCache'
const MAX_CANDIDATE_TRIES = 48
const MAX_LINK_GRAPH_TRIES = 36
const MAX_LINK_GRAPH_DEPTH = 8
const MAX_LINK_CANDIDATES_PER_PAGE = 8
const MAX_CONCURRENT_AUTOMATION_ITEMS = 2
const AUTOMATION_WORKER_STAGGER_MS = 1400
const TRANSIENT_PAGE_RETRY_DELAYS_MS = [4500, 10000]
const GOOGLE_LOGIN_SURFACE_TIMEOUT_MS = 18000
const GOOGLE_LOGIN_RETURN_TIMEOUT_MS = 30000
const AUTH_SUCCESS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const COMMON_SUBMIT_PATHS = [
  '/submit',
  '/submit/',
  '/submit/list',
  '/submit/list/',
  '/services/submit',
  '/services/submit/',
  '/submit-tool',
  '/submit-tool/',
  '/submit-a-tool',
  '/submit-a-tool/',
  '/submit-ai-tool',
  '/submit-ai-tool/',
  '/submit-product',
  '/submit-product/',
  '/submit-startup',
  '/submit-startup/',
  '/submit-listing',
  '/submit-listing/',
  '/submit-site',
  '/submit-site/',
  '/add',
  '/add/',
  '/add-tool',
  '/add-tool/',
  '/add-ai-tool',
  '/add-ai-tool/',
  '/add-product',
  '/add-product/',
  '/add-startup',
  '/add-startup/',
  '/add-listing',
  '/add-listing/',
  '/add-site',
  '/add-website',
  '/add-link',
  '/add-ai',
  '/add-ai/',
  '/add-ai/free',
  '/add-ai/free/',
  '/apps/new',
  '/apps/new/',
  '/products/new',
  '/products/new/',
  '/startups/new',
  '/startups/new/',
  '/new',
  '/new/',
  '/suggest',
  '/suggest/',
  '/suggest-tool',
  '/suggest-tool/',
  '/suggest-product',
  '/suggest-product/',
  '/list-your-tool',
  '/list-your-tool/',
  '/list-your-product',
  '/list-your-product/',
  '/partner/request',
  '/partner/request/',
  '/dashboard/startups/new',
  '/index.php?view=post',
  '/register',
  '/register/',
  '/contact',
  '/contact/',
  '/contact-us',
  '/contact-us/'
]

type MainFrameNavigationError = {
  code: string
  url: string
  occurredAt: number
}

type TransientPageFailure = {
  code: string
  message: string
  retryable: boolean
}

class TransientPageError extends Error {
  code: string
  retryable: boolean

  constructor(failure: TransientPageFailure) {
    super(failure.message)
    this.name = 'TransientPageError'
    this.code = failure.code
    this.retryable = failure.retryable
  }
}

const mainFrameNavigationErrors = new Map<number, MainFrameNavigationError>()

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    mainFrameNavigationErrors.delete(details.tabId)
  }
})

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0) return

  mainFrameNavigationErrors.set(details.tabId, {
    code: details.error.replace(/^net::/, ''),
    url: details.url,
    occurredAt: Date.now()
  })
})

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) {
    mainFrameNavigationErrors.delete(details.tabId)
  }
})

function normalizeInputUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).toString()
  } catch {
    return ''
  }
}

function parseUrlList(value: string) {
  const urls = value
    .split(/[\n,]+/)
    .map(normalizeInputUrl)
    .filter(Boolean)

  return Array.from(new Set(urls))
}

function normalizeText(value: string) {
  return normalizeDiscoveryText(value)
}

function getOrigin(url: string) {
  return new URL(url).origin
}

function getPageSnapshotDirectly(): PageSnapshot {
  const getLinkContext = (link: HTMLAnchorElement | HTMLAreaElement) => {
    const boundedContainer = link.closest('li, p, td, th, [role="menuitem"]')
    const parent = link.parentElement
    const parentIsPageChrome = parent?.matches('nav, header, footer')
    const nearby = [
      link.getAttribute('aria-label') || '',
      link.title || '',
      boundedContainer?.textContent || '',
      !boundedContainer && !parentIsPageChrome ? parent?.textContent || '' : ''
    ]

    return nearby
      .map((value) => value.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, 280)
  }

  const embeddedFormLinks = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src]'))
    .map((frame) => ({
      text: frame.title || frame.getAttribute('aria-label') || 'Embedded submission form',
      href: frame.src,
      context: frame.closest<HTMLElement>('section, article, main, form, [role="main"]')?.innerText?.slice(0, 280) || '',
      hrefLang: '',
      rel: ''
    }))
    .filter((link) => Boolean(link.href))

  return {
    title: document.title || '',
    url: window.location.href,
    text: (document.body?.innerText || document.body?.textContent || '').slice(0, 6000),
    links: [...Array.from(document.links)
      .map((link) => ({
        text: link.textContent?.trim() || link.getAttribute('aria-label') || link.title || '',
        href: link.href,
        context: getLinkContext(link),
        hrefLang: link.getAttribute('hreflang') || '',
        rel: link.rel || ''
      }))
      .filter((link) => Boolean(link.href)), ...embeddedFormLinks]
      .slice(0, 900)
  }
}

function hasCredentialControlsDirectly() {
  const roots: Array<Document | ShadowRoot> = [document]
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index]
    root.querySelectorAll<HTMLElement>('*').forEach((element) => {
      if (element.shadowRoot) roots.push(element.shadowRoot)
    })
  }

  const inputs = roots.flatMap((root) => (
    Array.from(root.querySelectorAll<HTMLInputElement>('input'))
  )).filter((input) => {
    const style = window.getComputedStyle(input)
    const rect = input.getBoundingClientRect()
    return (
      !input.disabled &&
      input.type !== 'hidden' &&
      input.getAttribute('aria-hidden') !== 'true' &&
      !input.closest('[aria-hidden="true"], [inert]') &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || '1') > 0 &&
      rect.width > 0 &&
      rect.height > 0
    )
  })

  const hasPasswordField = inputs.some((input) => {
    const autocomplete = input.autocomplete.toLowerCase()
    return (
      input.type === 'password' ||
      autocomplete === 'current-password' ||
      autocomplete === 'new-password'
    )
  })
  if (hasPasswordField) return true

  const loginText = /\b(log\s*in|login|sign\s*in|signin)\b|登录|登入|登錄/i
  const registrationText = /\b(sign\s*up|signup|register|create\s+(?:an?\s+)?account)\b|注册|註冊/i
  const accountText = /\b(account|profile|member|username|user\s*name)\b|账号|帐号|帳號|账户|帐户|帳戶|用户名|用戶名/i
  const newsletterText = /\b(newsletter|subscribe|mailing\s+list|email\s+updates)\b|订阅|訂閱|电子报|電子報/i
  const identityInputs = inputs.filter((input) => {
    const identity = [
      input.type,
      input.name,
      input.id,
      input.autocomplete,
      input.placeholder,
      input.getAttribute('aria-label') || ''
    ].join(' ')
    return /\b(email|e-mail|username|user\s*name|account|login)\b|邮箱|郵箱|用户名|用戶名|帐号|帳號/i.test(identity)
  })

  return identityInputs.some((input) => {
    const container = input.closest<HTMLElement>('form, [role="form"], [role="dialog"]')
    if (!container) return false

    const containerText = [
      container.getAttribute('aria-label') || '',
      container.getAttribute('data-testid') || '',
      container.innerText || container.textContent || ''
    ].join(' ').slice(0, 2400)
    if (newsletterText.test(containerText) || (!loginText.test(containerText) && !registrationText.test(containerText))) {
      return false
    }

    return Array.from(container.querySelectorAll<HTMLElement>(
      'button, [role="button"], input[type="button"], input[type="submit"], a[href]'
    )).some((action) => {
      const label = [
        action.getAttribute('aria-label') || '',
        action.textContent || '',
        action instanceof HTMLInputElement ? action.value : ''
      ].join(' ')
      return loginText.test(label) || (
        registrationText.test(label) && accountText.test(containerText)
      )
    })
  })
}

async function scanCredentialControls(tabId: number) {
  try {
    const credentialResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: hasCredentialControlsDirectly
    })
    return credentialResults.some((result) => result.result === true)
  } catch {
    // Restricted frames and browser error pages may not allow this read-only
    // scan. Callers still have URL-based authentication detection.
    return false
  }
}

async function getPageSnapshot(tabId: number) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: getPageSnapshotDirectly
  })

  return result.result as PageSnapshot
}

function isLikely404(snapshot: PageSnapshot) {
  const text = normalizeText(`${snapshot.title} ${snapshot.text.slice(0, 800)}`)
  return /\b(404|not found|page not found|doesn t exist|does not exist|页面不存在|找不到页面)\b/.test(text)
}

type BotChallengeDetection = {
  detected: boolean
  provider?: 'cloudflare' | 'hostinger' | 'browser'
  evidence?: string
  statusCode?: number
}

async function detectBotChallengeDirectly(): Promise<BotChallengeDetection> {
  const normalize = (value: string) => value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const title = normalize(document.title || '')
  const url = window.location.href.toLowerCase()
  const bodyText = normalize((document.body?.innerText || document.body?.textContent || '').slice(0, 12000))
  const challengeSurfaceText = `${title} ${bodyText.slice(0, 2400)}`
  const markup = (document.documentElement?.outerHTML || '').slice(0, 180000).toLowerCase()
  const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming & {
    responseStatus?: number
  }
  const statusCode = Number(navigationEntry?.responseStatus || 0) || undefined

  const cloudflareDomMarker = Boolean(document.querySelector([
    '#cf-challenge-running',
    '#cf-spinner-please-wait',
    '.cf-browser-verification',
    '[id^="cf-chl-"]',
    'script[src*="/cdn-cgi/challenge-platform/"]',
    'form#challenge-form[action*="/cdn-cgi/"]',
    'form[action*="/cdn-cgi/challenge-platform/"]',
    'input[name^="cf_chl_"]'
  ].join(',')))
  const cloudflareUrlMarker = (
    /(?:^|\.)challenges\.cloudflare\.com$/i.test(window.location.hostname) ||
    /\/cdn-cgi\/challenge-platform\/|[?&](?:__)?cf_chl_/i.test(url)
  )
  const cloudflareScriptMarker = Array.from(document.scripts).some((script) => (
    /\b_cf_chl_(?:opt|enter)\b|\bwindow\._cf_chl\b/.test(script.textContent || '')
  ))
  const hostingerMarker = (
    /\bhostinger\b|\bhcdn\b/.test(challengeSurfaceText) ||
    /(?:hostinger|hcdn)[^"'<>]{0,80}(?:challenge|verification|browser)/.test(markup)
  )
  const checkingBrowser = /\bchecking (?:your|the) browser before accessing\b/.test(challengeSurfaceText)
  const browserVerification = /\b(?:browser|security|human) verification\b|\bverifying that you are not a robot\b|\bverify (?:that )?you are (?:a )?human\b|\bplease stand by while we (?:are )?checking your browser\b|安全验证|安全驗證|验证您不是自动程序|驗證您不是自動程式/.test(challengeSurfaceText)
  const automaticRedirect = /\bthis process is automatic\b.*\b(?:redirect|browser)\b/.test(bodyText)
  const challengeTitle = (
    /^(?:just a moment|checking (?:your|the) browser|bot verification|browser verification|security verification)(?:\s|$)/.test(title) ||
    /^attention required(?: cloudflare)?(?:\s|$)/.test(title)
  )
  const forbiddenWafPage = (
    (statusCode === 403 || /\b403 forbidden\b/.test(`${title} ${bodyText.slice(0, 600)}`)) &&
    (
      cloudflareDomMarker ||
      cloudflareScriptMarker ||
      hostingerMarker ||
      /\b(?:cloudflare ray id|attention required|request (?:was )?blocked|access denied)\b/.test(challengeSurfaceText)
    )
  )
  let cfMitigatedHeader = false
  if (
    statusCode === 403 ||
    cloudflareUrlMarker ||
    cloudflareDomMarker ||
    cloudflareScriptMarker ||
    challengeTitle ||
    checkingBrowser
  ) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(window.location.href, {
        method: 'HEAD',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal
      })
      cfMitigatedHeader = response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge'
    } catch {
      // DOM and navigation signals remain available when the challenge blocks
      // the same-origin confirmation request.
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  if (
    cfMitigatedHeader ||
    cloudflareUrlMarker ||
    cloudflareDomMarker ||
    cloudflareScriptMarker ||
    (challengeTitle && /\bcloudflare\b|\bjust a moment\b/.test(challengeSurfaceText)) ||
    forbiddenWafPage && /\bcloudflare\b|\bcf ray\b/.test(`${challengeSurfaceText} ${markup}`)
  ) {
    return {
      detected: true,
      provider: 'cloudflare',
      evidence: cfMitigatedHeader
        ? 'Cloudflare cf-mitigated: challenge 响应'
        : forbiddenWafPage
          ? 'Cloudflare 403/WAF 挑战页'
          : 'Cloudflare 挑战页 DOM 标记',
      statusCode
    }
  }

  if (
    hostingerMarker && (
      challengeTitle ||
      forbiddenWafPage ||
      checkingBrowser && bodyText.length < 2400
    ) ||
    checkingBrowser && bodyText.length < 2400 && /\bjust a moment\b/.test(challengeSurfaceText)
  ) {
    return {
      detected: true,
      provider: hostingerMarker ? 'hostinger' : 'browser',
      evidence: hostingerMarker ? 'Hostinger hCDN 浏览器挑战页' : '浏览器安全检查页',
      statusCode
    }
  }

  if (
    challengeTitle && (browserVerification || automaticRedirect) ||
    checkingBrowser && automaticRedirect ||
    forbiddenWafPage && browserVerification
  ) {
    return {
      detected: true,
      provider: 'browser',
      evidence: forbiddenWafPage ? '403 浏览器安全挑战页' : '浏览器安全挑战页',
      statusCode
    }
  }

  return { detected: false, statusCode }
}

function isLikelyBotChallenge(snapshot: PageSnapshot) {
  const text = normalizeText(`${snapshot.title} ${snapshot.url} ${snapshot.text.slice(0, 3000)}`)
  const hasChallengeLanguage = /\b(just a moment|checking (?:your|the) browser before accessing|security verification|browser verification|verify (?:that )?you are human|verifying that you are not a robot|performing security verification|this process is automatic)\b|请稍候|安全验证|安全驗證|驗證您不是自動程序|验证您不是自动程序/.test(text)
  const hasProviderSignal = /\b(cloudflare|hostinger|hcdn|cf mitigated|cf ray)\b|cdn cgi challenge platform/.test(text)
  const hasChallengeTitle = /^(?:just a moment|checking (?:your|the) browser|bot verification|browser verification|security verification)\b/.test(normalizeText(snapshot.title))
  const hasWaf403 = /\b403 forbidden\b/.test(text) && /\b(cloudflare|hostinger|hcdn|attention required|access denied|request blocked)\b/.test(text)
  return hasWaf403 || hasChallengeTitle && (hasChallengeLanguage || hasProviderSignal) || hasChallengeLanguage && hasProviderSignal
}

async function scanBotChallenge(tabId: number, snapshot: PageSnapshot | null) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: detectBotChallengeDirectly
    })
    if (result.result?.detected) return result.result
  } catch {
    // Fall through to the text-only snapshot check when the page blocks script
    // injection or the browser is showing a restricted error document.
  }

  if (snapshot && isLikelyBotChallenge(snapshot)) {
    return {
      detected: true,
      provider: 'browser' as const,
      evidence: '页面标题或正文显示浏览器安全挑战'
    }
  }

  return { detected: false } satisfies BotChallengeDetection
}

function detectTransientPageFailure(
  tabId: number,
  snapshot: PageSnapshot | null,
  readError?: unknown
): TransientPageFailure | null {
  const navigationError = mainFrameNavigationErrors.get(tabId)
  if (navigationError) {
    const code = navigationError.code.toUpperCase()
    if (/(?:SOCKS|PROXY|TUNNEL)_CONNECTION_FAILED/.test(code)) {
      return {
        code,
        message: `代理连接失败（${code}）。批量开页时代理可能掉线、过载或达到并发上限。`,
        retryable: true
      }
    }

    if (/(?:CONNECTION|NETWORK|INTERNET|NAME|ADDRESS|TIMED_OUT|TIMEOUT|DNS)/.test(code)) {
      return {
        code,
        message: `网页网络连接失败（${code}），尚未进入可填写的页面。`,
        retryable: true
      }
    }

    return {
      code,
      message: `网页加载失败（${code}），尚未进入可填写的页面。`,
      retryable: false
    }
  }

  if (snapshot) {
    const text = normalizeText(`${snapshot.title} ${snapshot.text.slice(0, 2200)}`)
    const statusMatch = text.match(/\b(502|503|504)\b/)
    if (
      statusMatch &&
      /\b(bad gateway|service unavailable|gateway time out|gateway timeout|host error|web server.*timed out|origin.*unreachable)\b/.test(text)
    ) {
      return {
        code: `HTTP_${statusMatch[1]}`,
        message: `目标网站服务器暂时不可用（${statusMatch[1]}）。浏览器和代理已连通，但网站源服务器没有正常响应。`,
        retryable: true
      }
    }
  }

  if (readError && isBrowserErrorPageError(readError)) {
    return {
      code: 'BROWSER_ERROR_PAGE',
      message: '浏览器停在网络错误页，插件尚未进入可填写的页面。',
      retryable: true
    }
  }

  return null
}

function pageLooksLikeSubmissionInfo(snapshot: PageSnapshot | null, fields: ExtractedFormField[] = []) {
  if (!snapshot) return false

  const text = normalizeText([
    snapshot.title,
    snapshot.url,
    snapshot.text.slice(0, 2500),
    fields.map((field) => `${field.label} ${field.placeholder} ${field.name}`).join(' ')
  ].join(' '))

  const hasSubmitIntent = /\b(submit|submission|add\s+(?:your|a|an)|suggest|recommend|recommand|list\s+your|get\s+listed|feature|promote|nominate|publish|post\s+(?:a|an|your)|register|enviar|cadastrar)\b|提交|投稿|收录|收錄|推荐|推薦|新增|刊登|发布|發佈|登記|登记/.test(text)
  const hasProductIntent = /\b(product|tool|startup|app|software|website|site|directory|listing|ai tool|company|business|projeto|produto|ferramenta|diret[oó]rio)\b|產品|产品|工具|網站|网站|目錄|目录|公司|企業|企业|商家/.test(text)
  const hasFormHints = /\b(website url|product website|tool url|app url|description|category|submit a product|submit product|list your product|add your tool|feature my product|add company|add site|nome do produto|nome do projeto|descri[cç][aã]o|categoria)\b|工具名稱|工具名称|網站連結|网站链接|網址|网址|產品名稱|产品名称|公司名稱|公司名称/.test(text)
  const looksLikeDistractor = /\b(search results|search|comment|reply|newsletter|subscribe|login|sign in|contact us)\b|搜尋|搜索|評論|评论|訂閱|订阅|登入|登录/.test(text) && fields.length <= 3

  return !looksLikeDistractor && ((hasSubmitIntent && hasProductIntent) || hasFormHints)
}

async function fetchTextWithTimeout(url: string, timeoutMs: number = 4500) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit'
    })
    if (!response.ok) return ''
    return response.text()
  } catch {
    return ''
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function extractSubmitUrlsFromText(text: string, origin: string) {
  const urls = new Set<string>()
  const normalizedText = text.replace(/\\\//g, '/')
  const locMatches = Array.from(normalizedText.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)).map((match) => match[1])
  const plainMatches = Array.from(normalizedText.matchAll(/https?:\/\/[^\s"'<>]+/gi)).map((match) => match[0])
  const hrefMatches = Array.from(normalizedText.matchAll(/\bhref=["']([^"']+)["']/gi)).map((match) => match[1])
  const routeMatches = Array.from(normalizedText.matchAll(/["'](\/[^"']*(?:submit|add|post|sign-up|suggest|recommend|recommand|feature|promote|nominate|publish|register|listing|product|startup|tool|directory|enviar|cadastrar|projeto|produto|ferramenta)[^"']*)["']/gi)).map((match) => match[1])

  ;[...locMatches, ...plainMatches, ...hrefMatches, ...routeMatches].forEach((rawUrl) => {
    try {
      const url = new URL(rawUrl.trim(), origin)
      const normalized = normalizeText(`${url.pathname} ${url.search}`)
      if (/\b(submit|add|post|sign up|suggest|recommend|recommand|feature|promote|nominate|publish|register|listing|product|startup|tool|enviar|cadastrar|projeto|produto|ferramenta)\b/.test(normalized)) {
        urls.add(getCanonicalUrl(url.toString()))
      }
    } catch {
      // Ignore malformed sitemap entries.
    }
  })

  return Array.from(urls)
}

async function fetchSourceCandidateUrls(originalUrl: string, addDiagnostic?: (message: string) => void) {
  const origin = getOrigin(originalUrl)
  const sourceUrls = Array.from(new Set([
    originalUrl,
    origin
  ]))
  const candidates = new Set<string>()

  for (const url of sourceUrls) {
    const source = await fetchTextWithTimeout(url)
    if (!source) continue

    const extracted = extractSubmitUrlsFromText(source, origin)
    extracted.forEach((candidate) => candidates.add(candidate))
    addDiagnostic?.(`从源码 ${url} 找到 ${extracted.length} 个候选入口`)
  }

  return Array.from(candidates).slice(0, 32)
}

async function fetchSitemapCandidateUrls(originalUrl: string) {
  const origin = getOrigin(originalUrl)
  const candidates = new Set<string>()
  const robotsText = await fetchTextWithTimeout(new URL('/robots.txt', origin).toString())
  const sitemapUrls = Array.from(robotsText.matchAll(/^sitemap:\s*(.+)$/gim))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 4)

  const defaultSitemaps = [
    new URL('/sitemap.xml', origin).toString(),
    new URL('/sitemap_index.xml', origin).toString()
  ]

  for (const sitemapUrl of Array.from(new Set([...sitemapUrls, ...defaultSitemaps])).slice(0, 5)) {
    const sitemapText = await fetchTextWithTimeout(sitemapUrl)
    extractSubmitUrlsFromText(sitemapText, origin).forEach((url) => candidates.add(url))
  }

  return Array.from(candidates).slice(0, 20)
}

async function buildFallbackSubmissionCandidates(
  snapshot: PageSnapshot,
  originalUrl: string,
  intentText: string,
  addDiagnostic?: (message: string) => void
) {
  const candidates: SubmissionCandidate[] = createPathGuessSubmissionCandidates(
    snapshot,
    originalUrl,
    COMMON_SUBMIT_PATHS,
    intentText
  )

  const sitemapCandidates = await fetchSitemapCandidateUrls(originalUrl)
  if (sitemapCandidates.length > 0) {
    addDiagnostic?.(`从 sitemap/robots 找到 ${sitemapCandidates.length} 个候选入口`)
  }
  sitemapCandidates.forEach((url, index) => {
    candidates.push({
      url,
      score: 54 - Math.min(index, 18),
      depth: 1,
      sourceUrl: snapshot.url || originalUrl,
      evidence: 'sitemap/robots 中的提交相关路径',
      source: 'sitemap'
    })
  })

  const sourceCandidates = await fetchSourceCandidateUrls(originalUrl, addDiagnostic)
  sourceCandidates.forEach((url, index) => {
    candidates.push({
      url,
      score: 66 - Math.min(index, 24),
      depth: 1,
      sourceUrl: snapshot.url || originalUrl,
      evidence: '页面源码中的提交相关路径',
      source: 'source'
    })
  })

  return mergeSubmissionCandidates(candidates)
}

async function readSubmitCache() {
  const data = await chrome.storage.local.get(SUBMIT_CACHE_KEY)
  return (data[SUBMIT_CACHE_KEY] || {}) as Record<string, string>
}

async function rememberSubmitUrl(inputUrl: string, submitUrl: string) {
  const cache = await readSubmitCache()
  const host = getUrlHost(inputUrl)
  if (!host) return

  await chrome.storage.local.set({
    [SUBMIT_CACHE_KEY]: {
      ...cache,
      [host]: submitUrl
    }
  })
}

async function readAuthenticatedHostCache() {
  const data = await chrome.storage.local.get(AUTH_SUCCESS_CACHE_KEY)
  const rawCache = (data[AUTH_SUCCESS_CACHE_KEY] || {}) as Record<string, number>
  const now = Date.now()
  const cache = Object.fromEntries(
    Object.entries(rawCache).filter(([, authenticatedAt]) => (
      Number.isFinite(authenticatedAt) &&
      now - authenticatedAt < AUTH_SUCCESS_CACHE_TTL_MS
    ))
  )

  if (Object.keys(cache).length !== Object.keys(rawCache).length) {
    await chrome.storage.local.set({ [AUTH_SUCCESS_CACHE_KEY]: cache })
  }

  return cache
}

async function rememberAuthenticatedHost(url: string) {
  const host = getUrlHost(url)
  if (!host) return 0

  const cache = await readAuthenticatedHostCache()
  const nextCache = {
    ...cache,
    [host]: Date.now()
  }
  await chrome.storage.local.set({ [AUTH_SUCCESS_CACHE_KEY]: nextCache })
  return Object.keys(nextCache).length
}

async function getNormalWindowId() {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
  return windows.find((window) => window.focused)?.id || windows[0]?.id
}

async function isWindowAvailable(windowId?: number) {
  if (!windowId) return false

  try {
    await chrome.windows.get(windowId)
    return true
  } catch {
    return false
  }
}

async function openWorkTab(
  url: string,
  options: { quiet?: boolean; windowId?: number } = {}
) {
  if (options.quiet) {
    if (await isWindowAvailable(options.windowId)) {
      return chrome.tabs.create({
        windowId: options.windowId,
        url,
        active: false
      })
    }

    const window = await chrome.windows.create({
      url,
      type: 'normal',
      focused: false,
      width: 980,
      height: 860,
      left: 40,
      top: 40
    })
    const firstTab = window.tabs?.[0]
    if (firstTab?.id) return firstTab
  }

  const windowId = await getNormalWindowId()
  const createProperties: chrome.tabs.CreateProperties = {
    url,
    active: !options.quiet
  }

  if (windowId) {
    createProperties.windowId = windowId
  }

  return chrome.tabs.create(createProperties)
}

async function navigateAndInspect(tabId: number, url: string, activate: boolean = false) {
  const updateProperties: chrome.tabs.UpdateProperties = { url }
  if (activate) {
    updateProperties.active = true
  }

  await chrome.tabs.update(tabId, updateProperties)
  return inspectCurrentTab(tabId)
}

async function inspectCurrentTab(tabId: number) {
  let tab = await waitForTabComplete(tabId)
  // A completed tab can still be mounting inputs, selectors, or rich text editors.
  // The extractor below also waits for stable field scans before returning.
  await wait(850)

  let snapshot: PageSnapshot | null = null
  let readError: unknown
  try {
    snapshot = await getPageSnapshot(tabId)
  } catch (error) {
    readError = error
    snapshot = null
  }

  let botChallenge = await scanBotChallenge(tabId, snapshot)
  if (botChallenge.detected) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await wait(2000)
      try {
        tab = await waitForTabComplete(tabId)
        snapshot = await getPageSnapshot(tabId)
        botChallenge = await scanBotChallenge(tabId, snapshot)
        if (!botChallenge.detected) break
      } catch {
        // Keep the last readable challenge snapshot for the caller.
      }
    }

    if (botChallenge.detected) {
      return {
        tab,
        fields: [] as ExtractedFormField[],
        snapshot,
        hasCredentialFields: false,
        botChallenge,
        pageFailure: detectTransientPageFailure(tabId, snapshot, readError)
      }
    }
  }

  let fields: ExtractedFormField[] = []
  try {
    fields = await extractFormFieldsFromTab(tabId)
  } catch (error) {
    readError = error
    fields = []
  }

  try {
    snapshot = await getPageSnapshot(tabId)
  } catch (error) {
    readError ||= error
    snapshot = null
  }

  const pageLooksTemporarilyEmpty = (
    fields.length === 0 &&
    Boolean(snapshot) &&
    normalizeText(snapshot?.text || '').length < 80
  )
  if (pageLooksTemporarilyEmpty) {
    // Some client-rendered submission routes briefly finish an empty document,
    // then redirect to an authentication host or mount the actual form.
    await wait(3000)
    try {
      tab = await waitForTabComplete(tabId)
      fields = await extractFormFieldsFromTab(tabId).catch(() => [])
      snapshot = await getPageSnapshot(tabId).catch(() => snapshot)
      if (snapshot || fields.length > 0) {
        readError = undefined
      }
    } catch {
      // Keep the first readable snapshot when the delayed navigation fails.
    }
  }

  botChallenge = await scanBotChallenge(tabId, snapshot)
  if (botChallenge.detected) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await wait(2000)
      try {
        const refreshedSnapshot = await getPageSnapshot(tabId)
        snapshot = refreshedSnapshot
        botChallenge = await scanBotChallenge(tabId, refreshedSnapshot)
        if (!botChallenge.detected) {
          fields = await extractFormFieldsFromTab(tabId).catch(() => [])
          break
        }
      } catch {
        // Keep the last readable challenge snapshot for the caller.
      }
    }
  }

  const hasCredentialFields = await scanCredentialControls(tabId)

  return {
    tab,
    fields,
    snapshot,
    hasCredentialFields,
    botChallenge,
    pageFailure: detectTransientPageFailure(tabId, snapshot, readError)
  }
}

function isDirectSubmissionUrl(url: string) {
  const normalized = normalizeText(url)
  return /\b(submit|subm+ission|submitter|add|post|new|register|sign up|listing|directory|suggest|recommend|recommand|nominate|feature|promote|product|tool|startup|classified|free ad|view|tip|pitch|crowdsourcing|enviar|cadastrar|projeto|produto|ferramenta)\b|提交|投稿|收录|收錄|推荐|推薦|新增|刊登|发布|發佈|登記|登记/.test(normalized)
}

function hasUnsafeFinalActionIntent(url: string) {
  const unsafeAction = /(?:^|[^a-z0-9])(?:final(?:ize|ise)?|confirm(?:ation)?|publish|payment|checkout)(?:[^a-z0-9]|$)/i
  try {
    const parsed = new URL(url)
    return (
      parsed.pathname.split('/').some((segment) => unsafeAction.test(segment)) ||
      Array.from(parsed.searchParams.entries()).some(([key, value]) => (
        unsafeAction.test(key) || unsafeAction.test(value)
      ))
    )
  } catch {
    return true
  }
}

function isAuthenticationGateUrl(url: string) {
  try {
    return /\/(?:auth|login|log-in|signin|sign-in|signup|sign-up|register|account|new-account|entrar|cadastro|cadastrar)(?:[/.]|$)/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

function getAuthenticationResumeUrl(authUrl: string, fallbackUrl: string) {
  try {
    const parsed = new URL(authUrl)
    const expectedHost = getUrlHost(fallbackUrl)
    const redirectKeys = ['callbackUrl', 'redirect', 'returnTo', 'return', 'next']

    for (const key of redirectKeys) {
      const value = parsed.searchParams.get(key)
      if (!value) continue

      const candidate = new URL(value, parsed.origin)
      if (getUrlHost(candidate.toString()) === expectedHost) {
        return candidate.toString()
      }
    }
  } catch {
    // Fall back to the page that led to the authentication gate.
  }

  return fallbackUrl
}

type GoogleLoginAutomationSettings = {
  enabled: boolean
}

type GoogleLoginAutomationResult = {
  clicked: boolean
  actionLabel?: string
  interactionTabId?: number
  accountSelected: boolean
  consentApproved: boolean
  returnedToOriginalSite: boolean
  detectedUrl?: string
  reason?: string
}

async function readGoogleLoginAutomationSettings(): Promise<GoogleLoginAutomationSettings> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS)
    const rawValue = stored[STORAGE_KEYS.SETTINGS]
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue
    const settings = parsed?.state || parsed || {}

    return {
      enabled: settings.autoGoogleLogin !== false
    }
  } catch {
    return {
      enabled: false
    }
  }
}

function isGoogleAccountsUrl(url?: string) {
  if (!url) return false

  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'accounts.google.com'
  } catch {
    return false
  }
}

function clickVisibleGoogleAuthenticationActionDirectly() {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim()
  const googleText = /(?:google|谷歌|グーグル|구글)/i
  const authenticationText = /(?:continue|sign\s*(?:in|up)|log\s*in|login|entrar|continuar|iniciar\s+sesión|connexion|continuer|anmelden|fortfahren|登录|登入|登錄|继续|繼續|ログイン|続行|계속|로그인)/i
  const selector = 'a[href], button, [role="button"], input[type="button"], input[type="submit"]'
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter((element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const disabled = (
        element.hasAttribute('disabled') ||
        element.getAttribute('aria-disabled') === 'true'
      )
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        !disabled
      )
    })
    .map((element) => ({
      element,
      label: normalize([
        element.getAttribute('aria-label') || '',
        element.textContent || '',
        element instanceof HTMLInputElement ? element.value : '',
        element.title || ''
      ].filter(Boolean).join(' '))
    }))
    .filter(({ label }) => (
      googleText.test(label) &&
      (authenticationText.test(label) || /^(?:google|谷歌|グーグル|구글)$/.test(label))
    ))

  const uniqueCandidates = candidates.filter(({ element }, index) => (
    !candidates.some((other, otherIndex) => (
      otherIndex !== index &&
      element.contains(other.element)
    ))
  ))

  if (uniqueCandidates.length !== 1) {
    return {
      clicked: false,
      matchCount: uniqueCandidates.length,
      label: ''
    }
  }

  uniqueCandidates[0].element.click()
  return {
    clicked: true,
    matchCount: 1,
    label: uniqueCandidates[0].label
  }
}

function selectFirstGoogleAccountDirectly() {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-identifier]'))
    .filter((element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        element.getAttribute('aria-disabled') !== 'true'
      )
    })

  const uniqueCandidates = candidates.filter((element, index) => (
    !candidates.some((other, otherIndex) => (
      otherIndex !== index &&
      element.contains(other)
    ))
  ))

  if (uniqueCandidates.length !== 1) {
    return {
      selected: false,
      matchCount: uniqueCandidates.length,
      selectedEmail: '',
      selectionMode: '',
      reason: uniqueCandidates.length > 1
        ? '账号选择页有多个可用账号，需要按配置邮箱或由用户确认'
        : '账号选择页没有找到可见的已登录账号'
    }
  }

  const firstAccount = uniqueCandidates[0]
  const selectedEmail = (firstAccount.getAttribute('data-identifier') || '').trim().toLowerCase()
  firstAccount.click()
  return {
    selected: true,
    matchCount: 1,
    selectedEmail,
    selectionMode: 'first',
    reason: ''
  }
}

function clickSafeGoogleBasicConsentDirectly() {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim()
  const pageText = normalize(document.body?.innerText || '')
  const currentHost = window.location.hostname.toLowerCase()
  const isGoogleConsentHost = (
    window.location.protocol === 'https:' &&
    currentHost === 'accounts.google.com'
  )

  if (!isGoogleConsentHost) {
    return {
      consentPage: false,
      safe: false,
      clicked: false,
      reason: '当前页面不是 Google 官方授权页'
    }
  }

  const selector = 'button, [role="button"], input[type="button"], input[type="submit"]'
  const continueText = /^(?:continue|继续|繼續|続行|계속)$/
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter((element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const disabled = (
        element.hasAttribute('disabled') ||
        element.getAttribute('aria-disabled') === 'true'
      )
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        !disabled
      )
    })
    .map((element) => ({
      element,
      label: normalize(
        element.getAttribute('aria-label') ||
        element.textContent ||
        (element instanceof HTMLInputElement ? element.value : '')
      )
    }))
    .filter(({ label }) => continueText.test(label))

  const uniqueCandidates = candidates.filter(({ element }, index) => (
    !candidates.some((other, otherIndex) => (
      otherIndex !== index &&
      element.contains(other.element)
    ))
  ))
  const hasConsentHeading = (
    /\bgoogle will allow\b/.test(pageText) ||
    /\bsign in to\b/.test(pageText) ||
    /google 将允许|google 將允許|登录到|登入/.test(pageText)
  )
  const hasProfilePermission = (
    /name and profile picture/.test(pageText) ||
    /姓名和个人资料照片|姓名和個人資料相片|名前とプロフィール写真|이름 및 프로필 사진/.test(pageText)
  )
  const hasEmailPermission = (
    /email address/.test(pageText) ||
    /电子邮件地址|電子郵件地址|メールアドレス|이메일 주소/.test(pageText)
  )
  const consentPage = (
    hasConsentHeading &&
    uniqueCandidates.length > 0 &&
    (hasProfilePermission || hasEmailPermission)
  )

  if (!consentPage) {
    return {
      consentPage: false,
      safe: false,
      clicked: false,
      reason: ''
    }
  }

  const sensitivePermissionText = /(?:\bgmail\b|\bgoogle drive\b|\bgoogle calendar\b|\bgoogle contacts\b|\byoutube\b|\bgoogle photos\b|\bcalendar events?\b|\bcontact(?:s| list)?\b|\b(?:read|send|compose|manage|edit|delete|download|upload|create)\b.{0,48}\b(?:mail|email|message|file|folder|calendar|event|contact|photo|video)\b|\boffline access\b|\bfull access\b|读取.{0,20}(?:邮件|文件|通讯录|日历)|发送.{0,20}(?:邮件|消息)|管理.{0,20}(?:文件|日历|通讯录|账号)|删除.{0,20}(?:文件|邮件|数据)|存取.{0,20}(?:郵件|檔案|通訊錄|日曆))/
  if (sensitivePermissionText.test(pageText)) {
    return {
      consentPage: true,
      safe: false,
      clicked: false,
      reason: '授权范围超过姓名、头像和邮箱，已保留给人工确认'
    }
  }

  if (!hasProfilePermission || !hasEmailPermission) {
    return {
      consentPage: true,
      safe: false,
      clicked: false,
      reason: '授权页没有同时明确显示姓名/头像和邮箱两项基础信息'
    }
  }

  if (uniqueCandidates.length !== 1) {
    return {
      consentPage: true,
      safe: false,
      clicked: false,
      reason: `授权页出现 ${uniqueCandidates.length} 个“继续”控件，无法安全确定唯一按钮`
    }
  }

  uniqueCandidates[0].element.click()
  return {
    consentPage: true,
    safe: true,
    clicked: true,
    reason: ''
  }
}

function isExpectedLoginReturn(url: string | undefined, expectedUrl: string) {
  if (!url || isGoogleAccountsUrl(url) || isAuthenticationGateUrl(url)) return false
  return getUrlHost(url) === getUrlHost(expectedUrl)
}

async function attemptGoogleLoginAutomation(
  originTabId: number,
  expectedReturnUrl: string,
  shouldContinue: () => boolean = () => true
): Promise<GoogleLoginAutomationResult> {
  const tabsBeforeClick = await chrome.tabs.query({})
  const originTab = tabsBeforeClick.find((tab) => tab.id === originTabId)
  const tabIdsBeforeClick = new Set(tabsBeforeClick.map((tab) => tab.id).filter((id): id is number => Boolean(id)))
  const startedOnGoogleSurface = isGoogleAccountsUrl(originTab?.url)
  let action: {
    clicked: boolean
    matchCount: number
    label: string
  } | undefined = startedOnGoogleSurface
    ? {
        clicked: true,
        matchCount: 1,
        label: 'Google login page'
      }
    : undefined

  if (!startedOnGoogleSurface) {
    const buttonSearchStartedAt = Date.now()

    while (Date.now() - buttonSearchStartedAt < 6000 && shouldContinue()) {
      try {
        const [scriptResult] = await chrome.scripting.executeScript({
          target: { tabId: originTabId },
          func: clickVisibleGoogleAuthenticationActionDirectly
        })
        action = scriptResult.result
        if (action?.clicked || (action?.matchCount || 0) > 1) break
      } catch {
        // The login page may still be rendering or navigating.
      }
      await wait(400)
    }
  }

  if (!action?.clicked) {
    return {
      clicked: false,
      accountSelected: false,
      consentApproved: false,
      returnedToOriginalSite: false,
      reason: action?.matchCount && action.matchCount > 1
        ? `页面有 ${action.matchCount} 个 Google 登录控件，无法安全确定唯一按钮`
        : '未找到唯一、可见的 Google 登录按钮'
    }
  }

  const startedAt = Date.now()
  let interactionTabId = originTabId
  let detectedUrl = originTab?.url
  let googleTab: chrome.tabs.Tab | undefined = startedOnGoogleSurface
    ? originTab
    : undefined
  let returnedToOriginalSite = false
  let googleSurfaceObserved = startedOnGoogleSurface

  const getRelatedTabs = async () => {
    const openTabs = await chrome.tabs.query({})
    return openTabs.filter((tab) => (
      tab.id === originTabId ||
      tab.openerTabId === originTabId ||
      (
        Boolean(tab.id) &&
        !tabIdsBeforeClick.has(tab.id as number) &&
        (
          tab.windowId === originTab?.windowId ||
          isGoogleAccountsUrl(tab.url)
        )
      )
    ))
  }

  while (
    !googleTab &&
    Date.now() - startedAt < GOOGLE_LOGIN_SURFACE_TIMEOUT_MS &&
    shouldContinue()
  ) {
    await wait(400)
    const relatedTabs = await getRelatedTabs()
    const googleSurfaceWasAlreadyObserved = googleSurfaceObserved
    googleTab = relatedTabs.find((tab) => isGoogleAccountsUrl(tab.url))
    if (googleTab) googleSurfaceObserved = true

    const returnedTab = relatedTabs.find((tab) => (
      isExpectedLoginReturn(tab.url, expectedReturnUrl) &&
      (
        tab.url !== originTab?.url ||
        (googleSurfaceWasAlreadyObserved && !googleTab)
      )
    ))
    if (returnedTab) {
      returnedToOriginalSite = true
      interactionTabId = returnedTab.id || originTabId
      detectedUrl = returnedTab.url
      break
    }

    if (googleTab?.id) {
      interactionTabId = googleTab.id
      detectedUrl = googleTab.url
      break
    }
  }

  let accountSelected = false
  let consentApproved = false
  let reason = googleTab?.id
    ? ''
    : '已点击 Google 登录，但没有检测到账号选择页面；可能被浏览器阻止了弹窗'

  if (googleTab?.id) {
    try {
      await waitForTabComplete(googleTab.id)
      await wait(500)
      const returnStartedAt = Date.now()
      let lastInteractionError = ''

      while (
        Date.now() - returnStartedAt < GOOGLE_LOGIN_RETURN_TIMEOUT_MS &&
        shouldContinue()
      ) {
        const relatedTabs = await getRelatedTabs()
        const hasOpenGoogleSurface = relatedTabs.some((tab) => isGoogleAccountsUrl(tab.url))
        const returnedTab = relatedTabs.find((tab) => (
          isExpectedLoginReturn(tab.url, expectedReturnUrl) &&
          (
            tab.url !== originTab?.url ||
            !hasOpenGoogleSurface
          )
        ))
        if (returnedTab) {
          returnedToOriginalSite = true
          interactionTabId = returnedTab.id || originTabId
          detectedUrl = returnedTab.url
          break
        }

        const updatedGoogleTab = (
          relatedTabs.find((tab) => tab.id === googleTab?.id && isGoogleAccountsUrl(tab.url)) ||
          relatedTabs.find((tab) => isGoogleAccountsUrl(tab.url))
        )
        if (!updatedGoogleTab?.id) {
          await wait(500)
          continue
        }

        interactionTabId = updatedGoogleTab.id
        detectedUrl = updatedGoogleTab.url || detectedUrl

        if (!consentApproved) {
          try {
            const [consentResult] = await chrome.scripting.executeScript({
              target: { tabId: updatedGoogleTab.id },
              func: clickSafeGoogleBasicConsentDirectly
            })
            const consent = consentResult.result
            if (consent?.consentPage && consent.clicked) {
              consentApproved = true
              accountSelected = true
              reason = ''
              await wait(900)
              continue
            }
            if (consent?.consentPage && consent.safe === false) {
              reason = consent.reason || 'Google 授权页需要人工确认'
              break
            }
          } catch (error: any) {
            lastInteractionError = error.message || 'Google 授权页暂时不可读取'
          }
        }

        if (!accountSelected) {
          try {
            const [selectionResult] = await chrome.scripting.executeScript({
              target: { tabId: updatedGoogleTab.id },
              func: selectFirstGoogleAccountDirectly
            })
            const selection = selectionResult.result
            if (selection?.selected) {
              accountSelected = true
              reason = ''
              await wait(900)
              continue
            }
            if ((selection?.matchCount || 0) > 1) {
              reason = selection?.reason || '账号选择页出现多个匹配账号，需要人工确认'
              break
            }
          } catch (error: any) {
            lastInteractionError = error.message || 'Google 账号页暂时不可读取'
          }
        }

        await wait(500)
      }

      if (!returnedToOriginalSite) {
        reason = reason || (
          lastInteractionError
            ? `无法读取 Google 登录页：${lastInteractionError}`
            : consentApproved
              ? '已确认基础登录授权，但页面仍停在验证或账号确认步骤'
              : accountSelected
                ? '已选择默认账号，但页面仍停在授权、验证或账号确认步骤'
                : 'Google 登录页没有出现可安全自动处理的账号或授权控件'
        )
      }
    } catch (error: any) {
      reason = `无法安全选择 Google 账号：${error.message || '页面不可读取'}`
    }
  } else if (!shouldContinue()) {
    reason = '登录自动化已停止'
  }

  return {
    clicked: true,
    actionLabel: action.label,
    interactionTabId,
    accountSelected,
    consentApproved,
    returnedToOriginalSite,
    detectedUrl,
    reason
  }
}

function clickVisibleAuthenticationActionDirectly() {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim()
  const exactLoginText = /^(?:log\s*in|login|sign\s*in|entrar|登录|登入|登錄|ログイン|connexion|anmelden|iniciar sesión)$/i
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
    .filter((element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.hasAttribute('disabled')
      )
    })
    .map((element) => ({
      element,
      label: normalize(element.getAttribute('aria-label') || element.textContent || '')
    }))
    .filter(({ label }) => exactLoginText.test(label))

  if (candidates.length !== 1) {
    return { clicked: false, matchCount: candidates.length, label: '' }
  }

  candidates[0].element.click()
  return { clicked: true, matchCount: 1, label: candidates[0].label }
}

function findVisibleSubmissionActionDirectly() {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim()
  const exactSubmissionText = /^(?:submit(?:\s+(?:a|your|the))?\s*(?:tool|product|project|startup|site|website|listing|app)?|add\s+(?:a|your)\s+(?:tool|product|project|startup|site|website|listing|app)|list\s+your\s+(?:tool|product|project|startup|site|website|app)|get\s+listed|ship\s+(?:your\s+)?product|launch\s+(?:your\s+)?(?:tool|product|project|startup)|enviar\s+(?:um\s+|seu\s+)?(?:projeto|produto|site|ferramenta)|cadastrar\s+(?:um\s+|seu\s+)?(?:projeto|produto|site|ferramenta)|提交(?:产品|產品|工具|项目|項目|网站|網站)?|投稿|收录|收錄|推荐(?:工具|产品|網站|网站)?|推薦(?:工具|產品|網站)?|新增(?:工具|產品|网站|網站)?)$/i
  const unsafeAction = /(?:^|[^a-z0-9])(?:final(?:ize|ise)?|confirm(?:ation)?|publish|payment|checkout)(?:[^a-z0-9]|$)/i
  const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .filter((element) => {
      const rawHref = (element.getAttribute('href') || '').trim()
      if (!rawHref || rawHref.startsWith('#') || /^(?:javascript|data|blob|mailto|tel):/i.test(rawHref)) {
        return false
      }

      let destination: URL
      try {
        destination = new URL(rawHref, window.location.href)
      } catch {
        return false
      }
      if (
        destination.pathname.split('/').some((segment) => unsafeAction.test(segment)) ||
        Array.from(destination.searchParams.entries()).some(([key, value]) => (
          unsafeAction.test(key) || unsafeAction.test(value)
        ))
      ) return false

      const target = (element.getAttribute('target') || '').trim().toLowerCase()
      const isOrdinarySameOriginNavigation = (
        ['http:', 'https:'].includes(destination.protocol) &&
        destination.origin === window.location.origin &&
        !destination.hash &&
        destination.href !== window.location.href &&
        (!target || target === '_self') &&
        !element.hasAttribute('download') &&
        !element.hasAttribute('ping') &&
        !element.hasAttribute('form') &&
        !element.hasAttribute('onclick') &&
        !element.hasAttribute('data-method') &&
        !element.hasAttribute('data-turbo-method') &&
        !element.hasAttribute('data-remote') &&
        element.getAttribute('role') !== 'button' &&
        !element.closest('form')
      )
      if (!isOrdinarySameOriginNavigation) return false

      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.hasAttribute('disabled') &&
        element.getAttribute('aria-disabled') !== 'true'
      )
    })
    .map((element) => ({
      label: normalize(element.getAttribute('aria-label') || element.textContent || ''),
      url: new URL(element.getAttribute('href') || '', window.location.href).toString()
    }))
    .filter(({ label }) => exactSubmissionText.test(label))

  if (candidates.length !== 1) {
    return { found: false, matchCount: candidates.length, label: '', url: '' }
  }

  return { found: true, matchCount: 1, ...candidates[0] }
}

async function openVisibleSubmissionAction(
  tabId: number,
  addDiagnostic?: (message: string) => void
) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: findVisibleSubmissionActionDirectly
  })
  const action = result.result
  if (!action?.found || !action.url) {
    if (action?.matchCount && action.matchCount > 1) {
      addDiagnostic?.(`页面有 ${action.matchCount} 个提交入口链接，无法安全确定唯一入口`)
    }
    return null
  }
  if (hasUnsafeFinalActionIntent(action.url)) {
    addDiagnostic?.(`页面唯一的提交入口指向最终操作 URL，已拒绝导航`)
    return null
  }

  addDiagnostic?.(`链接中没有高置信度入口，已解析页面唯一的安全提交入口「${action.label}」`)
  return {
    actionLabel: action.label,
    inspection: await navigateAndInspect(tabId, action.url)
  }
}

async function openVisibleAuthenticationGate(
  tabId: number,
  snapshot: PageSnapshot,
  addDiagnostic?: (message: string) => void
) {
  const landingText = normalizeText(`${snapshot.title} ${snapshot.text.slice(0, 2200)}`)
  const looksLikeProductAccountSite = /\b(startups?|products?|tools?|directory|directories|listings?|showcase|business(?:es)?|companies)\b|产品|產品|工具|目录|目錄|公司|企业|企業|展示/.test(landingText)
  if (!looksLikeProductAccountSite) return null

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: clickVisibleAuthenticationActionDirectly
  })
  const action = result.result
  if (!action?.clicked) {
    if (action?.matchCount && action.matchCount > 1) {
      addDiagnostic?.(`页面有 ${action.matchCount} 个登录按钮，无法安全确定唯一人工入口`)
    }
    return null
  }

  addDiagnostic?.(`公开页没有高置信度提交入口，已打开页面唯一的登录按钮「${action.label}」`)
  await wait(350)
  return {
    actionLabel: action.label,
    inspection: await inspectCurrentTab(tabId)
  }
}

type SubmitPageResult = {
  url: string
  fields: ExtractedFormField[]
  tab: chrome.tabs.Tab
  manualOnly?: boolean
  message?: string
  humanGate?: HumanGate
}

function getProductDiscoveryIntent(productProfile: ProductProfile) {
  return [
    productProfile.productName,
    productProfile.shortDescription,
    productProfile.longDescription,
    productProfile.category,
    productProfile.keywords,
    productProfile.tags,
    productProfile.extraInfo,
    ...(productProfile.customFields || []).map((field) => `${field.label} ${field.value}`),
    productProfile.websiteUrl ? 'website' : ''
  ].filter(Boolean).join(' ')
}

async function findSubmitPage(
  tabId: number,
  originalUrl: string,
  productProfile: ProductProfile,
  updateMessage: (message: string) => void,
  addDiagnostic?: (message: string) => void
): Promise<SubmitPageResult | null> {
  const cache = await readSubmitCache()
  const host = getUrlHost(originalUrl)
  const cachedUrl = host ? cache[host] : undefined
  const tried = new Set<string>()
  let candidateQueue: SubmissionCandidate[] = []
  let graphTryCount = 0
  let totalTryCount = 0
  let fallbackCandidatesAdded = false
  let bestManualPage: { result: SubmitPageResult; score: number } | null = null
  const productIntent = getProductDiscoveryIntent(productProfile)

  const rememberManualPage = (
    inspection: Awaited<ReturnType<typeof navigateAndInspect>>,
    candidate: SubmissionCandidate,
    message: string,
    resultUrl: string = inspection.tab.url || candidate.url,
    humanGate?: Omit<HumanGate, 'detectedAt'>
  ) => {
    if (bestManualPage && bestManualPage.score >= candidate.score) return
    bestManualPage = {
      score: candidate.score,
      result: {
        url: resultUrl,
        fields: inspection.fields,
        tab: inspection.tab,
        manualOnly: true,
        message,
        humanGate: humanGate ? { ...humanGate, detectedAt: Date.now() } : undefined
      }
    }
  }

  const challengeResult = (
    inspection: Awaited<ReturnType<typeof navigateAndInspect>>,
    resumeUrl: string
  ): SubmitPageResult => ({
    url: inspection.tab.url || resumeUrl,
    fields: inspection.fields,
    tab: inspection.tab,
    manualOnly: true,
    message: '站点要求先完成浏览器安全验证。你处理时，其他网站会继续运行。',
    humanGate: {
      type: 'verification',
      detectedUrl: inspection.tab.url || resumeUrl,
      resumeUrl,
      detectedAt: Date.now()
    }
  })

  const enqueueCandidates = (candidates: SubmissionCandidate[]) => {
    candidateQueue = mergeSubmissionCandidates(candidateQueue, candidates)
      .filter((candidate) => !tried.has(candidate.url))
  }

  const tryCandidate = async (candidate: SubmissionCandidate) => {
    const canonicalUrl = getCanonicalUrl(candidate.url)
    if (tried.has(canonicalUrl)) return null
    tried.add(canonicalUrl)

    if (hasUnsafeFinalActionIntent(canonicalUrl)) {
      addDiagnostic?.(`跳过：${canonicalUrl}，原因：URL 包含 final/confirm/publish/payment/checkout 最终操作信号`)
      return null
    }

    updateMessage(`尝试提交入口：${canonicalUrl}`)
    addDiagnostic?.(`尝试：${canonicalUrl}（得分 ${candidate.score}，来源 ${candidate.source}${candidate.evidence ? `，线索：${candidate.evidence}` : ''}）`)

    let inspection: Awaited<ReturnType<typeof navigateAndInspect>>
    try {
      inspection = await navigateAndInspect(tabId, canonicalUrl)
    } catch (error: any) {
      addDiagnostic?.(`跳过：${canonicalUrl}，原因：${error.message || '页面无法打开'}`)
      return null
    }

    if (inspection.pageFailure) {
      addDiagnostic?.(`网络异常：${inspection.pageFailure.message}`)
      throw new TransientPageError(inspection.pageFailure)
    }

    const finalUrl = inspection.tab.url || canonicalUrl
    if (inspection.botChallenge.detected) {
      const evidence = inspection.botChallenge.evidence || '浏览器安全挑战页'
      addDiagnostic?.(`候选页停在${evidence}，已转入人工验证队列`)
      return { result: challengeResult(inspection, canonicalUrl), inspection }
    }
    if (inspection.snapshot && isLikely404(inspection.snapshot)) {
      addDiagnostic?.(`跳过：${canonicalUrl}，页面明确显示不存在或 404`)
      return { result: null, inspection }
    }

    const redirectedAway = !areDiscoveryUrlsEquivalent(canonicalUrl, finalUrl)
    if (
      redirectedAway &&
      isAuthenticationGateUrl(finalUrl) &&
      isHighConfidenceSubmissionCandidate(candidate)
    ) {
      const message = '已找到明确的提交入口，但目标站要求先登录；已保留原始提交地址，等待你完成登录后继续。'
      rememberManualPage(
        inspection,
        { ...candidate, score: candidate.score + 100 },
        message,
        canonicalUrl,
        {
          type: 'authentication',
          detectedUrl: finalUrl,
          resumeUrl: canonicalUrl
        }
      )
      addDiagnostic?.(`明确入口 ${canonicalUrl} 被站点转到登录页 ${finalUrl}`)
      return { result: bestManualPage?.result || null, inspection }
    }

    if (inspection.hasCredentialFields) {
      rememberManualPage(
        inspection,
        candidate,
        '当前页面同时要求创建账号；完成登录或注册后可以继续。',
        finalUrl,
        {
          type: 'authentication',
          detectedUrl: finalUrl,
          resumeUrl: candidate.url
        }
      )
      addDiagnostic?.(`候选页 ${finalUrl} 包含高置信度账号凭据控件，无论 URL 是否变化都先进入人工账号门控`)
      return { result: null, inspection }
    }

    const pageContext = `${inspection.snapshot?.title || inspection.tab.title || ''} ${inspection.snapshot?.url || inspection.tab.url || ''} ${inspection.snapshot?.text.slice(0, 2500) || ''}`
    const formDiagnosis = getSeoListingFormDiagnosis(inspection.fields, pageContext)
    addDiagnostic?.(`检查结果：字段 ${inspection.fields.length} 个，标题「${inspection.snapshot?.title || inspection.tab.title || '无标题'}」，判断：${formDiagnosis.reason}`)
    if (formDiagnosis.isListingForm) {
      return {
        result: {
          url: finalUrl,
          fields: inspection.fields,
          tab: inspection.tab
        },
        inspection
      }
    }

    const looksLikeSubmissionPage = pageLooksLikeSubmissionInfo(inspection.snapshot, inspection.fields)
    if (looksLikeSubmissionPage) {
      const hasLikelyContinuation = (
        candidate.depth < MAX_LINK_GRAPH_DEPTH &&
        inspection.snapshot &&
        createLinkSubmissionCandidates(
          inspection.snapshot,
          originalUrl,
          candidate.depth + 1,
          { intentText: productIntent, limit: MAX_LINK_CANDIDATES_PER_PAGE }
        ).some((nextCandidate) => (
          nextCandidate.score >= 28 &&
          !areDiscoveryUrlsEquivalent(nextCandidate.url, finalUrl)
        ))
      )
      const message = inspection.fields.length > 0
        ? '找到疑似提交页，但字段结构不像标准产品提交表单，需要你检查。'
        : '找到提交入口，但该站要求登录、确认或手动进入下一步。'
      rememberManualPage(
        inspection,
        candidate,
        message
      )

      if (isHighConfidenceSubmissionCandidate(candidate) && !hasLikelyContinuation) {
        return { result: bestManualPage?.result || null, inspection }
      }
    }

    const redirectedToHome = (
      !areDiscoveryUrlsEquivalent(canonicalUrl, finalUrl) &&
      areDiscoveryUrlsEquivalent(finalUrl, getOrigin(originalUrl))
    )
    if (redirectedToHome && isHighConfidenceSubmissionCandidate(candidate)) {
      const message = '已从首页找到明确的提交入口，但目标站当前把该入口重定向回首页，需要你稍后重试或手动检查站点状态。'
      rememberManualPage(inspection, candidate, message, canonicalUrl)
      addDiagnostic?.(`明确入口 ${canonicalUrl} 被站点重定向到 ${finalUrl}`)
      return { result: bestManualPage?.result || null, inspection }
    }

    return { result: null, inspection }
  }

  // openWorkTab already started loading the user-provided URL. Re-navigating it
  // here used to restart the page and made fast batch checks race the form UI.
  const current = await inspectCurrentTab(tabId)
  if (current.pageFailure) {
    addDiagnostic?.(`网络异常：${current.pageFailure.message}`)
    throw new TransientPageError(current.pageFailure)
  }

  const currentContext = `${current.snapshot?.title || current.tab.title || ''} ${current.snapshot?.url || current.tab.url || ''} ${current.snapshot?.text.slice(0, 2500) || ''}`
  const currentDiagnosis = getSeoListingFormDiagnosis(current.fields, currentContext)
  if (current.botChallenge.detected) {
    addDiagnostic?.(`站点停在${current.botChallenge.evidence || '浏览器安全挑战页'}，已等待自动放行但验证尚未完成`)
    return challengeResult(current, originalUrl)
  }

  const shouldTryDirectInput = (
    current.fields.length > 0 &&
    !currentDiagnosis.isDistractor &&
    (
      currentDiagnosis.isListingForm ||
      (
        (isDirectSubmissionUrl(originalUrl) || isDirectSubmissionUrl(current.tab.url || '')) &&
        pageLooksLikeSubmissionInfo(current.snapshot, current.fields)
      )
    )
  )
  addDiagnostic?.(`当前页字段 ${current.fields.length} 个，标题「${current.snapshot?.title || current.tab.title || '无标题'}」，判断：${currentDiagnosis.reason}`)
  if (shouldTryDirectInput) {
    if (!currentDiagnosis.isListingForm) {
      addDiagnostic?.('当前页是你直接提供的提交链接，已交给和悬浮按钮相同的单页填写器做最终判断。')
    }
    return {
      url: current.tab.url || originalUrl,
      fields: current.fields,
      tab: current.tab
    }
  }
  if (pageLooksLikeSubmissionInfo(current.snapshot, current.fields)) {
    const currentCandidate: SubmissionCandidate = {
      url: current.tab.url || originalUrl,
      score: 70,
      depth: 0,
      sourceUrl: originalUrl,
      evidence: '用户提供的起始页面',
      source: 'link'
    }
    rememberManualPage(current, currentCandidate, '当前页面像提交入口，但没有识别到可直接填写的完整表单，需要你检查。')
  }

  let snapshot = current.snapshot
  if (snapshot && isLikely404(snapshot)) {
    updateMessage('当前页面像 404，回到首页寻找提交入口')
    addDiagnostic?.('当前页像 404，切回首页继续找')
    const home = await navigateAndInspect(tabId, getOrigin(originalUrl))
    if (home.botChallenge.detected) {
      addDiagnostic?.(`首页停在${home.botChallenge.evidence || '浏览器安全挑战页'}，已转入人工验证队列`)
      return challengeResult(home, originalUrl)
    }
    const homeContext = `${home.snapshot?.title || home.tab.title || ''} ${home.snapshot?.url || home.tab.url || ''} ${home.snapshot?.text.slice(0, 2500) || ''}`
    const homeDiagnosis = getSeoListingFormDiagnosis(home.fields, homeContext)
    if (homeDiagnosis.isListingForm) {
      return {
        url: home.tab.url || getOrigin(originalUrl),
        fields: home.fields,
        tab: home.tab
      }
    }
    if (pageLooksLikeSubmissionInfo(home.snapshot, home.fields)) {
      const homeCandidate: SubmissionCandidate = {
        url: home.tab.url || getOrigin(originalUrl),
        score: 60,
        depth: 0,
        sourceUrl: originalUrl,
        evidence: '站点首页',
        source: 'link'
      }
      rememberManualPage(home, homeCandidate, '首页像提交入口或包含提交说明，但没有识别到可直接填写的完整表单。')
    }
    snapshot = home.snapshot
  }

  if (!snapshot) {
    try {
      snapshot = await getPageSnapshot(tabId)
    } catch (error: any) {
      addDiagnostic?.(`无法读取当前页面内容：${error.message || '未知错误'}`)
    }
  }

  if (!snapshot) {
    addDiagnostic?.('页面内容不可读取，只能尝试常见提交路径')
    snapshot = {
      title: '',
      url: getOrigin(originalUrl),
      text: '',
      links: []
    }
  }

  tried.add(getCanonicalUrl(snapshot.url || current.tab.url || originalUrl))
  const initialLinkCandidates = createLinkSubmissionCandidates(
    snapshot,
    originalUrl,
    1,
    { intentText: productIntent, limit: MAX_LINK_CANDIDATES_PER_PAGE }
  )
  enqueueCandidates(initialLinkCandidates)
  if (cachedUrl) {
    enqueueCandidates([{
      url: cachedUrl,
      score: 88,
      depth: 1,
      sourceUrl: originalUrl,
      evidence: '此前在本机确认过的提交入口',
      source: 'cache'
    }])
  }

  const hasDirectNavigationLead = candidateQueue.some(isHighConfidenceSubmissionCandidate)
  let openedSubmissionButton = false
  if (!cachedUrl && !hasDirectNavigationLead) {
    const openedSubmissionAction = await openVisibleSubmissionAction(tabId, addDiagnostic)
    if (openedSubmissionAction) {
      openedSubmissionButton = true
      const buttonInspection = openedSubmissionAction.inspection
      const buttonUrl = buttonInspection.tab.url || snapshot.url || originalUrl
      if (buttonInspection.botChallenge.detected) {
        addDiagnostic?.(`提交入口通向${buttonInspection.botChallenge.evidence || '浏览器安全挑战页'}，已转入人工验证队列`)
        return challengeResult(buttonInspection, snapshot.url || originalUrl)
      }
      const buttonContext = `${buttonInspection.snapshot?.title || buttonInspection.tab.title || ''} ${buttonUrl} ${buttonInspection.snapshot?.text.slice(0, 2500) || ''}`
      const buttonDiagnosis = getSeoListingFormDiagnosis(buttonInspection.fields, buttonContext)
      addDiagnostic?.(`点击提交入口链接后字段 ${buttonInspection.fields.length} 个，判断：${buttonDiagnosis.reason}`)

      if (buttonDiagnosis.isListingForm) {
        return {
          url: buttonUrl,
          fields: buttonInspection.fields,
          tab: buttonInspection.tab
        }
      }

      if (isAuthenticationGateUrl(buttonUrl) || buttonInspection.hasCredentialFields) {
        return {
          url: buttonUrl,
          fields: buttonInspection.fields,
          tab: buttonInspection.tab,
          manualOnly: true,
          message: '页面唯一的提交入口链接通向账号门槛；完成登录或注册后插件会继续。',
          humanGate: {
            type: 'authentication',
            detectedUrl: buttonUrl,
            resumeUrl: getAuthenticationResumeUrl(buttonUrl, snapshot.url || originalUrl),
            actionLabel: openedSubmissionAction.actionLabel,
            detectedAt: Date.now()
          }
        }
      }

      if (buttonInspection.snapshot) {
        snapshot = buttonInspection.snapshot
        const buttonCandidates = createLinkSubmissionCandidates(
          snapshot,
          originalUrl,
          1,
          { intentText: productIntent, limit: MAX_LINK_CANDIDATES_PER_PAGE }
        )
        enqueueCandidates(buttonCandidates)
        addDiagnostic?.(`点击提交入口链接后继续发现 ${buttonCandidates.length} 个链接候选`)
      }
    }
  }

  if (!cachedUrl && !candidateQueue.some(isHighConfidenceSubmissionCandidate) && !openedSubmissionButton) {
    const openedAuthGate = await openVisibleAuthenticationGate(tabId, snapshot, addDiagnostic)
    if (openedAuthGate) {
      const gateUrl = openedAuthGate.inspection.tab.url || snapshot.url || originalUrl
      if (openedAuthGate.inspection.botChallenge.detected) {
        addDiagnostic?.(`登录入口通向${openedAuthGate.inspection.botChallenge.evidence || '浏览器安全挑战页'}，已转入人工验证队列`)
        return challengeResult(openedAuthGate.inspection, originalUrl)
      }
      const resumeUrl = getAuthenticationResumeUrl(gateUrl, originalUrl)
      return {
        url: resumeUrl,
        fields: openedAuthGate.inspection.fields,
        tab: openedAuthGate.inspection.tab,
        manualOnly: true,
        message: '该站公开页没有显示提交入口，已为你打开登录页。登录后插件会从保护页继续寻找。',
        humanGate: {
          type: 'authentication',
          detectedUrl: gateUrl,
          resumeUrl,
          actionLabel: openedAuthGate.actionLabel,
          detectedAt: Date.now()
        }
      }
    }
  }
  addDiagnostic?.(`从首页提取 ${candidateQueue.length} 个站内导航候选，优先进行最多 ${MAX_LINK_GRAPH_TRIES} 次链接图搜索`)

  while (totalTryCount < MAX_CANDIDATE_TRIES) {
    if (graphTryCount >= MAX_LINK_GRAPH_TRIES) {
      candidateQueue = candidateQueue.filter((candidate) => candidate.source !== 'link')
    }

    if (candidateQueue.length === 0 && !fallbackCandidatesAdded) {
      fallbackCandidatesAdded = true
      const fallbackCandidates = await buildFallbackSubmissionCandidates(
        snapshot,
        originalUrl,
        productIntent,
        addDiagnostic
      )
      enqueueCandidates(fallbackCandidates)
      addDiagnostic?.(`链接图未找到完整表单，加入 ${candidateQueue.length} 个源码、站点地图和常见路径候选`)
    }

    const candidate = candidateQueue.shift()
    if (!candidate) break
    if (tried.has(candidate.url)) continue

    totalTryCount += 1
    if (candidate.source === 'link') graphTryCount += 1
    const attempt = await tryCandidate(candidate)
    if (!attempt) continue
    if (attempt.result) return attempt.result

    if (
      candidate.source === 'link' &&
      candidate.depth < MAX_LINK_GRAPH_DEPTH &&
      attempt.inspection.snapshot
    ) {
      const discovered = createLinkSubmissionCandidates(
        attempt.inspection.snapshot,
        originalUrl,
        candidate.depth + 1,
        { intentText: productIntent, limit: MAX_LINK_CANDIDATES_PER_PAGE }
      )
      enqueueCandidates(discovered)
      if (discovered.length > 0) {
        addDiagnostic?.(`从 ${attempt.inspection.tab.url || candidate.url} 继续发现 ${discovered.length} 个下一层入口`)
      }
    }
  }

  const manualPage = bestManualPage as { result: SubmitPageResult; score: number } | null
  return manualPage ? manualPage.result : null
}

function createInitialState(): BatchRunnerState {
  return {
    urlText: '',
    items: [],
    running: false,
    useDedicatedWindow: true,
    runLogs: [],
    logStatus: '',
    loginQueueStatus: 'idle',
    loginQueueCount: 0,
    activeLoginItemId: undefined,
    authenticatedHostCount: 0,
    loginQueueMessage: '等待批量任务检查登录状态'
  }
}

class BatchRunner {
  private state = createInitialState()
  private listeners = new Set<BatchRunnerListener>()
  private stopRequested = false
  private diagnostics: Record<string, string[]> = {}
  private automationWindowId?: number
  private automationWindowPromise?: Promise<number | undefined>
  private activeRun?: Promise<void>
  private resumeRuns = new Map<string, Promise<void>>()
  private retryRuns = new Map<string, Promise<void>>()
  private humanResumeTimers = new Map<string, number>()
  private googleLoginAttempts = new Set<string>()
  private googleLoginAutomationInFlight = new Set<string>()
  private googleLoginQueue: string[] = []
  private googleLoginQueueRun?: Promise<void>
  private activeGoogleLoginItemId?: string
  private blockedGoogleLoginItemId?: string
  private lastProductProfile?: ProductProfile
  private humanWindowSurfaced = false
  private runLogWriteQueue: Promise<void> = Promise.resolve()
  private logStatusTimer?: number

  constructor() {
    readRunLogs().then((runLogs) => {
      this.setState({ runLogs })
    })
    readAuthenticatedHostCache().then((cache) => {
      this.setState({ authenticatedHostCount: Object.keys(cache).length })
    })
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      this.handleHumanTabUpdated(tabId, changeInfo)
    })
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.handleHumanTabRemoved(tabId)
    })
  }

  subscribe(listener: BatchRunnerListener) {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState() {
    return this.state
  }

  setUrlText(urlText: string) {
    this.setState({ urlText })
  }

  setUseDedicatedWindow(useDedicatedWindow: boolean) {
    if (this.state.running) return
    this.setState({ useDedicatedWindow })
  }

  prepareQueue() {
    const urls = parseUrlList(this.state.urlText)
    const nextItems = urls.map((url, index) => ({
      id: `${Date.now()}_${index}`,
      inputUrl: url,
      status: 'pending' as const,
      message: '等待开始'
    }))

    this.diagnostics = nextItems.reduce<Record<string, string[]>>((acc, item) => {
      acc[item.id] = []
      return acc
    }, {})
    this.humanResumeTimers.forEach((timerId) => window.clearTimeout(timerId))
    this.humanResumeTimers.clear()
    this.googleLoginAttempts.clear()
    this.googleLoginAutomationInFlight.clear()
    this.googleLoginQueue = []
    this.activeGoogleLoginItemId = undefined
    this.blockedGoogleLoginItemId = undefined
    this.humanWindowSurfaced = false
    this.setState({
      items: nextItems,
      loginQueueStatus: 'idle',
      loginQueueCount: 0,
      activeLoginItemId: undefined,
      loginQueueMessage: '队列已生成，开始后会先检查登录状态'
    })
    return nextItems
  }

  async start(productProfile: ProductProfile) {
    if (this.state.running || this.activeRun) return

    if (!productProfile?.productName || !productProfile?.websiteUrl) {
      this.setState({
        items: [{
          id: String(Date.now()),
          inputUrl: '',
          status: 'failed',
          message: '请先在设置页填写推广资料，至少需要产品名称和官网 URL。'
        }]
      })
      return
    }

    const queue = this.state.items.length > 0 && this.queueMatchesInput()
      ? this.state.items
      : this.prepareQueue()
    if (queue.length === 0) return

    this.stopRequested = false
    this.lastProductProfile = productProfile
    this.setState({
      loginQueueMessage: '正在预检各网站的登录状态'
    })
    if (this.state.useDedicatedWindow) {
      await this.ensureAutomationWindow()
    }

    this.activeRun = this.runQueue(queue, productProfile)
      .finally(() => {
        this.activeRun = undefined
        this.syncRunningState()
      })
    this.syncRunningState()

    await this.activeRun
  }

  stop() {
    this.stopRequested = true
    this.humanResumeTimers.forEach((timerId) => window.clearTimeout(timerId))
    this.humanResumeTimers.clear()
    this.setState({
      running: false,
      loginQueueMessage: this.blockedGoogleLoginItemId
        ? '自动流程已停止，当前登录页面仍保留'
        : '自动流程已停止'
    })
  }

  async activateTab(tabId?: number) {
    if (!tabId) return

    const tab = await chrome.tabs.update(tabId, { active: true })
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true })
    }
  }

  async activateHumanTask(itemId: string) {
    const item = this.state.items.find((candidate) => candidate.id === itemId)
    const tabId = item?.humanGate?.interactionTabId || item?.tabId
    await this.activateTab(tabId)
  }

  async setFeedback(item: BatchItem, value: RunFeedbackValue) {
    this.updateItem(item.id, { feedback: value })

    await updateRunLogFeedback(item.id, {
      value,
      createdAt: new Date().toISOString()
    })
    this.setState({ runLogs: await readRunLogs() })
    this.showLogStatus('反馈已记录', 1800)
  }

  async copyLogs() {
    const text = await exportRunLogsText()
    await navigator.clipboard.writeText(text)
    this.setState({ runLogs: await readRunLogs() })
    this.showLogStatus('诊断日志已复制，可以直接发给我分析', 2600)
  }

  async clearLogs() {
    await clearRunLogs()
    this.setState({ runLogs: [] })
    this.showLogStatus('运行记录已清空', 1800)
  }

  private async ensureAutomationWindow() {
    if (await isWindowAvailable(this.automationWindowId)) return this.automationWindowId
    if (this.automationWindowPromise) return this.automationWindowPromise

    this.automationWindowPromise = chrome.windows.create({
      type: 'normal',
      focused: false,
      width: 980,
      height: 860,
      left: 40,
      top: 40
    }).then((window) => {
      this.automationWindowId = window.id
      return window.id
    }).catch(() => undefined).finally(() => {
      this.automationWindowPromise = undefined
    })

    return this.automationWindowPromise
  }

  private async runQueue(queue: BatchItem[], productProfile: ProductProfile) {
    const runnable = queue.filter((item) => !['review', 'awaiting_human'].includes(item.status))
    let nextIndex = 0
    const workerCount = this.state.useDedicatedWindow
      ? Math.min(MAX_CONCURRENT_AUTOMATION_ITEMS, runnable.length)
      : Math.min(1, runnable.length)

    const worker = async (workerIndex: number) => {
      if (workerIndex > 0) {
        await wait(workerIndex * AUTOMATION_WORKER_STAGGER_MS)
      }

      while (!this.stopRequested) {
        const item = runnable[nextIndex]
        nextIndex += 1
        if (!item) return

        try {
          await this.processItem(item, productProfile)
        } catch (error: any) {
          await this.failItem(item, error, productProfile)
        }

        await wait(300)
      }
    }

    await Promise.all(Array.from({ length: workerCount }, (_, workerIndex) => worker(workerIndex)))
  }

  private async processItem(item: BatchItem, productProfile: ProductProfile) {
    this.updateItem(item.id, {
      status: 'opening',
      message: '正在打开页面'
    })
    this.addDiagnostic(item.id, this.state.useDedicatedWindow ? '使用专用窗口安静运行' : '使用当前浏览器窗口运行')

    const tab = await openWorkTab(item.inputUrl, {
      quiet: this.state.useDedicatedWindow,
      windowId: this.automationWindowId
    })
    if (!tab.id) throw new Error('无法打开标签页')
    chrome.runtime.sendMessage({ action: 'markAutomationTab', tabId: tab.id }).catch(() => undefined)
    if (this.state.useDedicatedWindow && tab.windowId) {
      this.automationWindowId = tab.windowId
    }

    this.updateItem(item.id, {
      tabId: tab.id,
      currentUrl: tab.url,
      status: 'preflight',
      message: '正在预检登录状态'
    })

    const authenticatedHostCache = await readAuthenticatedHostCache()
    if (authenticatedHostCache[getUrlHost(item.inputUrl)]) {
      this.addDiagnostic(item.id, '该站此前已确认登录，优先复用浏览器现有 Cookie')
    }

    const preflight = await inspectCurrentTab(tab.id)
    if (preflight.pageFailure) {
      throw new TransientPageError(preflight.pageFailure)
    }

    const preflightUrl = preflight.tab.url || item.inputUrl
    if (preflight.botChallenge.detected) {
      this.addDiagnostic(item.id, `登录预检发现${preflight.botChallenge.evidence || '浏览器安全挑战页'}：${preflightUrl}`)
      await this.parkHumanItem(item, {
        url: preflightUrl,
        fields: preflight.fields,
        tab: preflight.tab,
        manualOnly: true,
        message: '预检发现站点浏览器安全验证，已转入人工验证队列。',
        humanGate: {
          type: 'verification',
          detectedUrl: preflightUrl,
          resumeUrl: item.inputUrl,
          detectedAt: Date.now()
        }
      }, productProfile)
      return
    }
    const isAuthenticationPage = (
      isGoogleAccountsUrl(preflightUrl) ||
      isAuthenticationGateUrl(preflightUrl) ||
      preflight.hasCredentialFields
    )
    if (isAuthenticationPage) {
      this.addDiagnostic(item.id, `登录预检发现账号关卡：${preflightUrl}`)
      await this.parkHumanItem(item, {
        url: getAuthenticationResumeUrl(preflightUrl, item.inputUrl),
        fields: preflight.fields,
        tab: preflight.tab,
        manualOnly: true,
        message: '登录预检发现该站需要账号，已加入串行登录队列。',
        humanGate: {
          type: 'authentication',
          detectedUrl: preflightUrl,
          resumeUrl: getAuthenticationResumeUrl(preflightUrl, item.inputUrl),
          detectedAt: Date.now()
        }
      }, productProfile)
      return
    }

    this.addDiagnostic(item.id, '登录预检通过，继续寻找并填写提交表单')
    await this.discoverAndFillItemWithRetries(item, productProfile, tab.id)
  }

  async resumeHumanTask(itemId: string, productProfile: ProductProfile) {
    const existingRun = this.resumeRuns.get(itemId)
    if (existingRun) return existingRun

    const item = this.state.items.find((candidate) => candidate.id === itemId)
    if (!item || item.status !== 'awaiting_human' || !item.tabId || !item.humanGate) return

    this.stopRequested = false
    this.lastProductProfile = productProfile
    const resumeRun = this.resumeHumanItem(item, productProfile)
    this.resumeRuns.set(itemId, resumeRun)
    this.syncRunningState()

    try {
      await resumeRun
    } catch (error: any) {
      await this.failItem(item, error, productProfile)
    } finally {
      this.resumeRuns.delete(itemId)
      this.syncRunningState()
    }
  }

  async retryItem(itemId: string, productProfile: ProductProfile) {
    const existingRun = this.retryRuns.get(itemId)
    if (existingRun) return existingRun

    const item = this.state.items.find((candidate) => candidate.id === itemId)
    if (!item || !['review', 'failed'].includes(item.status)) return

    this.stopRequested = false
    this.lastProductProfile = productProfile
    const retryRun = this.retryCurrentPageItem(item, productProfile)
    this.retryRuns.set(itemId, retryRun)
    this.syncRunningState()

    try {
      await retryRun
    } catch (error: any) {
      await this.failItem(item, error, productProfile)
    } finally {
      this.retryRuns.delete(itemId)
      this.syncRunningState()
    }
  }

  async resumeAllHumanTasks(productProfile: ProductProfile) {
    const itemIds = this.state.items
      .filter((item) => (
        item.status === 'awaiting_human' &&
        !['queued', 'running'].includes(item.humanGate?.googleQueueState || '')
      ))
      .map((item) => item.id)
    for (const itemId of itemIds) {
      await this.resumeHumanTask(itemId, productProfile)
    }
  }

  async skipActiveGoogleLogin() {
    const itemId = this.blockedGoogleLoginItemId
    if (!itemId) return

    const item = this.state.items.find((candidate) => candidate.id === itemId)
    if (item?.humanGate) {
      this.updateItem(itemId, {
        status: 'awaiting_human',
        message: '已暂时跳过该登录，页面会保留供你稍后处理。',
        humanGate: {
          ...item.humanGate,
          googleQueueState: 'skipped'
        }
      })
      this.addDiagnostic(itemId, '用户暂时跳过当前登录，继续处理下一个登录任务')
    }

    this.blockedGoogleLoginItemId = undefined
    this.activeGoogleLoginItemId = undefined
    this.humanWindowSurfaced = false
    this.syncLoginQueueState('已跳过当前人工登录，继续处理下一个')
    void this.processGoogleLoginQueue()
  }

  private enqueueGoogleLogin(itemId: string) {
    if (
      this.googleLoginQueue.includes(itemId) ||
      this.activeGoogleLoginItemId === itemId ||
      this.blockedGoogleLoginItemId === itemId
    ) {
      return
    }

    this.googleLoginQueue.push(itemId)
    this.syncLoginQueueState('登录任务已排队，将一次处理一个')
    void this.processGoogleLoginQueue()
  }

  private processGoogleLoginQueue() {
    if (
      this.googleLoginQueueRun ||
      this.stopRequested
    ) {
      this.syncLoginQueueState()
      return this.googleLoginQueueRun
    }

    const run = this.drainGoogleLoginQueue()
    this.googleLoginQueueRun = run
    this.syncRunningState()

    void run.finally(() => {
      if (this.googleLoginQueueRun === run) {
        this.googleLoginQueueRun = undefined
      }
      this.syncLoginQueueState()
      this.syncRunningState()
    })
    return run
  }

  private async drainGoogleLoginQueue() {
    while (
      this.googleLoginQueue.length > 0 &&
      !this.stopRequested
    ) {
      const itemId = this.googleLoginQueue.shift()
      if (!itemId) continue

      const item = this.state.items.find((candidate) => candidate.id === itemId)
      if (
        !item ||
        item.status !== 'awaiting_human' ||
        item.humanGate?.type !== 'authentication' ||
        !item.tabId
      ) {
        continue
      }

      const settings = await readGoogleLoginAutomationSettings()
      if (!settings.enabled) {
        this.updateItem(item.id, {
          message: 'Google 登录自动化已关闭，请手动处理。',
          humanGate: {
            ...item.humanGate,
            googleQueueState: 'waiting_human'
          }
        })
        continue
      }

      this.googleLoginAttempts.add(item.id)
      this.googleLoginAutomationInFlight.add(item.id)
      this.activeGoogleLoginItemId = item.id
      this.updateItem(item.id, {
        message: '轮到该站，正在安全尝试 Google 登录。',
        humanGate: {
          ...item.humanGate,
          googleQueueState: 'running'
        }
      })
      this.addDiagnostic(item.id, '串行登录队列开始处理该站')
      this.syncLoginQueueState('正在处理一个 Google 登录，其余登录任务保持排队')

      try {
        const loginTabId = item.humanGate.interactionTabId || item.tabId
        const outcome = await attemptGoogleLoginAutomation(
          loginTabId,
          item.humanGate.resumeUrl || item.inputUrl,
          () => !this.stopRequested
        )
        const latestItem = this.state.items.find((candidate) => candidate.id === item.id) || item
        const latestGate = latestItem.humanGate || item.humanGate
        const nextGate: HumanGate = {
          ...latestGate,
          interactionTabId: outcome.interactionTabId,
          googleAttempted: true,
          googleAccountSelected: outcome.accountSelected,
          googleConsentApproved: outcome.consentApproved,
          actionLabel: outcome.actionLabel || latestGate.actionLabel,
          googleQueueState: outcome.returnedToOriginalSite ? 'completed' : 'waiting_human'
        }
        const currentUrl = outcome.detectedUrl || latestItem.currentUrl

        if (outcome.returnedToOriginalSite) {
          this.updateItem(item.id, {
            status: 'awaiting_human',
            currentUrl,
            message: outcome.consentApproved
              ? 'Google 基础登录授权已确认并返回原网站，正在自动恢复提交任务。'
              : 'Google 登录已返回原网站，正在自动恢复提交任务。',
            humanGate: nextGate
          })
          this.addDiagnostic(item.id, `Google 登录已返回原网站：${currentUrl || nextGate.resumeUrl}`)
          this.activeGoogleLoginItemId = undefined
          this.syncLoginQueueState('登录成功，正在恢复原提交任务')
          if (this.lastProductProfile) {
            await this.resumeHumanTask(item.id, this.lastProductProfile)
          }
          continue
        }

        const message = !outcome.clicked
          ? `${outcome.reason || '未找到唯一的 Google 登录按钮'}，需要你手动处理。`
          : outcome.accountSelected
            ? outcome.reason || (
              outcome.consentApproved
                ? '已确认基础登录授权，当前仍停在验证或账号确认步骤，请你处理。'
                : '已选择默认 Google 账号，当前停在授权、验证或账号确认步骤，请你处理。'
            )
            : outcome.reason || 'Google 登录需要你继续完成。'
        this.updateItem(item.id, {
          status: 'awaiting_human',
          currentUrl,
          message,
          humanGate: nextGate
        })
        this.blockedGoogleLoginItemId = item.id
        this.addDiagnostic(item.id, `该站转入人工队列，后续 Google 登录已暂停：${message}`)
        this.syncLoginQueueState('当前登录需要人工处理，后续 Google 登录暂不打开')
        await this.surfaceFirstHumanGate(nextGate.interactionTabId || item.tabId)
        break
      } catch (error: any) {
        const latestItem = this.state.items.find((candidate) => candidate.id === item.id) || item
        const latestGate = latestItem.humanGate || item.humanGate
        const message = `Google 登录自动尝试未完成：${error.message || '未知错误'}`
        this.updateItem(item.id, {
          status: 'awaiting_human',
          message,
          humanGate: {
            ...latestGate,
            googleAttempted: true,
            googleQueueState: 'waiting_human'
          }
        })
        this.blockedGoogleLoginItemId = item.id
        this.addDiagnostic(item.id, message)
        this.syncLoginQueueState('该站登录自动化遇到异常，后续 Google 登录暂不打开')
        await this.surfaceFirstHumanGate(latestGate.interactionTabId || item.tabId)
        break
      } finally {
        this.googleLoginAutomationInFlight.delete(item.id)
        this.activeGoogleLoginItemId = undefined
      }
    }
  }

  private syncLoginQueueState(message?: string) {
    const waitingHumanItem = this.state.items.find((item) => (
      item.status === 'awaiting_human' &&
      item.humanGate?.googleQueueState === 'waiting_human'
    ))
    if (!this.blockedGoogleLoginItemId && waitingHumanItem) {
      this.blockedGoogleLoginItemId = waitingHumanItem.id
    }

    const status: LoginQueueStatus = this.activeGoogleLoginItemId
      ? 'processing'
      : this.googleLoginQueue.length > 0
        ? 'queued'
        : this.blockedGoogleLoginItemId
          ? 'waiting_human'
          : 'idle'
    const defaultMessage = status === 'waiting_human'
      ? '当前登录需要人工处理'
      : status === 'processing'
        ? '正在处理一个 Google 登录'
        : status === 'queued'
          ? '登录任务正在排队'
          : '当前没有等待处理的登录'

    this.setState({
      loginQueueStatus: status,
      loginQueueCount: this.googleLoginQueue.length,
      activeLoginItemId: this.activeGoogleLoginItemId || this.blockedGoogleLoginItemId,
      loginQueueMessage: message || defaultMessage
    })
  }

  private releaseGoogleLoginWait(itemId: string, message: string) {
    if (this.blockedGoogleLoginItemId === itemId) {
      this.blockedGoogleLoginItemId = undefined
    }
    if (this.activeGoogleLoginItemId === itemId) {
      this.activeGoogleLoginItemId = undefined
    }
    this.humanWindowSurfaced = false
    this.syncLoginQueueState(message)
    void this.processGoogleLoginQueue()
  }

  private async retryCurrentPageItem(item: BatchItem, productProfile: ProductProfile) {
    this.googleLoginQueue = this.googleLoginQueue.filter((itemId) => itemId !== item.id)
    this.releaseGoogleLoginWait(item.id, '正在重试当前页面')
    this.googleLoginAttempts.delete(item.id)
    this.googleLoginAutomationInFlight.delete(item.id)
    this.updateItem(item.id, {
      status: 'checking',
      filledCount: undefined,
      failedCount: undefined,
      feedback: undefined,
      humanGate: undefined,
      message: '正在读取当前标签页并重新填写'
    })
    this.addDiagnostic(item.id, '用户点击重试，先填写当前标签页；若没有可用表单，将自动重新寻找提交入口')

    if (item.tabId) {
      try {
        let existingTab = await chrome.tabs.get(item.tabId)
        if (existingTab.id) {
          const existingTabId = existingTab.id
          existingTab = await waitForTabComplete(existingTabId)
          chrome.runtime.sendMessage({ action: 'markAutomationTab', tabId: existingTabId }).catch(() => undefined)
          const currentUrl = existingTab.url || item.currentUrl || item.submitUrl || item.inputUrl
          const currentInspection = await inspectCurrentTab(existingTabId)
          if (currentInspection.botChallenge.detected) {
            await this.parkHumanItem(item, {
              url: currentUrl,
              fields: currentInspection.fields,
              tab: currentInspection.tab,
              manualOnly: true,
              message: '当前页仍是浏览器安全挑战页，已转入人工验证队列。',
              humanGate: {
                type: 'verification',
                detectedUrl: currentUrl,
                resumeUrl: item.submitUrl || item.inputUrl,
                detectedAt: Date.now()
              }
            }, productProfile)
            return
          }
          this.updateItem(item.id, {
            tabId: existingTabId,
            currentUrl,
            submitUrl: currentUrl,
            status: 'filling',
            message: '正在直接重新填写当前页面'
          })

          const fillResult = await runProductProfileFormFill(
            {
              id: existingTabId,
              title: existingTab.title,
              url: currentUrl
            },
            productProfile,
            {
              forceFill: true,
              shouldContinue: () => !this.stopRequested,
              onProgress: (progress) => {
                if (progress.stage === 'fields') {
                  this.addDiagnostic(item.id, `当前页重试确认 ${progress.fieldCount || 0} 个稳定字段`)
                  this.updateItem(item.id, {
                    status: 'filling',
                    message: `已识别 ${progress.fieldCount || 0} 个字段，正在重新填写`
                  })
                }

                if (progress.stage === 'filling') {
                  this.updateItem(item.id, {
                    status: 'filling',
                    message: '正在将资料重新写入当前页面'
                  })
                }
              }
            }
          )

          await rememberSubmitUrl(item.inputUrl, currentUrl)
          const requiredCount = fillResult.remainingRequiredKeys?.length || 0
          const invalidCount = fillResult.remainingInvalidKeys?.length || 0
          const message = requiredCount || invalidCount
            ? `当前页面已重试填写 ${fillResult.filledCount} 个字段；仍有 ${requiredCount} 个必填项为空、${invalidCount} 个校验失败，等待你复核（未提交）`
            : `当前页面已重试填写 ${fillResult.filledCount} 个字段，等待你复核（未提交）`
          this.updateItem(item.id, {
            status: 'review',
            currentUrl,
            submitUrl: currentUrl,
            filledCount: fillResult.filledCount,
            failedCount: fillResult.failedKeys?.length || 0,
            message,
            humanGate: undefined
          })
          await this.saveRunLog(item, {
            status: 'review',
            currentUrl,
            submitUrl: currentUrl,
            filledCount: fillResult.filledCount,
            failedCount: fillResult.failedKeys?.length || 0,
            message
          }, productProfile)
          return
        }
      } catch (error: any) {
        const tabStillExists = await chrome.tabs.get(item.tabId).then(() => true).catch(() => false)
        if (tabStillExists) {
          if (this.stopRequested) throw error

          this.addDiagnostic(
            item.id,
            `当前页直接填写未成功：${error.message || '没有可用表单'}；正在重新寻找提交入口`
          )
          this.updateItem(item.id, {
            status: 'finding',
            message: '当前页没有可用表单，正在重新寻找提交入口'
          })
          await this.discoverAndFillItemWithRetries(item, productProfile, item.tabId)
          return
        }
        this.addDiagnostic(item.id, `原标签页已经关闭，将重新打开原网址：${error.message || '标签页已关闭'}`)
      }
    }

    if (this.state.useDedicatedWindow) {
      await this.ensureAutomationWindow()
    }
    await this.processItem(item, productProfile)
  }

  private async discoverAndFillItemWithRetries(
    item: BatchItem,
    productProfile: ProductProfile,
    tabId: number
  ) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.discoverAndFillItem(item, productProfile, tabId)
        return
      } catch (error) {
        const retryDelay = TRANSIENT_PAGE_RETRY_DELAYS_MS[attempt]
        if (
          !(error instanceof TransientPageError) ||
          !error.retryable ||
          retryDelay === undefined ||
          this.stopRequested
        ) {
          throw error
        }

        const retryNumber = attempt + 1
        this.addDiagnostic(
          item.id,
          `检测到临时网络故障 ${error.code}，${Math.round(retryDelay / 1000)} 秒后自动重试（${retryNumber}/${TRANSIENT_PAGE_RETRY_DELAYS_MS.length}）`
        )
        this.updateItem(item.id, {
          status: 'opening',
          message: `网络暂时异常，${Math.round(retryDelay / 1000)} 秒后自动重试（${retryNumber}/${TRANSIENT_PAGE_RETRY_DELAYS_MS.length}）`
        })

        await wait(retryDelay)
        if (this.stopRequested) throw error

        mainFrameNavigationErrors.delete(tabId)
        await chrome.tabs.reload(tabId)
        await waitForTabComplete(tabId, 30000)
        await wait(700)
      }
    }
  }

  private async discoverAndFillItem(
    item: BatchItem,
    productProfile: ProductProfile,
    tabId: number
  ) {
    this.updateItem(item.id, {
      status: 'finding',
      humanGate: undefined,
      message: '正在判断是否是提交页'
    })

    const submitPage = await findSubmitPage(tabId, item.inputUrl, productProfile, (message) => {
      this.updateItem(item.id, {
        status: 'finding',
        message
      })
    }, (message) => this.addDiagnostic(item.id, message))

    if (!submitPage) {
      throw new Error('没有找到可填写的提交页面')
    }

    if (submitPage.manualOnly) {
      if (submitPage.humanGate) {
        await this.parkHumanItem(item, submitPage, productProfile)
        return
      }

      await rememberSubmitUrl(item.inputUrl, submitPage.url)
      const message = submitPage.message || '找到疑似提交入口，但需要你手动检查下一步'
      this.updateItem(item.id, {
        status: 'review',
        currentUrl: submitPage.tab.url,
        submitUrl: submitPage.url,
        filledCount: 0,
        failedCount: 0,
        message,
        humanGate: undefined
      })
      await this.saveRunLog(item, {
        status: 'review',
        currentUrl: submitPage.tab.url,
        submitUrl: submitPage.url,
        filledCount: 0,
        failedCount: 0,
        message
      }, productProfile)
      return
    }

    this.updateItem(item.id, {
      status: 'filling',
      currentUrl: submitPage.tab.url,
      submitUrl: submitPage.url,
      message: '找到提交页，正在填写',
      humanGate: undefined
    })

    const fillTarget = {
      id: submitPage.tab.id || tabId,
      title: submitPage.tab.title,
      url: submitPage.tab.url
    }
    const fillResult = await runProductProfileFormFill(
      fillTarget,
      productProfile,
      {
        shouldContinue: () => !this.stopRequested,
        onProgress: (progress) => {
          if (progress.stage === 'fields') {
            this.addDiagnostic(item.id, `共享填写器确认 ${progress.fieldCount || 0} 个稳定字段`)
            this.updateItem(item.id, {
              status: 'filling',
              message: `已识别 ${progress.fieldCount || 0} 个字段，正在匹配资料`
            })
          }

          if (progress.stage === 'filling') {
            this.updateItem(item.id, {
              status: 'filling',
              message: '正在将资料写入表单'
            })
          }
        }
      }
    )

    await rememberSubmitUrl(item.inputUrl, submitPage.url)
    const requiredCount = fillResult.remainingRequiredKeys?.length || 0
    const invalidCount = fillResult.remainingInvalidKeys?.length || 0
    const message = requiredCount || invalidCount
      ? `已填写 ${fillResult.filledCount} 个字段；仍有 ${requiredCount} 个必填项为空、${invalidCount} 个校验失败，等待你复核（未提交）`
      : `已填写 ${fillResult.filledCount} 个字段，等待你复核（未提交）`

    this.updateItem(item.id, {
      status: 'review',
      currentUrl: submitPage.tab.url,
      submitUrl: submitPage.url,
      filledCount: fillResult.filledCount,
      failedCount: fillResult.failedKeys?.length || 0,
      message,
      humanGate: undefined
    })
    await this.saveRunLog(item, {
      status: 'review',
      currentUrl: submitPage.tab.url,
      submitUrl: submitPage.url,
      filledCount: fillResult.filledCount,
      failedCount: fillResult.failedKeys?.length || 0,
      message
    }, productProfile)
  }

  private async parkHumanItem(
    item: BatchItem,
    submitPage: SubmitPageResult,
    productProfile: ProductProfile
  ) {
    let humanGate = submitPage.humanGate
    if (!humanGate) return

    let message = submitPage.message || '该页需要你先完成人工操作'
    const currentUrl = submitPage.tab.url || humanGate.detectedUrl
    const shouldResumeAutomatically = false
    this.updateItem(item.id, {
      status: 'awaiting_human',
      currentUrl,
      filledCount: 0,
      failedCount: 0,
      message,
      humanGate
    })
    this.addDiagnostic(item.id, `已转入人工队列：${humanGate.type}，恢复地址 ${humanGate.resumeUrl}`)

    if (
      humanGate.type === 'authentication' &&
      submitPage.tab.id &&
      !this.googleLoginAttempts.has(item.id)
    ) {
      const settings = await readGoogleLoginAutomationSettings()
      if (settings.enabled) {
        humanGate = {
          ...humanGate,
          googleQueueState: 'queued'
        }
        message = '已加入 Google 登录串行队列，轮到该站时会自动尝试。'
        this.updateItem(item.id, {
          status: 'awaiting_human',
          currentUrl,
          message,
          humanGate
        })
        this.addDiagnostic(item.id, '已加入 Google 登录串行队列')
        this.enqueueGoogleLogin(item.id)
      } else {
        this.addDiagnostic(item.id, 'Google 登录自动化已关闭，保留人工处理')
      }
    }

    await this.saveRunLog(item, {
      status: 'awaiting_human',
      currentUrl,
      message
    }, productProfile)

    if (shouldResumeAutomatically) {
      const timerId = window.setTimeout(() => {
        this.humanResumeTimers.delete(item.id)
        if (this.lastProductProfile) {
          this.resumeHumanTask(item.id, this.lastProductProfile)
        }
      }, 300)
      this.humanResumeTimers.set(item.id, timerId)
      return
    }

    if (humanGate.googleQueueState !== 'queued') {
      await this.surfaceFirstHumanGate(humanGate.interactionTabId || submitPage.tab.id)
    }
  }

  private async surfaceFirstHumanGate(tabId?: number) {
    if (!tabId || this.humanWindowSurfaced) return
    this.humanWindowSurfaced = true
    await this.activateTab(tabId).catch(() => undefined)
  }

  private async resumeHumanItem(item: BatchItem, productProfile: ProductProfile) {
    if (!item.tabId || !item.humanGate) return

    const gate = item.humanGate
    this.updateItem(item.id, {
      status: 'verifying',
      message: '正在确认人工操作是否完成'
    })
    this.addDiagnostic(item.id, `重新检查人工关卡：${gate.type}`)

    let current = await inspectCurrentTab(item.tabId)
    if (gate.type === 'verification' && current.botChallenge.detected) {
      const message = '安全验证仍未完成，其他网站会继续运行'
      this.updateItem(item.id, {
        status: 'awaiting_human',
        currentUrl: current.tab.url,
        message,
        humanGate: { ...gate, detectedAt: Date.now() }
      })
      this.addDiagnostic(item.id, message)
      return
    }

    if (gate.type === 'authentication' && current.hasCredentialFields) {
      const currentUrl = current.tab.url || gate.detectedUrl
      const message = '登录仍未完成，请在当前登录页面继续；其他网站会照常处理。'
      this.updateItem(item.id, {
        status: 'awaiting_human',
        currentUrl,
        message,
        humanGate: {
          ...gate,
          googleQueueState: gate.googleQueueState === 'skipped' ? 'skipped' : 'waiting_human',
          detectedAt: Date.now()
        }
      })
      this.addDiagnostic(item.id, `登录恢复检查仍发现账号凭据控件：${currentUrl}`)
      return
    }

    const currentUrl = current.tab.url || gate.detectedUrl
    if (gate.resumeUrl && !areDiscoveryUrlsEquivalent(currentUrl, gate.resumeUrl)) {
      this.addDiagnostic(item.id, `人工关卡已放行，回到 ${gate.resumeUrl} 继续`)
      current = await navigateAndInspect(item.tabId, gate.resumeUrl)
    }

    if (gate.type === 'authentication') {
      const resumedUrl = current.tab.url || gate.detectedUrl
      const authenticationStillRequired = (
        isGoogleAccountsUrl(resumedUrl) ||
        isAuthenticationGateUrl(resumedUrl) ||
        current.hasCredentialFields
      )
      if (authenticationStillRequired) {
        const message = '登录仍未完成，请在当前登录页面继续；其他网站会照常处理。'
        this.updateItem(item.id, {
          status: 'awaiting_human',
          currentUrl: resumedUrl,
          message,
          humanGate: {
            ...gate,
            googleQueueState: gate.googleQueueState === 'skipped' ? 'skipped' : 'waiting_human',
            detectedAt: Date.now()
          }
        })
        this.addDiagnostic(item.id, `登录恢复检查仍停在账号关卡：${resumedUrl}`)
        return
      }

      const authenticatedHostCount = await rememberAuthenticatedHost(gate.resumeUrl || resumedUrl)
      this.setState({ authenticatedHostCount })
      this.addDiagnostic(item.id, `已确认登录成功并记住站点：${getUrlHost(gate.resumeUrl || resumedUrl)}`)
      this.releaseGoogleLoginWait(item.id, '登录成功，继续处理后续登录任务')
    }

    await this.discoverAndFillItemWithRetries(item, productProfile, item.tabId)
  }

  private handleHumanTabUpdated(
    tabId: number,
    changeInfo: { status?: string; url?: string }
  ) {
    if (this.stopRequested || !this.lastProductProfile) return
    const item = this.state.items.find((candidate) => (
      (
        candidate.tabId === tabId ||
        candidate.humanGate?.interactionTabId === tabId
      ) &&
      candidate.status === 'awaiting_human' &&
      candidate.humanGate
    ))
    if (!item?.humanGate) return
    if (this.googleLoginAutomationInFlight.has(item.id)) return

    const gate = item.humanGate
    const returnedToOriginalSite = Boolean(
      changeInfo.url &&
      (
        getUrlHost(changeInfo.url) === getUrlHost(gate.resumeUrl) ||
        getUrlHost(changeInfo.url) === getUrlHost(item.inputUrl)
      ) &&
      !isGoogleAccountsUrl(changeInfo.url) &&
      !isAuthenticationGateUrl(changeInfo.url)
    )
    const shouldVerify = gate.type === 'verification'
      ? changeInfo.status === 'complete'
      : returnedToOriginalSite
    if (!shouldVerify) return

    const existingTimer = this.humanResumeTimers.get(item.id)
    if (existingTimer) window.clearTimeout(existingTimer)
    const timerId = window.setTimeout(() => {
      this.humanResumeTimers.delete(item.id)
      if (this.lastProductProfile) {
        this.resumeHumanTask(item.id, this.lastProductProfile)
      }
    }, 900)
    this.humanResumeTimers.set(item.id, timerId)
  }

  private handleHumanTabRemoved(tabId: number) {
    if (this.stopRequested || !this.lastProductProfile) return
    const item = this.state.items.find((candidate) => (
      candidate.status === 'awaiting_human' &&
      candidate.humanGate?.interactionTabId === tabId
    ))
    if (!item) return

    const existingTimer = this.humanResumeTimers.get(item.id)
    if (existingTimer) window.clearTimeout(existingTimer)
    const timerId = window.setTimeout(() => {
      this.humanResumeTimers.delete(item.id)
      if (this.lastProductProfile) {
        this.resumeHumanTask(item.id, this.lastProductProfile)
      }
    }, 900)
    this.humanResumeTimers.set(item.id, timerId)
  }

  private async failItem(item: BatchItem, error: any, productProfile: ProductProfile) {
    const message = error?.message || '处理失败'
    this.addDiagnostic(item.id, `失败：${message}`)
    this.updateItem(item.id, {
      status: 'failed',
      message,
      humanGate: undefined
    })
    this.releaseGoogleLoginWait(item.id, '当前登录任务失败，继续处理后续登录任务')
    await this.saveRunLog(item, {
      status: 'failed',
      message
    }, productProfile)
  }

  private syncRunningState() {
    this.setState({
      running: !this.stopRequested && (
        Boolean(this.activeRun) ||
        Boolean(this.googleLoginQueueRun) ||
        this.resumeRuns.size > 0 ||
        this.retryRuns.size > 0
      )
    })
  }

  private queueMatchesInput() {
    const urls = parseUrlList(this.state.urlText)
    return urls.length === this.state.items.length && urls.every((url, index) => this.state.items[index]?.inputUrl === url)
  }

  private updateItem(id: string, patch: Partial<BatchItem>) {
    this.setState({
      items: this.state.items.map((item) => item.id === id ? { ...item, ...patch } : item)
    })
  }

  private addDiagnostic(id: string, message: string) {
    this.diagnostics[id] = [...(this.diagnostics[id] || []), message].slice(-90)
    this.updateItem(id, {
      diagnostics: this.diagnostics[id]
    })
  }

  private async saveRunLog(
    item: BatchItem,
    patch: Partial<RunLogEntry>,
    productProfile: ProductProfile
  ) {
    const currentItem = this.state.items.find((candidate) => candidate.id === item.id) || item
    const now = new Date().toISOString()
    const createdAt = new Date(Number(item.id.split('_')[0]) || Date.now()).toISOString()
    const entry: RunLogEntry = {
      id: item.id,
      mode: 'batch',
      createdAt,
      updatedAt: now,
      productName: productProfile.productName,
      productWebsite: productProfile.websiteUrl,
      inputUrl: currentItem.inputUrl,
      currentUrl: currentItem.currentUrl,
      submitUrl: currentItem.submitUrl,
      tabId: currentItem.tabId,
      status: currentItem.status,
      message: currentItem.message,
      filledCount: currentItem.filledCount,
      failedCount: currentItem.failedCount,
      diagnostics: this.diagnostics[item.id] || currentItem.diagnostics || [],
      ...patch
    }

    let nextRunLogs: RunLogEntry[] = []
    this.runLogWriteQueue = this.runLogWriteQueue
      .catch(() => undefined)
      .then(async () => {
        await upsertRunLog(entry)
        nextRunLogs = await readRunLogs()
      })
    await this.runLogWriteQueue
    this.setState({ runLogs: nextRunLogs })
  }

  private showLogStatus(logStatus: string, durationMs: number) {
    if (this.logStatusTimer) {
      window.clearTimeout(this.logStatusTimer)
    }
    this.setState({ logStatus })
    this.logStatusTimer = window.setTimeout(() => {
      this.setState({ logStatus: '' })
    }, durationMs)
  }

  private setState(patch: Partial<BatchRunnerState>) {
    this.state = {
      ...this.state,
      ...patch
    }
    this.listeners.forEach((listener) => listener(this.state))
  }
}

export const batchRunner = new BatchRunner()
