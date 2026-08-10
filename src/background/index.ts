import { cancelUrlBasedFill, handleAddExtraInfo, handleRegenerateField, handleUrlBasedFill } from './urlBasedFill'
import { chatAPI } from '../services/api'
import { STORAGE_KEYS } from '../config/constants'

const fillableTabActivity = new Map<number, number>()
const ignoredTargetTabs = new Set<number>()
let standaloneWindowId: number | null = null

function isFillableUrl(url?: string) {
  return Boolean(url && /^https?:\/\//.test(url))
}

function isLikelyBrowserErrorTab(tab: chrome.tabs.Tab) {
  const title = (tab.title || '').toLowerCase()
  return (
    title.includes("can't be reached") ||
    title.includes('can’t be reached') ||
    title.includes('took too long to respond') ||
    title.includes('no internet') ||
    title.includes('dns_probe') ||
    title.includes('err_') ||
    title.includes('无法访问此网站') ||
    title.includes('网页无法打开')
  )
}

function canUseAsTargetTab(tab: chrome.tabs.Tab) {
  return Boolean(
    tab.id &&
    isFillableUrl(tab.url) &&
    !ignoredTargetTabs.has(tab.id) &&
    !isLikelyBrowserErrorTab(tab)
  )
}

async function rememberFillableTab(tabId?: number) {
  if (!tabId || ignoredTargetTabs.has(tabId)) return

  try {
    const tab = await chrome.tabs.get(tabId)
    if (canUseAsTargetTab(tab)) {
      fillableTabActivity.set(tab.id || tabId, Date.now())
    }
  } catch (error) {
    console.warn('[TargetTab] Failed to remember tab:', error)
  }
}

async function getTargetTab() {
  const candidates = Array.from(fillableTabActivity.entries())
    .sort((a, b) => b[1] - a[1])

  for (const [tabId] of candidates) {
    try {
      const tab = await chrome.tabs.get(tabId)
      if (canUseAsTargetTab(tab)) {
        return tab
      }
      fillableTabActivity.delete(tabId)
    } catch {
      fillableTabActivity.delete(tabId)
    }
  }

  const normalWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })
  const activeFillableTabs = normalWindows
    .flatMap((window) => window.tabs || [])
    .filter((tab) => tab.active && canUseAsTargetTab(tab))

  const activeTab = activeFillableTabs[activeFillableTabs.length - 1]
  if (activeTab?.id) {
    fillableTabActivity.set(activeTab.id, Date.now())
    return activeTab
  }

  return null
}

function getStandaloneUrl(
  from: string = 'toolbar',
  sessionId?: string,
  autoFill: boolean = false,
  targetTabId?: number
) {
  const params = new URLSearchParams({ from, mode: 'standalone' })
  if (sessionId) {
    params.append('sessionId', sessionId)
  }
  if (autoFill) {
    params.append('autoFill', '1')
  }
  if (targetTabId !== undefined) {
    params.append('targetTabId', String(targetTabId))
  }
  return chrome.runtime.getURL(`sidepanel.html?${params.toString()}`)
}

function isStandaloneExtensionUrl(url?: string) {
  if (!url?.startsWith(chrome.runtime.getURL('sidepanel.html'))) return false

  try {
    return new URL(url).searchParams.get('mode') === 'standalone'
  } catch {
    return url.includes('mode=standalone')
  }
}

function getStandaloneAutoFillUrl(currentUrl: string, targetTabId: number) {
  const url = new URL(currentUrl)
  const requestId = `autofill_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const params = new URLSearchParams({
    autoFill: '1',
    targetTabId: String(targetTabId),
    autoFillRequestId: requestId
  })

  url.hash = `/chat?${params.toString()}`
  return url.toString()
}

async function findStandaloneWindows() {
  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['popup', 'normal']
  })

  return windows
    .map((window) => ({
      window,
      tab: (window.tabs || []).find((tab) => isStandaloneExtensionUrl(tab.url))
    }))
    .filter((item): item is { window: chrome.windows.Window; tab: chrome.tabs.Tab } => Boolean(item.tab?.id && item.window.id))
}

async function closeDuplicateStandaloneWindows(keepWindowId: number) {
  const standaloneWindows = await findStandaloneWindows()
  await Promise.all(
    standaloneWindows
      .filter(({ window }) => window.id && window.id !== keepWindowId)
      .map(({ window }) => chrome.windows.remove(window.id as number).catch(() => undefined))
  )
}

async function focusStandaloneWindow(windowId: number, anchorWindowId?: number) {
  // Chromium rejects requesting focus and attention at the same time. Restore a
  // minimized popup first, then focus and reposition it in a separate update.
  try {
    const existingWindow = await chrome.windows.get(windowId)
    if (existingWindow.state && existingWindow.state !== 'normal') {
      await chrome.windows.update(windowId, { state: 'normal' })
    }
  } catch {
    // The focused update below reports a useful error when the window is gone.
  }

  await chrome.windows.update(windowId, {
    focused: true,
    ...(await getPopupBounds(anchorWindowId))
  })
  standaloneWindowId = windowId
}

async function getPopupBounds(anchorWindowId?: number) {
  const width = 430
  const fallbackHeight = 780

  try {
    const anchorWindow = anchorWindowId ? await chrome.windows.get(anchorWindowId) : await chrome.windows.getCurrent()
    const top = Math.max(0, (anchorWindow.top || 0) + 24)
    const height = Math.min(fallbackHeight, Math.max(560, (anchorWindow.height || fallbackHeight) - 72))
    const left = Math.max(0, (anchorWindow.left || 0) + (anchorWindow.width || 960) - width - 18)
    return { width, height, left, top }
  } catch {
    return { width, height: fallbackHeight }
  }
}

async function openStandaloneWindow(
  from: string = 'toolbar',
  sessionId?: string,
  options: { autoFill?: boolean; anchorWindowId?: number; targetTabId?: number } = {}
) {
  const restartExistingWindowForAutoFill = async (windowId: number) => {
    if (!options.autoFill || options.targetTabId === undefined) return

    const tabs = await chrome.tabs.query({ windowId })
    const standaloneTab = tabs.find((tab) => isStandaloneExtensionUrl(tab.url))
    if (!standaloneTab?.id) {
      throw new Error('没有找到插件窗口页面')
    }

    await chrome.tabs.update(standaloneTab.id, {
      url: getStandaloneAutoFillUrl(standaloneTab.url || getStandaloneUrl('floating'), options.targetTabId)
    })
  }

  if (standaloneWindowId !== null) {
    try {
      await restartExistingWindowForAutoFill(standaloneWindowId)
      await focusStandaloneWindow(standaloneWindowId, options.anchorWindowId)
      await closeDuplicateStandaloneWindows(standaloneWindowId)
      return
    } catch {
      standaloneWindowId = null
    }
  }

  const existingStandaloneWindows = await findStandaloneWindows()
  const existingWindow = existingStandaloneWindows[0]?.window
  if (existingWindow?.id) {
    await restartExistingWindowForAutoFill(existingWindow.id)
    await closeDuplicateStandaloneWindows(existingWindow.id)
    await focusStandaloneWindow(existingWindow.id, options.anchorWindowId)
    return
  }

  const window = await chrome.windows.create({
    url: getStandaloneUrl(from, sessionId, Boolean(options.autoFill), options.targetTabId),
    type: 'popup',
    ...(await getPopupBounds(options.anchorWindowId)),
    focused: true
  })

  standaloneWindowId = window.id || null
}

// Get summary from URL using web search
async function getSummaryFromUrl(url: string) {
  console.log('[GetSummary] Getting summary for URL:', url)

  // Get Settings
  const storageData = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS)
  let settings: any = null

  if (storageData[STORAGE_KEYS.SETTINGS]) {
    try {
      const parsed = JSON.parse(storageData[STORAGE_KEYS.SETTINGS])
      settings = parsed.state || parsed
    } catch (e) {
      console.error('[GetSummary] Failed to parse settings', e)
      return { success: false, error: 'Failed to load settings' }
    }
  }

  if (!settings?.apiKey) {
    return { success: false, error: 'API Key not configured' }
  }

  chatAPI.setApiKey(settings.apiKey)
  if (settings.apiBaseURL) chatAPI.setBaseURL(settings.apiBaseURL)

  try {
    const prompt = `Please visit this URL and provide a detailed summary of the webpage content: ${url}

Focus on extracting:
1. Main title and purpose of the page
2. Key information, facts, and data
3. Important names, dates, URLs, and contact information
4. Product/service descriptions if applicable
5. Any forms or data that might be relevant

Provide a structured summary that can be used to auto-fill forms on other websites.`

    const summary = await chatAPI.sendMessage([
      { id: 'usr', role: 'user', content: prompt, timestamp: new Date() }
    ], {
      model: settings.model || 'gpt-3.5-turbo',
      temperature: 0.3,
      enableWebSearch: true
    })

    return { success: true, summary }
  } catch (error: any) {
    console.error('[GetSummary] Error:', error)
    return { success: false, error: error.message || 'Failed to get summary' }
  }
}

async function handleToolbarClick(tab: chrome.tabs.Tab) {
  try {
    if (tab.id) {
      await rememberFillableTab(tab.id)
    }

    await openStandaloneWindow('toolbar', undefined, {
      anchorWindowId: tab.windowId
    })
  } catch (error) {
    console.error('Open toolbar window error:', error)
    standaloneWindowId = null

    // Some Chromium-based profile browsers can reject popup repositioning. In
    // that case, reuse the existing popup with the smallest compatible update.
    const existingWindow = (await findStandaloneWindows().catch(() => []))[0]?.window
    if (existingWindow?.id) {
      await chrome.windows.update(existingWindow.id, { state: 'normal' }).catch(() => undefined)
      await chrome.windows.update(existingWindow.id, { focused: true })
      standaloneWindowId = existingWindow.id
      return
    }

    const fallbackWindow = await chrome.windows.create({
      url: getStandaloneUrl('toolbar'),
      type: 'popup',
      width: 430,
      height: 780,
      focused: true
    })
    standaloneWindowId = fallbackWindow.id || null
  }
}

// Open standalone window when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  void handleToolbarClick(tab).catch((error) => {
    console.error('Toolbar click recovery failed:', error)
  })
})

chrome.tabs.onActivated.addListener((activeInfo) => {
  rememberFillableTab(activeInfo.tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && canUseAsTargetTab(tab)) {
    fillableTabActivity.set(tabId, Date.now())
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  fillableTabActivity.delete(tabId)
  ignoredTargetTabs.delete(tabId)
})

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === standaloneWindowId) {
    standaloneWindowId = null
  }
})

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return

  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    rememberFillableTab(tabs[0]?.id)
  })
})

// Handle keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-sidepanel') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        rememberFillableTab(tabs[0].id)
        openStandaloneWindow('shortcut', undefined, {
          anchorWindowId: tabs[0].windowId
        })
      }
    })
  }
})

// Handle messages from content script (floating button)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Open side panel
  if (message.action === 'openSidePanel' && sender.tab?.id) {
    rememberFillableTab(sender.tab.id)
    chrome.sidePanel.open({ tabId: sender.tab.id })
    return false
  }

  if (message.action === 'openDockedSidePanel') {
    getTargetTab().then(async (tab) => {
      if (!tab?.id) {
        sendResponse({ success: false, error: '没有找到可停靠的网页。请先打开需要填写的页面。' })
        return
      }

      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sidepanel.html',
        enabled: true
      })
      await chrome.sidePanel.open({ tabId: tab.id })
      sendResponse({ success: true })
    }).catch((error) => {
      console.error('Open docked side panel error:', error)
      sendResponse({ success: false, error: error.message || '无法打开右侧停靠栏' })
    })
    return true
  }

  if ((message.action === 'startFloatingFill' || message.action === 'openFloatingWindow') && sender.tab?.id) {
    rememberFillableTab(sender.tab.id)
    openStandaloneWindow('floating', undefined, {
      autoFill: true,
      anchorWindowId: sender.tab.windowId,
      targetTabId: sender.tab.id
    }).then(() => {
      sendResponse({ success: true })
    }).catch((error) => {
      console.error('Start floating fill error:', error)
      sendResponse({ success: false, error: error.message || '无法开始填写' })
    })
    return true
  }

  if (message.action === 'rememberFillableTab' && sender.tab?.id) {
    rememberFillableTab(sender.tab.id).then(() => sendResponse({ success: true }))
    return true
  }

  if (message.action === 'markAutomationTab' && typeof message.tabId === 'number') {
    ignoredTargetTabs.add(message.tabId)
    fillableTabActivity.delete(message.tabId)
    sendResponse({ success: true })
    return false
  }

  if (message.action === 'forgetTargetTab' && typeof message.tabId === 'number') {
    fillableTabActivity.delete(message.tabId)
    sendResponse({ success: true })
    return false
  }

  // Handle URL-based form fill request
  if (message.action === 'urlBasedFill') {
    handleUrlBasedFill(message.data).then(sendResponse).catch((error) => {
      console.error('URL-based fill error:', error)
      sendResponse({ success: false, error: 'Internal Error' })
    })
    return true // Indicates async response
  }

  if (message.action === 'cancelUrlBasedFill' && typeof message.requestId === 'string') {
    sendResponse({ success: true, cancelled: cancelUrlBasedFill(message.requestId) })
    return false
  }

  if (message.action === 'regenerateField') {
    handleRegenerateField(message.data).then(sendResponse).catch((error) => {
      console.error('Field regenerate error:', error)
      sendResponse({ success: false, error: error.message || 'Internal Error' })
    })
    return true
  }

  if (message.action === 'addExtraInfo') {
    handleAddExtraInfo(message.data).then(sendResponse).catch((error) => {
      console.error('Add extra info error:', error)
      sendResponse({ success: false, error: error.message || 'Internal Error' })
    })
    return true
  }

  if (message.action === 'getTargetTab') {
    getTargetTab().then((tab) => {
      if (!tab?.id) {
        sendResponse({ success: false, error: '没有找到可填写的网页标签页。请先打开一个提交表单页面。' })
        return
      }

      sendResponse({
        success: true,
        tab: {
          id: tab.id,
          title: tab.title,
          url: tab.url
        }
      })
    }).catch((error) => {
      console.error('Get target tab error:', error)
      sendResponse({ success: false, error: error.message || 'Failed to get target tab' })
    })
    return true
  }

  if (message.action === 'getTargetTabById' && typeof message.tabId === 'number') {
    chrome.tabs.get(message.tabId).then((tab) => {
      if (!canUseAsTargetTab(tab) || !tab.id) {
        sendResponse({ success: false, error: '当前网页已关闭、无法访问，或不是可填写页面。' })
        return
      }

      rememberFillableTab(tab.id)
      sendResponse({
        success: true,
        tab: {
          id: tab.id,
          title: tab.title,
          url: tab.url
        }
      })
    }).catch((error) => {
      sendResponse({ success: false, error: error.message || '无法获取当前网页标签页' })
    })
    return true
  }

  if (message.action === 'openStandaloneWindow') {
    openStandaloneWindow(message.from || 'sidebar', message.sessionId, {
      anchorWindowId: sender.tab?.windowId
    }).then(() => {
      sendResponse({ success: true })
    }).catch((error) => {
      console.error('Open standalone window error:', error)
      sendResponse({ success: false, error: error.message || 'Failed to open window' })
    })
    return true
  }

  // Get summary from URL using web search
  if (message.action === 'getSummaryFromUrl') {
    getSummaryFromUrl(message.url).then(sendResponse).catch((error) => {
      console.error('Get summary error:', error)
      sendResponse({ success: false, error: error.message || 'Failed to get summary' })
    })
    return true // Indicates async response
  }
})
