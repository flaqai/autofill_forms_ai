import { handleUrlBasedFill } from './urlBasedFill'
import { chatAPI } from '../services/api'
import { STORAGE_KEYS } from '../config/constants'

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

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id })
  }
})

// Handle keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-sidepanel') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.sidePanel.open({ tabId: tabs[0].id })
      }
    })
  }
})

// Handle messages from content script (floating button)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Open side panel
  if (message.action === 'openSidePanel' && sender.tab?.id) {
    chrome.sidePanel.open({ tabId: sender.tab.id })
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

  // Get summary from URL using web search
  if (message.action === 'getSummaryFromUrl') {
    getSummaryFromUrl(message.url).then(sendResponse).catch((error) => {
      console.error('Get summary error:', error)
      sendResponse({ success: false, error: error.message || 'Failed to get summary' })
    })
    return true // Indicates async response
  }
})

