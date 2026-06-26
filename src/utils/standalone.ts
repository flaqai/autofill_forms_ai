/**
 * Opens the standalone version of the extension in a separate popup window.
 * @param from - Source of the navigation (e.g., 'sidebar', 'popup')
 * @param sessionId - Optional session ID to restore
 */
export const openStandalonePage = async (from: string = 'sidebar', sessionId?: string, autoFill: boolean = false) => {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'openStandaloneWindow',
      from,
      sessionId,
      autoFill
    })

    if (response?.success && from === 'sidebar') {
      window.close()
    }
  } catch {
    const params = new URLSearchParams({ from, mode: 'standalone' })
    if (sessionId) {
      params.append('sessionId', sessionId)
    }
    if (autoFill) {
      params.append('autoFill', '1')
    }

    chrome.tabs.create({
      url: chrome.runtime.getURL(`sidepanel.html?${params.toString()}`),
      active: true
    })
  }
}

/**
 * Gets URL parameters from the current page
 */
export const getUrlParams = () => {
  const params = new URLSearchParams(window.location.search)
  return {
    from: params.get('from'),
    sessionId: params.get('sessionId'),
    mode: params.get('mode'),
    autoFill: params.get('autoFill')
  }
}

/**
 * Checks if the current page is running in standalone mode
 */
export const isStandaloneMode = () => {
  const params = new URLSearchParams(window.location.search)
  return params.get('mode') === 'standalone'
}
