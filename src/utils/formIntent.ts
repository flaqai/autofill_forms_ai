type IntentField = {
  id?: string
  name?: string
  type?: string
  tagName?: string
  placeholder?: string
  label?: string
  context?: string
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function getFieldText(fields: IntentField[]) {
  return normalizeText(fields.map((field) => (
    `${field.label || ''} ${field.name || ''} ${field.id || ''} ${field.placeholder || ''} ${field.context || ''} ${field.type || ''} ${field.tagName || ''}`
  )).join(' '))
}

function countMatches(text: string, checks: RegExp[]) {
  return checks.filter((check) => check.test(text)).length
}

export function getSeoListingFormDiagnosis(fields: IntentField[], pageContext: string = '') {
  const fieldText = getFieldText(fields)
  const pageText = normalizeText(pageContext)
  const combinedText = `${fieldText} ${pageText}`
  const realFieldCount = fields.filter((field) => field.type !== 'hidden').length

  const hasSubmissionPageIntent = /\b(submit|submission|send us tip|tip submission|news tip|story idea|pitch|post ad|post free ad|free ad|classified|classifieds|advertise|advertisement|add your|add a|list your|suggest|recommend|recommand|feature|promote|publish|nominate|directory|listing|startup|product|tool|ai tool|saas|register|enviar projeto|enviar produto|cadastrar projeto|cadastrar produto)\b|收录|收錄|提交|投稿|外链|外鏈|推荐|推薦|新增|刊登|登記|登记/.test(combinedText)
  const hasMinimalUrlSubmissionContext = /\b(?:submit|add|list|recommend|recommand|suggest)\s+(?:(?:your|a|an)\s+)?(?:ai\s+)?(?:tool|product|website|site|startup|company|business|listing)\b|提交(?:您的|你的)?(?:\s*ai)?(?:工具|產品|产品|網站|网站|公司|企業|企业)|(?:推薦|推荐|新增|收錄|收录)(?:\s*ai)?(?:工具|產品|产品|網站|网站)/.test(pageText)
  const productFieldText = realFieldCount >= 3 ? combinedText : fieldText
  const hasUrl = /\b(url|website|web site|homepage|home page|link|domain|tool url|product url|app url|site url)\b|網址|网址|網站|网站|連結|链接|網域|网域/.test(productFieldText)
  const hasProductName = /\b(product name|tool name|app name|startup name|site name|website title|title|listing title|company name|business name|nome do produto|nome da ferramenta|nome do projeto|t[ií]tulo)\b|工具名稱|工具名称|產品名稱|产品名称|網站名稱|网站名称|公司名稱|公司名称|商家名稱|商家名称|標題|标题/.test(productFieldText)
  const hasDescription = /\b(description|summary|tagline|short description|long description|overview|about|introduction|details|descri[cç][aã]o|resumo)\b|描述|簡介|简介|介紹|介绍|摘要|詳情|详情|功能/.test(productFieldText)
  const hasCategory = /\b(category|categories|tag|tags|topic|industry|type|categoria|categorias)\b|分類|分类|標籤|标签|類別|类别|產業|行业/.test(productFieldText)
  const hasContact = /\b(email|contact|submitter|your name|first name|last name|author|company|founder)\b|電子信箱|电子邮箱|電郵|电邮|聯絡|联系|姓名|公司|企業|企业/.test(productFieldText)
  const hasLogoOrMedia = /\b(logo|icon|screenshot|image|thumbnail|avatar|upload)\b|圖標|图标|圖示|图示|截圖|截图|圖片|图片|上傳|上传/.test(productFieldText)
  const hasSubmissionFlowContext = /\b(crowdsourcing new|submit service|submit product|submit tool|product submission form|send us tip|post ad|post free ad|free ad|classified|classifieds|add service|add product|add tool|new listing|startup tracker|founder info|founder|contact details|service list|directory submission)\b|提交工具|推薦工具|推荐工具|新增工具|收錄工具|收录工具|刊登廣告|刊登广告/.test(combinedText)
  const hasContinuationFields = (
    /\b(founder|team size|incubator|accelerator|twitter handle|other products|contact name|contact email|contact details)\b/.test(fieldText) &&
    (hasContact || /\b(twitter|url|team|incubator|accelerator)\b/.test(fieldText))
  )
  const hasEditorialTipContext = /\b(send us tip|tip submission|news tip|story idea|submit a tip|send a tip|pitch)\b/.test(combinedText)
  const hasEditorialTipFields = /\b(what type of tip|type of tip|tip type|message|story idea|pitch|company name|first name|last name|email)\b/.test(fieldText)
  const hasClassifiedAdContext = /\b(post ad|post free ad|free ad|classified|classifieds|advertise|advertisement|view post)\b/.test(combinedText)
  const hasClassifiedAdFields = /\b(ad title|title|subject|headline|description|details|price|city|region|category|email|phone|contact|website|url)\b/.test(fieldText)

  const positiveSignals = countMatches(fieldText, [
    /\b(url|website|web site|homepage|home page|link|domain)\b|網址|网址|網站|网站|連結|链接/,
    /\b(product name|tool name|app name|startup name|site name|website title|title|listing title)\b|工具名稱|工具名称|產品名稱|产品名称|網站名稱|网站名称|標題|标题/,
    /\b(description|summary|tagline|overview|about|introduction|details)\b|描述|簡介|简介|介紹|介绍|功能/,
    /\b(category|categories|tag|tags|industry|type)\b|分類|分类|標籤|标签|類別|类别/,
    /\b(email|contact|submitter|your name|company)\b|電子信箱|电子邮箱|聯絡|联系|姓名|公司/,
    /\b(logo|icon|screenshot|image|upload)\b|圖標|图标|圖示|图示|截圖|截图|圖片|图片|上傳|上传/
  ])

  const looksLikeSearch = /\b(search|query|keyword search|find|filter)\b|搜尋|搜索|篩選|筛选/.test(fieldText) && realFieldCount <= 3 && !hasUrl
  const looksLikeComment = /\b(comment|reply|leave a reply|leave a comment|message|leave a review|review form|rating|discussion)\b/.test(combinedText) && !hasUrl && !hasSubmissionPageIntent && !hasEditorialTipContext && !hasClassifiedAdContext
  const looksLikeNewsletter = /\b(newsletter|subscribe|subscription|join our list|mailing list)\b|電子報|电子报|訂閱|订阅/.test(combinedText) && realFieldCount <= 3 && !hasUrl
  const looksLikeLogin = /\b(login|log in|sign in|password|username|remember me|account)\b|登入|登录|密碼|密码|帳號|账号/.test(fieldText) && !hasUrl
  const looksLikeContactOnly = /\b(contact us|message|subject)\b|聯絡我們|联系我们|訊息|信息|主旨/.test(combinedText) && hasContact && !hasUrl && !hasProductName && !hasSubmissionPageIntent && !hasEditorialTipContext && !hasClassifiedAdContext
  const isDistractor = looksLikeSearch || looksLikeComment || looksLikeNewsletter || looksLikeLogin || looksLikeContactOnly

  const strongEnough = (
    realFieldCount >= 3 &&
    hasUrl &&
    (hasProductName || hasDescription || hasCategory || hasContact || hasLogoOrMedia) &&
    (positiveSignals >= 2 || hasSubmissionPageIntent)
  )
  const minimalUrlSubmissionStep = (
    realFieldCount >= 1 &&
    realFieldCount <= 3 &&
    hasUrl &&
    hasMinimalUrlSubmissionContext
  )
  const continuationStep = (
    realFieldCount >= 2 &&
    hasSubmissionFlowContext &&
    hasContinuationFields
  )
  const editorialTipStep = (
    realFieldCount >= 4 &&
    hasEditorialTipContext &&
    hasContact &&
    hasEditorialTipFields
  )
  const classifiedAdStep = (
    realFieldCount >= 4 &&
    hasClassifiedAdContext &&
    hasClassifiedAdFields &&
    (hasContact || hasDescription || hasCategory || hasUrl)
  )

  const reason = isDistractor
    ? '像搜索、评论、订阅、登录或普通联系表单'
    : strongEnough || minimalUrlSubmissionStep || continuationStep || editorialTipStep || classifiedAdStep
      ? '像 SEO 外链/目录收录/产品提交表单'
      : '缺少产品提交表单的核心字段'

  return {
    isListingForm: (strongEnough || minimalUrlSubmissionStep || continuationStep || editorialTipStep || classifiedAdStep) && !isDistractor,
    isDistractor,
    reason,
    signals: {
      realFieldCount,
      hasUrl,
      hasProductName,
      hasDescription,
      hasCategory,
      hasContact,
      hasLogoOrMedia,
      hasSubmissionPageIntent,
      hasMinimalUrlSubmissionContext,
      minimalUrlSubmissionStep,
      hasSubmissionFlowContext,
      hasContinuationFields,
      hasEditorialTipContext,
      hasEditorialTipFields,
      hasClassifiedAdContext,
      hasClassifiedAdFields,
      positiveSignals
    }
  }
}

export function looksLikeSeoListingSubmissionForm(fields: IntentField[], pageContext: string = '') {
  return getSeoListingFormDiagnosis(fields, pageContext).isListingForm
}
