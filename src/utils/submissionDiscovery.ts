export type SubmissionPageLink = {
  text: string
  href: string
  context?: string
  hrefLang?: string
  rel?: string
}

export type SubmissionPageSnapshot = {
  title: string
  url: string
  text: string
  links: SubmissionPageLink[]
}

export type SubmissionCandidateSource = 'link' | 'cache' | 'source' | 'sitemap' | 'guess'

export type SubmissionCandidate = {
  url: string
  score: number
  depth: number
  sourceUrl: string
  evidence: string
  source: SubmissionCandidateSource
}

const DIRECT_ACTION_PATTERN = /\b(submit|submission|add\s+(?:a\s+)?(?:site|website|tool|product|company|business|listing|link|directory)|get\s+listed|list\s+your|post\s+(?:a\s+)?(?:free\s+)?(?:site|product|tool|ad|listing)|suggest|share|contribute|feature|promote|nominate|publish|recommend|recommand|sign\s*up|join\s+(?:free|now)|create\s+(?:an?\s+)?account|register(?:\s+(?:a\s+)?(?:company|business|site))?|enviar\s+(?:(?:um|seu)\s+)?(?:projeto|produto|site|ferramenta)|cadastrar\s+(?:(?:um|seu)\s+)?(?:projeto|produto|site|ferramenta))\b|提交|投稿|收录|收錄|推荐|推薦|新增|刊登|发布|發佈|登記|登记|加入目录|加入目錄|添加网站|添加網站/i
const ROUTE_ACTION_PATTERN = /(?:^|[\/?&=_-])(submit|submission|add|register|sign[-_]?up|post|suggest|recommend|recommand|nominate|listing|apply|contribute|publish|enviar|cadastrar)(?=$|[\/?&=_-])/i
const PRODUCT_PATTERN = /\b(tools?|ai|startups?|products?|apps?|software|websites?|sites?|director(?:y|ies)|listings?|compan(?:y|ies)|business(?:es)?|services?|resources?|projetos?|produtos?|ferramentas?|diret[oó]rios?)\b|工具|產品|产品|網站|网站|公司|企業|企业|商家|目錄|目录|收錄|收录/i
const HUB_PATTERN = /\b(tools?|products?|apps?|companies|businesses|directory|resources|catalog|explore|browse|list)\b|工具列表|工具清單|全部工具|所有工具|网站列表|網站列表|企業列表|企业列表|商家列表|目錄|目录/i
const CONTACT_PATTERN = /\b(contact|partner|request|advertise)\b|聯絡|联系|合作|洽詢|洽询/i
const NEGATIVE_PATTERN = /\b(login|log\s+in|sign\s+in|signin|pricing|blog|article|news|privacy|terms|docs|api|careers|about|search|category|tag)\b|登入|登录|隱私|隐私|條款|条款|新聞|新闻|搜尋|搜索|分類|分类/i
const PROFILE_CARD_PATTERN = /\b(?:profile\s+(?:picture|photo)|avatar)\b.*\b(?:startups?|products?|tools?|projects?)\b/i
const KNOWN_EXTERNAL_FORM_HOST_PATTERN = /(^|\.)(?:forms\.gle|tally\.so|typeform\.com|airtable\.com|fillout\.com|notionforms\.io)$/i
const INTENT_STOP_WORDS = new Set([
  'add', 'app', 'business', 'company', 'directory', 'free', 'listing', 'post',
  'product', 'publish', 'site', 'submit', 'tool'
])
const LOCALE_SEGMENTS = new Set([
  'ar', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi', 'hu',
  'id', 'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk',
  'sv', 'th', 'tr', 'tw', 'uk', 'vi', 'zh', 'zh-cn', 'zh-tw'
])
const LANGUAGE_LABEL_PATTERN = /^(?:ar|cs|da|de|el|en|es|fi|fr|he|hi|hu|id|it|ja|ko|ms|nl|no|pl|pt|ro|ru|sk|sv|th|tr|tw|uk|vi|zh|english|deutsch|español|français|português|日本語|한국어|简体中文|繁體中文|繁体中文|中文)$/i

export function normalizeDiscoveryText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function getDiscoveryHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

export function areFirstPartyDiscoveryHosts(leftUrl: string, rightUrl: string) {
  const leftHost = getDiscoveryHost(leftUrl)
  const rightHost = getDiscoveryHost(rightUrl)
  if (!leftHost || !rightHost) return false

  return (
    leftHost === rightHost ||
    leftHost.endsWith(`.${rightHost}`) ||
    rightHost.endsWith(`.${leftHost}`)
  )
}

export function canonicalizeDiscoveryUrl(url: string) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url
  }
}

export function areDiscoveryUrlsEquivalent(left: string, right: string) {
  try {
    const normalize = (value: string) => {
      const parsed = new URL(value)
      parsed.hash = ''
      parsed.hostname = parsed.hostname.replace(/^www\./, '').toLowerCase()
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
      return parsed.toString()
    }

    return normalize(left) === normalize(right)
  } catch {
    return left === right
  }
}

function getLocaleNeutralPathname(pathname: string) {
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] && LOCALE_SEGMENTS.has(segments[0].toLowerCase())) {
    segments.shift()
  }
  return `/${segments.join('/')}`.replace(/\/+$/, '') || '/'
}

export function isLocaleSwitchEquivalent(link: SubmissionPageLink, currentUrl: string) {
  const linkText = normalizeDiscoveryText(link.text)
  const explicitlyLanguageLink = (
    Boolean(link.hrefLang) ||
    /\balternate\b/i.test(link.rel || '') ||
    LANGUAGE_LABEL_PATTERN.test(linkText)
  )
  if (!explicitlyLanguageLink) return false

  try {
    const current = new URL(currentUrl)
    const target = new URL(link.href)
    return (
      getDiscoveryHost(current.toString()) === getDiscoveryHost(target.toString()) &&
      getLocaleNeutralPathname(current.pathname) === getLocaleNeutralPathname(target.pathname) &&
      current.search === target.search
    )
  } catch {
    return false
  }
}

function canNavigateToCandidate(url: string, rootUrl: string) {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false

    const candidateHost = getDiscoveryHost(parsed.toString())
    return (
      areFirstPartyDiscoveryHosts(rootUrl, parsed.toString()) ||
      KNOWN_EXTERNAL_FORM_HOST_PATTERN.test(candidateHost)
    )
  } catch {
    return false
  }
}

function scoreIntentRelevance(link: SubmissionPageLink, intentText: string) {
  if (!intentText.trim()) return 0

  const normalizedIntent = normalizeDiscoveryText(intentText)
  const normalizedCandidate = normalizeDiscoveryText(link.text)
  const normalizeToken = (token: string) => (
    token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token
  )
  const intentTokens = new Set(normalizedIntent.split(' ')
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !INTENT_STOP_WORDS.has(token)))
  const candidateTokens = normalizedCandidate.split(' ')
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !INTENT_STOP_WORDS.has(token))
  const overlapScore = Math.min(36, candidateTokens.filter((token) => intentTokens.has(token)).length * 12)
  const digitalProductMatch = (
    /\b(digital items?|digital products?)\b/i.test(normalizedCandidate) &&
    /\b(ai|app|browser|extension|plugin|saas|software|tool|web|website)\b/i.test(normalizedIntent)
  ) ? 54 : 0

  return overlapScore + digitalProductMatch
}

export function scoreSubmissionLink(
  link: SubmissionPageLink,
  baseUrl: string,
  depth: number,
  intentText: string = ''
) {
  if (!canNavigateToCandidate(link.href, baseUrl)) return Number.NEGATIVE_INFINITY

  const visibleText = normalizeDiscoveryText(`${link.text} ${link.context || ''}`)
  const actionText = normalizeDiscoveryText(`${link.text} ${link.href}`)
  const routeText = normalizeDiscoveryText(link.href)
  const combinedText = `${visibleText} ${routeText}`
  if (PROFILE_CARD_PATTERN.test(visibleText)) return Number.NEGATIVE_INFINITY
  const hasDirectAction = DIRECT_ACTION_PATTERN.test(actionText)
  const hasContextualAction = !hasDirectAction && DIRECT_ACTION_PATTERN.test(link.context || '')
  const hasRouteAction = ROUTE_ACTION_PATTERN.test(new URL(link.href).pathname + new URL(link.href).search)
  const hasProductContext = PRODUCT_PATTERN.test(combinedText)
  let score = 0

  if (areFirstPartyDiscoveryHosts(baseUrl, link.href)) score += 30
  else score += 14
  if (hasDirectAction) score += 72
  if (hasContextualAction) score += 8
  if (hasRouteAction) score += 42
  if (hasProductContext) score += 24
  if (HUB_PATTERN.test(combinedText)) score += 14
  if (CONTACT_PATTERN.test(combinedText)) score += 12
  if (NEGATIVE_PATTERN.test(combinedText) && !hasDirectAction && !hasProductContext) score -= 42
  if (/^\s*$/.test(link.text) && !hasRouteAction) score -= 12
  if (link.href.includes('#') && !hasRouteAction) score -= 12
  score += scoreIntentRelevance(link, intentText)

  return score - Math.max(0, depth - 1) * 8
}

export function createLinkSubmissionCandidates(
  snapshot: SubmissionPageSnapshot,
  rootUrl: string,
  depth: number,
  options: { intentText?: string; limit?: number } = {}
) {
  const byUrl = new Map<string, SubmissionCandidate>()

  const getFlowAffinityBonus = (candidateUrl: string) => {
    try {
      const source = new URL(snapshot.url)
      const target = new URL(candidateUrl)
      const sourceAction = source.searchParams.get('view') || source.searchParams.get('action')
      const targetAction = target.searchParams.get('view') || target.searchParams.get('action')
      const followsSameActionFlow = (
        source.hostname === target.hostname &&
        source.pathname === target.pathname &&
        Boolean(sourceAction) &&
        sourceAction === targetAction &&
        /^(?:post|submit|add|create|register)$/i.test(sourceAction || '') &&
        target.searchParams.size > source.searchParams.size
      )
      return followsSameActionFlow ? 64 : 0
    } catch {
      return 0
    }
  }

  const addCandidate = (link: SubmissionPageLink, candidateUrl: string, scoreAdjustment: number = 0) => {
    const url = canonicalizeDiscoveryUrl(candidateUrl)
    const score = scoreSubmissionLink(
      { ...link, href: url },
      rootUrl,
      depth,
      options.intentText
    ) + getFlowAffinityBonus(url)
    if (score + scoreAdjustment < 28) return

    const candidate: SubmissionCandidate = {
      url,
      score: score + scoreAdjustment,
      depth,
      sourceUrl: snapshot.url,
      evidence: [link.text, link.context, scoreAdjustment !== 0 ? '补全页面留空的查询参数' : '']
        .filter(Boolean)
        .join(' — ')
        .slice(0, 240),
      source: 'link'
    }
    const current = byUrl.get(url)
    if (!current || candidate.score > current.score) {
      byUrl.set(url, candidate)
    }
  }

  snapshot.links.forEach((link) => {
    if (isLocaleSwitchEquivalent(link, snapshot.url)) return
    addCandidate(link, link.href)

    try {
      const parsed = new URL(link.href)
      let repaired = false
      parsed.searchParams.forEach((value, key) => {
        if (value === '') {
          parsed.searchParams.set(key, '0')
          repaired = true
        }
      })
      if (repaired && ROUTE_ACTION_PATTERN.test(parsed.pathname + parsed.search)) {
        addCandidate(link, parsed.toString(), 4)
      }
    } catch {
      // Invalid URLs are ignored by the regular candidate checks.
    }
  })

  return Array.from(byUrl.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, options.limit ?? 28)
}

export function mergeSubmissionCandidates(...candidateGroups: SubmissionCandidate[][]) {
  const byUrl = new Map<string, SubmissionCandidate>()

  candidateGroups.flat().forEach((candidate) => {
    const canonicalUrl = canonicalizeDiscoveryUrl(candidate.url)
    const normalized = { ...candidate, url: canonicalUrl }
    const current = byUrl.get(canonicalUrl)
    if (
      !current ||
      normalized.score > current.score ||
      (normalized.score === current.score && normalized.depth < current.depth)
    ) {
      byUrl.set(canonicalUrl, normalized)
    }
  })

  return Array.from(byUrl.values()).sort((left, right) => (
    right.score - left.score || left.depth - right.depth
  ))
}

export function createPathGuessSubmissionCandidates(
  snapshot: SubmissionPageSnapshot,
  rootUrl: string,
  paths: string[],
  intentText: string = ''
) {
  const legacySuffixCounts = snapshot.links.reduce<Record<string, number>>((counts, link) => {
    try {
      const match = new URL(link.href).pathname.match(/\.(php|html?)$/i)
      if (match) counts[match[0].toLowerCase()] = (counts[match[0].toLowerCase()] || 0) + 1
    } catch {
      // Ignore malformed URLs while detecting the site's URL style.
    }
    return counts
  }, {})
  const preferredLegacySuffix = Object.entries(legacySuffixCounts)
    .sort((left, right) => right[1] - left[1])[0]?.[0]
  const origin = new URL(snapshot.url || rootUrl).origin
  const candidates: SubmissionCandidate[] = []

  paths.forEach((path, index) => {
    const pathVariants = [path]
    if (preferredLegacySuffix && !/\.[a-z0-9]+$/i.test(path) && !path.endsWith('/')) {
      pathVariants.push(`${path}${preferredLegacySuffix}`)
    }

    pathVariants.forEach((pathVariant) => {
      const url = canonicalizeDiscoveryUrl(new URL(pathVariant, origin).toString())
      const routeScore = scoreSubmissionLink({ text: '', href: url }, rootUrl, 1, intentText)
      candidates.push({
        url,
        score: Math.max(32, routeScore - 18 - Math.min(index, 18)),
        depth: 1,
        sourceUrl: snapshot.url || rootUrl,
        evidence: `Common submission path ${pathVariant}`,
        source: 'guess'
      })
    })
  })

  return mergeSubmissionCandidates(candidates)
}

export function isHighConfidenceSubmissionCandidate(candidate: SubmissionCandidate) {
  if (candidate.source !== 'link') return candidate.score >= 100

  const linkText = candidate.evidence.split(' — ')[0] || ''
  const hasOwnSubmissionAction = DIRECT_ACTION_PATTERN.test(
    normalizeDiscoveryText(`${candidate.url} ${linkText}`)
  )

  return hasOwnSubmissionAction || candidate.score >= 140
}
