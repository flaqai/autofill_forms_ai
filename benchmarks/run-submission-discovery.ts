import { readFile, writeFile } from 'node:fs/promises'
import { load } from '../node_modules/.pnpm/cheerio@1.2.0/node_modules/cheerio/dist/esm/index.js'
import {
  areDiscoveryUrlsEquivalent,
  canonicalizeDiscoveryUrl,
  createLinkSubmissionCandidates,
  createPathGuessSubmissionCandidates,
  getDiscoveryHost,
  isHighConfidenceSubmissionCandidate,
  mergeSubmissionCandidates,
  normalizeDiscoveryText,
  type SubmissionCandidate,
  type SubmissionPageSnapshot
} from '../src/utils/submissionDiscovery.ts'
import { getSeoListingFormDiagnosis } from '../src/utils/formIntent.ts'

type DatasetEntry = {
  id: string
  target: string
  note?: string
}

type ExtractedField = {
  id: string
  name: string
  type: string
  tagName: string
  placeholder: string
  label: string
  context: string
}

type FetchedPage = {
  requestedUrl: string
  finalUrl: string
  statusCode: number
  contentType: string
  html: string
  snapshot: SubmissionPageSnapshot
  fields: ExtractedField[]
  formCount: number
  error?: string
}

type DiscoveryResult = {
  id: string
  home: string
  resultUrl: string | null
  status: 'form' | 'manual' | 'authentication' | 'verification' | 'not_found' | 'network_error'
  detectedUrl?: string
  tries: number
  trace: string[]
  anomalies: string[]
}

type ScoredResult = DiscoveryResult & {
  target: string
  referenceValid: boolean
  referenceReason: string
  matched: boolean
}

const round = Number(process.argv.find((value) => value.startsWith('--round='))?.split('=')[1] || '1')
const concurrency = Number(process.argv.find((value) => value.startsWith('--concurrency='))?.split('=')[1] || '8')
const requestTimeoutMs = Number(process.argv.find((value) => value.startsWith('--timeout='))?.split('=')[1] || '6500')
const maxTries = Number(process.argv.find((value) => value.startsWith('--max-tries='))?.split('=')[1] || '48')
const onlyIds = new Set(
  (process.argv.find((value) => value.startsWith('--only='))?.split('=')[1] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
)
const maxGraphTries = 36
const maxDepth = 8
const candidatesPerPage = 8
const benchmarkIntent = 'AI tool SaaS software product website startup'
const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36'
const knownExternalFormHosts = /(^|\.)(?:forms\.gle|tally\.so|typeform\.com|airtable\.com|fillout\.com|notionforms\.io)$/i
const routeActionPattern = /(?:^|[/?&=_-])(submit|submission|add|register|sign[-_]?up|post|suggest|recommend|recommand|nominate|listing|apply|contribute|publish|enviar|cadastrar|create|new)(?=$|[/?&=_-])/i

function decodeHtml(value: string) {
  return load(`<span>${value}</span>`)('span').text()
}

function getOrigin(url: string) {
  return new URL(url).origin
}

function isAuthenticationGateUrl(url: string) {
  try {
    return /\/(?:auth|login|log-in|signin|sign-in|signup|sign-up|register|account|new-account|entrar|cadastro|cadastrar)(?:[/.]|$)/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

function isLikely404(page: FetchedPage) {
  const text = normalizeDiscoveryText(`${page.snapshot.title} ${page.snapshot.text.slice(0, 800)}`)
  return page.statusCode === 404 || /\b(404|not found|page not found|doesn t exist|does not exist|页面不存在|找不到页面)\b/.test(text)
}

function isLikelyBotChallenge(page: FetchedPage) {
  const text = normalizeDiscoveryText(`${page.snapshot.title} ${page.snapshot.text.slice(0, 1800)}`)
  return (
    [403, 429, 503].includes(page.statusCode) &&
    /\b(just a moment|checking your browser|security verification|verify you are human|performing security verification|cloudflare|captcha|access denied)\b|请稍候|安全验证|驗證您不是自動程序|验证您不是自动程序/.test(text)
  )
}

function pageLooksLikeSubmissionInfo(page: FetchedPage) {
  const text = normalizeDiscoveryText([
    page.snapshot.title,
    page.finalUrl,
    page.snapshot.text.slice(0, 2500),
    page.fields.map((field) => `${field.label} ${field.placeholder} ${field.name}`).join(' ')
  ].join(' '))
  const hasSubmitIntent = /\b(submit|submission|add\s+(?:your|a|an)|suggest|recommend|recommand|list\s+your|get\s+listed|feature|promote|nominate|publish|post\s+(?:a|an|your)|register|enviar|cadastrar|create\s+listing)\b|提交|投稿|收录|收錄|推荐|推薦|新增|刊登|发布|發佈|登記|登记/.test(text)
  const hasProductIntent = /\b(product|tool|startup|app|software|website|site|directory|listing|ai tool|company|business|classified|advertisement|projeto|produto|ferramenta|diret[oó]rio)\b|產品|产品|工具|網站|网站|目錄|目录|公司|企業|企业|商家/.test(text)
  const hasFormHints = /\b(website url|product website|tool url|app url|description|category|submit a product|submit product|list your product|add your tool|feature my product|add company|add site|nome do produto|nome do projeto|descri[cç][aã]o|categoria)\b|工具名稱|工具名称|網站連結|网站链接|網址|网址|產品名稱|产品名称|公司名稱|公司名称/.test(text)
  const looksLikeDistractor = /\b(search results|search|comment|reply|newsletter|subscribe|login|sign in|contact us)\b|搜尋|搜索|評論|评论|訂閱|订阅|登入|登录/.test(text) && page.fields.length <= 3
  return !looksLikeDistractor && ((hasSubmitIntent && hasProductIntent) || hasFormHints)
}

function extractPage(html: string, requestedUrl: string, finalUrl: string, statusCode: number, contentType: string): FetchedPage {
  const $ = load(html)
  $('script, style, noscript, template, svg').remove()
  const title = $('title').first().text().replace(/\s+/g, ' ').trim()
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000)
  const links = $('a[href], area[href]').toArray().map((element) => {
    const link = $(element)
    const rawHref = link.attr('href') || ''
    let href = ''
    try {
      href = new URL(rawHref, finalUrl).toString()
    } catch {
      href = ''
    }
    return {
      text: link.text().replace(/\s+/g, ' ').trim().slice(0, 180),
      href,
      context: link.closest('li, p, td, th, [role="menuitem"]').text().replace(/\s+/g, ' ').trim().slice(0, 280),
      hrefLang: link.attr('hreflang') || '',
      rel: link.attr('rel') || ''
    }
  }).filter((link) => Boolean(link.href)).slice(0, 900)

  const safeElements = $('input, textarea, select, [contenteditable="true"]').toArray().filter((element) => {
    const field = $(element)
    const type = (field.attr('type') || '').toLowerCase()
    if (field.is('[disabled], [readonly]')) return false
    if (field.is('input') && ['hidden', 'submit', 'button', 'image', 'password', 'search'].includes(type)) {
      return false
    }
    const identifier = [
      field.attr('id'),
      field.attr('name'),
      field.attr('placeholder'),
      field.attr('aria-label'),
      field.attr('title')
    ].filter(Boolean).join(' ').toLowerCase()
    if (/(^|[_\s-])(captcha|recaptcha|verification|verify|otp|auth[\s_-]*code|check[\s_-]*code|security[\s_-]*code|search|query)([_\s-]|$)/.test(identifier)) {
      return false
    }
    return true
  })

  const formScores = new Map<any, number>()
  safeElements.forEach((element) => {
    const form = $(element).closest('form').get(0)
    if (!form || formScores.has(form)) return
    const formNode = $(form)
    const fieldIdentity = formNode.find('input, textarea, select, [contenteditable], [role="combobox"]')
      .toArray()
      .map((candidate) => {
        const node = $(candidate)
        return [
          node.attr('id'),
          node.attr('name'),
          node.attr('placeholder'),
          node.attr('aria-label')
        ].filter(Boolean).join(' ')
      })
      .join(' ')
    const formText = [
      formNode.attr('id'),
      formNode.attr('name'),
      formNode.attr('action'),
      fieldIdentity,
      formNode.text().replace(/\s+/g, ' ').trim().slice(0, 1800)
    ].filter(Boolean).join(' ').toLowerCase()
    let score = 0
    if (/\b(title|product name|tool name|startup name|site name|project name|headline)\b/.test(formText)) score += 3
    if (/\b(url|website|homepage|home page|domain|product link|tool link|site link)\b/.test(formText)) score += 4
    if (/\b(description|overview|introduction|details|about|tagline|pitch)\b/.test(formText)) score += 4
    if (/\b(category|categories|industry|tags|keywords)\b/.test(formText)) score += 2
    if (/\b(owner email|your email|contact email|company email|submitter email)\b/.test(formText)) score += 1
    if (/\b(submit|suggest|add|publish|continue|review)\b/.test(formText)) score += 1
    if (/\b(login|log in|sign in|forgot password|remember me)\b/.test(formText)) score -= 8
    if (/\b(search|newsletter|subscribe)\b/.test(formText)) score -= 6
    formScores.set(form, score)
  })
  const bestFormScore = Math.max(0, ...formScores.values())
  const selectedElements = bestFormScore < 7
    ? safeElements
    : safeElements.filter((element) => {
        const form = $(element).closest('form').get(0)
        if (!form) return true
        const score = formScores.get(form) || 0
        return score >= 5 && score >= bestFormScore - 3
      })

  const fields = selectedElements.map((element) => {
    const field = $(element)
    const id = field.attr('id') || ''
    const explicitLabel = id ? $(`label[for="${id.replace(/"/g, '\\"')}"]`).first().text() : ''
    const label = (
      explicitLabel ||
      field.closest('label').text() ||
      field.attr('aria-label') ||
      field.attr('placeholder') ||
      ''
    ).replace(/\s+/g, ' ').trim().slice(0, 220)
    const nearbyText = field.closest('tr, label, [role="group"], .field, .form-group, .control-group')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240)
    return {
      id,
      name: field.attr('name') || '',
      type: (field.attr('type') || element.tagName || '').toLowerCase(),
      tagName: (element.tagName || '').toLowerCase(),
      placeholder: field.attr('placeholder') || '',
      label,
      context: [
        label,
        field.attr('placeholder'),
        field.attr('aria-label'),
        field.attr('title'),
        nearbyText
      ].filter(Boolean).join(' | ').slice(0, 900)
    }
  }).slice(0, 100)

  return {
    requestedUrl,
    finalUrl,
    statusCode,
    contentType,
    html,
    snapshot: {
      title,
      url: finalUrl,
      text,
      links
    },
    fields,
    formCount: $('form').length
  }
}

async function fetchPage(url: string): Promise<FetchedPage> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'user-agent': userAgent
      }
    })
    const contentType = response.headers.get('content-type') || ''
    const html = (await response.text()).slice(0, 2_500_000)
    return extractPage(html, url, response.url || url, response.status, contentType)
  } catch (error: any) {
    return {
      requestedUrl: url,
      finalUrl: url,
      statusCode: 0,
      contentType: '',
      html: '',
      snapshot: { title: '', url, text: '', links: [] },
      fields: [],
      formCount: 0,
      error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function extractSubmitUrlsFromText(text: string, origin: string) {
  const urls = new Set<string>()
  const normalizedText = text.replace(/\\\//g, '/')
  const locMatches = Array.from(normalizedText.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)).map((match) => decodeHtml(match[1]))
  const plainMatches = Array.from(normalizedText.matchAll(/https?:\/\/[^\s"'<>]+/gi)).map((match) => match[0])
  const hrefMatches = Array.from(normalizedText.matchAll(/\b(?:href|action)=["']([^"']+)["']/gi)).map((match) => decodeHtml(match[1]))
  const routeMatches = Array.from(normalizedText.matchAll(/["'](\/[^"']*(?:submit|add|post|sign-up|suggest|recommend|recommand|feature|promote|nominate|publish|register|listing|product|startup|tool|directory|enviar|cadastrar|projeto|produto|ferramenta|create)[^"']*)["']/gi)).map((match) => decodeHtml(match[1]))
  for (const rawUrl of [...locMatches, ...plainMatches, ...hrefMatches, ...routeMatches]) {
    try {
      const url = new URL(rawUrl.trim(), origin)
      if (routeActionPattern.test(url.pathname + url.search)) {
        urls.add(canonicalizeDiscoveryUrl(url.toString()))
      }
    } catch {
      // Invalid embedded URLs are ignored.
    }
  }
  return Array.from(urls)
}

function canUseEmbeddedCandidate(candidateUrl: string, rootUrl: string) {
  const candidateHost = getDiscoveryHost(candidateUrl)
  const rootHost = getDiscoveryHost(rootUrl)
  return (
    candidateHost === rootHost ||
    candidateHost.endsWith(`.${rootHost}`) ||
    rootHost.endsWith(`.${candidateHost}`) ||
    knownExternalFormHosts.test(candidateHost)
  )
}

async function getFallbackCandidates(homePage: FetchedPage, homeUrl: string, commonPaths: string[]) {
  const candidates = createPathGuessSubmissionCandidates(homePage.snapshot, homeUrl, commonPaths, benchmarkIntent)
  const origin = getOrigin(homeUrl)
  const embeddedUrls = extractSubmitUrlsFromText(homePage.html, origin).filter((url) => canUseEmbeddedCandidate(url, homeUrl))
  embeddedUrls.slice(0, 32).forEach((url, index) => {
    candidates.push({
      url,
      score: 66 - Math.min(index, 24),
      depth: 1,
      sourceUrl: homePage.finalUrl,
      evidence: '页面源码中的提交相关路径',
      source: 'source'
    })
  })

  const robots = await fetchPage(new URL('/robots.txt', origin).toString())
  const sitemapUrls = Array.from(robots.html.matchAll(/^sitemap:\s*(.+)$/gim))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 4)
  sitemapUrls.push(new URL('/sitemap.xml', origin).toString(), new URL('/sitemap_index.xml', origin).toString())
  const sitemapPages = await Promise.all(Array.from(new Set(sitemapUrls)).slice(0, 5).map(fetchPage))
  const sitemapCandidates = new Set<string>()
  sitemapPages.forEach((page) => {
    extractSubmitUrlsFromText(page.html, origin)
      .filter((url) => canUseEmbeddedCandidate(url, homeUrl))
      .forEach((url) => sitemapCandidates.add(url))
  })
  Array.from(sitemapCandidates).slice(0, 20).forEach((url, index) => {
    candidates.push({
      url,
      score: 54 - Math.min(index, 18),
      depth: 1,
      sourceUrl: homePage.finalUrl,
      evidence: 'sitemap/robots 中的提交相关路径',
      source: 'sitemap'
    })
  })
  return mergeSubmissionCandidates(candidates)
}

async function discoverFromHome(site: { id: string; home: string }, commonPaths: string[]): Promise<DiscoveryResult> {
  const trace: string[] = []
  const anomalies: string[] = []
  const tried = new Set<string>()
  let queue: SubmissionCandidate[] = []
  let graphTries = 0
  let totalTries = 0
  let fallbackAdded = false
  let bestManual: { url: string; status: DiscoveryResult['status']; score: number } | null = null

  const enqueue = (candidates: SubmissionCandidate[]) => {
    queue = mergeSubmissionCandidates(queue, candidates)
      .filter((candidate) => !tried.has(canonicalizeDiscoveryUrl(candidate.url)))
  }
  const addPageLinks = (page: FetchedPage, depth: number) => {
    const candidates = createLinkSubmissionCandidates(page.snapshot, site.home, depth, {
      intentText: benchmarkIntent,
      limit: candidatesPerPage
    })
    enqueue(candidates)
    trace.push(`从 ${page.finalUrl} 提取 ${candidates.length} 个候选`)
  }

  const homePage = await fetchPage(site.home)
  if (homePage.error) {
    return {
      id: site.id,
      home: site.home,
      resultUrl: null,
      status: 'network_error',
      tries: 0,
      trace: [`主页读取失败：${homePage.error}`],
      anomalies: ['主页网络错误']
    }
  }
  if (isLikelyBotChallenge(homePage)) {
    return {
      id: site.id,
      home: site.home,
      resultUrl: site.home,
      status: 'verification',
      tries: 0,
      trace: ['主页被安全验证拦截'],
      anomalies: ['人机验证']
    }
  }
  const homeDiagnosis = getSeoListingFormDiagnosis(
    homePage.fields,
    `${homePage.snapshot.title} ${homePage.finalUrl} ${homePage.snapshot.text.slice(0, 2500)}`
  )
  if (homeDiagnosis.isListingForm) {
    return {
      id: site.id,
      home: site.home,
      resultUrl: homePage.finalUrl,
      status: 'form',
      tries: 0,
      trace: [
        '主页本身是提交表单',
        `主页信号：${JSON.stringify(homeDiagnosis.signals)}`,
        `主页字段：${homePage.fields.slice(0, 12).map((field) => `${field.type}:${field.label || field.name || field.placeholder}`).join(' | ')}`
      ],
      anomalies
    }
  }

  tried.add(canonicalizeDiscoveryUrl(homePage.finalUrl))
  addPageLinks(homePage, 1)

  while (totalTries < maxTries) {
    if (graphTries >= maxGraphTries) {
      queue = queue.filter((candidate) => candidate.source !== 'link')
    }
    if (queue.length === 0 && !fallbackAdded) {
      fallbackAdded = true
      const fallbackCandidates = await getFallbackCandidates(homePage, site.home, commonPaths)
      enqueue(fallbackCandidates)
      trace.push(`加入 ${fallbackCandidates.length} 个源码、站点地图和常见路径候选`)
    }

    const candidate = queue.shift()
    if (!candidate) break
    const canonicalUrl = canonicalizeDiscoveryUrl(candidate.url)
    if (tried.has(canonicalUrl)) continue
    tried.add(canonicalUrl)
    totalTries += 1
    if (candidate.source === 'link') graphTries += 1

    const page = await fetchPage(candidate.url)
    trace.push(`#${totalTries} ${candidate.source} ${Math.round(candidate.score)} ${candidate.url} -> ${page.finalUrl}${page.error ? ` [${page.error}]` : ''}`)
    if (page.error) {
      anomalies.push(`网络错误：${candidate.url} (${page.error})`)
      continue
    }
    if (isLikelyBotChallenge(page)) {
      bestManual ||= { url: candidate.url, status: 'verification', score: candidate.score }
      anomalies.push(`人机验证：${page.finalUrl}`)
      if (isHighConfidenceSubmissionCandidate(candidate)) {
        return {
          id: site.id,
          home: site.home,
          resultUrl: candidate.url,
          status: 'verification',
          tries: totalTries,
          trace,
          anomalies
        }
      }
      continue
    }
    if (isLikely404(page)) continue

    const redirectedAway = !areDiscoveryUrlsEquivalent(candidate.url, page.finalUrl)
    if (redirectedAway && isAuthenticationGateUrl(page.finalUrl) && isHighConfidenceSubmissionCandidate(candidate)) {
      return {
        id: site.id,
        home: site.home,
        resultUrl: candidate.url,
        status: 'authentication',
        detectedUrl: page.finalUrl,
        tries: totalTries,
        trace,
        anomalies
      }
    }

    const diagnosis = getSeoListingFormDiagnosis(
      page.fields,
      `${page.snapshot.title} ${page.finalUrl} ${page.snapshot.text.slice(0, 2500)}`
    )
    if (diagnosis.isListingForm) {
      trace.push(`表单信号：${JSON.stringify(diagnosis.signals)}`)
      return {
        id: site.id,
        home: site.home,
        resultUrl: page.finalUrl,
        status: 'form',
        tries: totalTries,
        trace,
        anomalies
      }
    }

    const nextCandidates = candidate.depth < maxDepth
      ? createLinkSubmissionCandidates(page.snapshot, site.home, candidate.depth + 1, {
          intentText: benchmarkIntent,
          limit: candidatesPerPage
        })
      : []
    if (pageLooksLikeSubmissionInfo(page)) {
      bestManual = { url: page.finalUrl, status: 'manual', score: candidate.score }
      if (isHighConfidenceSubmissionCandidate(candidate) && nextCandidates.length === 0) {
        return {
          id: site.id,
          home: site.home,
          resultUrl: page.finalUrl,
          status: 'manual',
          tries: totalTries,
          trace,
          anomalies
        }
      }
    }
    if (candidate.source === 'link' && candidate.depth < maxDepth) {
      enqueue(nextCandidates)
    }
  }

  return {
    id: site.id,
    home: site.home,
    resultUrl: bestManual?.url || null,
    status: bestManual?.status || 'not_found',
    tries: totalTries,
    trace,
    anomalies
  }
}

function normalizedUrlParts(value: string) {
  const parsed = new URL(value)
  const localeSegments = new Set([
    'ar', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi', 'hu',
    'id', 'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk',
    'sv', 'th', 'tr', 'tw', 'uk', 'vi', 'zh', 'zh-cn', 'zh-tw'
  ])
  const pathSegments = parsed.pathname.split('/').filter(Boolean)
  if (pathSegments[0] && localeSegments.has(pathSegments[0].toLowerCase())) {
    pathSegments.shift()
  }
  const ignoredKeys = /^(?:utm_.+|ref|source|via|fbclid|gclid)$/i
  const query = Array.from(parsed.searchParams.entries())
    .filter(([key, entryValue]) => entryValue !== '' && !ignoredKeys.test(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
  return {
    host: parsed.hostname.replace(/^www\./, '').toLowerCase(),
    path: `/${pathSegments.join('/')}`.replace(/\/+$/, '') || '/',
    query
  }
}

function matchesReference(resultUrl: string | null, targetUrl: string) {
  if (!resultUrl) return false
  try {
    const result = normalizedUrlParts(resultUrl)
    const target = normalizedUrlParts(targetUrl)
    if (result.host !== target.host || result.path !== target.path) return false
    return target.query.every(([key, value]) => result.query.some(([resultKey, resultValue]) => (
      resultKey === key && resultValue === value
    )))
  } catch {
    return false
  }
}

async function validateReference(entry: DatasetEntry) {
  const page = await fetchPage(entry.target)
  if (page.error) {
    return {
      valid: true,
      reason: `参考页当前网络不可读（${page.error}），暂不因站点故障排除`
    }
  }
  const route = new URL(entry.target)
  const routeText = normalizeDiscoveryText(`${route.pathname} ${route.search}`)
  const routeHasSubmissionIntent = /\b(submit|add url|add site|add directory listing|add business listing|business listing add|post|create listing|create|new|register tool|enviar|recommand)\b/.test(routeText)
  const genericAccountRoute = /^\/(?:sign-up|signup|register)\/?$/i.test(route.pathname)
  const resumesSubmissionFlow = Array.from(route.searchParams.entries()).some(([key, value]) => (
    /^(?:returnto|return|next|redirect|callbackurl)$/i.test(key) &&
    /\b(?:submit|launch|add|post|create|new)\b/i.test(value)
  ))
  const redirectedToAuth = !areDiscoveryUrlsEquivalent(entry.target, page.finalUrl) && isAuthenticationGateUrl(page.finalUrl)
  const diagnosis = getSeoListingFormDiagnosis(
    page.fields,
    `${page.snapshot.title} ${page.finalUrl} ${page.snapshot.text.slice(0, 2500)}`
  )
  if (diagnosis.isListingForm) {
    return { valid: true, reason: '参考页包含可识别的提交表单' }
  }
  if (pageLooksLikeSubmissionInfo(page)) {
    return { valid: true, reason: '参考页包含明确的提交说明或分步提交入口' }
  }
  if ((routeHasSubmissionIntent && !genericAccountRoute) || resumesSubmissionFlow) {
    return {
      valid: true,
      reason: 'URL 是明确的提交/创建路由；静态抓取未呈现客户端表单'
    }
  }
  if (routeHasSubmissionIntent && (redirectedToAuth || isLikelyBotChallenge(page))) {
    return { valid: true, reason: redirectedToAuth ? '明确提交路由被登录门槛保护' : '明确提交路由被安全验证保护' }
  }
  return {
    valid: false,
    reason: `未识别出提交表单或提交说明：${diagnosis.reason}`
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  callback: (value: T, index: number) => Promise<R>
) {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= values.length) return
      results[index] = await callback(values[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

const fullDataset = JSON.parse(
  await readFile(new URL('./submission-discovery-dataset.json', import.meta.url), 'utf8')
) as DatasetEntry[]
const dataset = onlyIds.size > 0
  ? fullDataset.filter((entry) => onlyIds.has(entry.id))
  : fullDataset
const batchRunnerSource = await readFile(new URL('../src/utils/batchRunner.ts', import.meta.url), 'utf8')
const commonPathsBlock = batchRunnerSource.match(/const COMMON_SUBMIT_PATHS = \[([\s\S]*?)\n\]/)?.[1] || ''
const commonPaths = Array.from(commonPathsBlock.matchAll(/'([^']+)'/g)).map((match) => match[1])
const sites = dataset.map((entry) => ({
  id: entry.id,
  home: new URL('/', entry.target).toString()
}))

const startedAt = new Date().toISOString()
const discoveryResults = await mapWithConcurrency(sites, concurrency, (site) => (
  discoverFromHome(site, commonPaths)
))
const referenceChecks = await mapWithConcurrency(dataset, concurrency, validateReference)
const scoredResults: ScoredResult[] = discoveryResults.map((result, index) => ({
  ...result,
  target: dataset[index].target,
  referenceValid: referenceChecks[index].valid,
  referenceReason: referenceChecks[index].reason,
  matched: referenceChecks[index].valid && matchesReference(result.resultUrl, dataset[index].target)
}))
const validReferenceCount = scoredResults.filter((result) => result.referenceValid).length
const matchedCount = scoredResults.filter((result) => result.matched).length
const report = {
  round,
  startedAt,
  finishedAt: new Date().toISOString(),
  settings: {
    concurrency,
    requestTimeoutMs,
    maxTries,
    maxGraphTries,
    maxDepth,
    candidatesPerPage,
    commonPathCount: commonPaths.length
  },
  summary: {
    total: scoredResults.length,
    validReferenceCount,
    excludedReferenceCount: scoredResults.length - validReferenceCount,
    matchedCount,
    accuracy: validReferenceCount > 0 ? matchedCount / validReferenceCount : 0,
    statuses: Object.fromEntries(
      Array.from(new Set(scoredResults.map((result) => result.status))).map((status) => [
        status,
        scoredResults.filter((result) => result.status === status).length
      ])
    )
  },
  results: scoredResults
}
const outputPath = `/private/tmp/submission-discovery-round-${round}.json`
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log(JSON.stringify({
  outputPath,
  summary: report.summary,
  matched: scoredResults.filter((result) => result.matched).map((result) => result.id),
  misses: scoredResults.filter((result) => result.referenceValid && !result.matched).map((result) => ({
    id: result.id,
    resultUrl: result.resultUrl,
    target: result.target,
    status: result.status,
    tries: result.tries,
    anomalies: result.anomalies.slice(0, 2)
  })),
  excluded: scoredResults.filter((result) => !result.referenceValid).map((result) => ({
    id: result.id,
    target: result.target,
    reason: result.referenceReason
  }))
}, null, 2))
process.exit(0)
