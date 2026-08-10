/**
 * Opens the standalone version of the extension in a separate popup window.
 * @param from - Source of the navigation (e.g., 'sidebar', 'popup')
 * @param sessionId - Optional session ID to restore
 */
export const openStandalonePage = async (from: string = 'sidebar', sessionId?: string) => {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'openStandaloneWindow',
      from,
      sessionId
    })

    if (!response?.success) {
      console.error('Failed to open standalone window:', response?.error || 'Unknown error')
      return false
    }

    if (from === 'sidebar') {
      window.close()
    }
    return true
  } catch {
    console.error('Failed to open standalone window')
    return false
  }
}

export const dockToSidePanel = async () => {
  const response = await chrome.runtime.sendMessage({ action: 'openDockedSidePanel' })
  if (!response?.success) {
    throw new Error(response?.error || '无法打开右侧停靠栏')
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
    mode: params.get('mode')
  }
}

/**
 * Checks if the current page is running in standalone mode
 */
export const isStandaloneMode = () => {
  const params = new URLSearchParams(window.location.search)
  return params.get('mode') === 'standalone'
}
