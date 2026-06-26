/**
 * Opens the standalone full-screen version of the extension in a new tab
 * @param from - Source of the navigation (e.g., 'sidebar', 'popup')
 * @param sessionId - Optional session ID to restore
 */
export const openStandalonePage = (from: string = 'sidebar', sessionId?: string) => {
  const params = new URLSearchParams({ from, mode: 'standalone' })
  if (sessionId) {
    params.append('sessionId', sessionId)
  }

  const url = chrome.runtime.getURL(`sidepanel.html?${params.toString()}`)

  chrome.tabs.create({
    url,
    active: true
  })
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
