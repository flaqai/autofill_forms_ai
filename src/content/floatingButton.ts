// Floating button displayed on all web pages using Shadow DOM
const FLOATING_BUTTON_POSITION_KEY = 'chat4o-floating-button-position'
const FLOATING_BUTTON_SIZE = 56
const FLOATING_BUTTON_MARGIN = 12

const createFloatingButton = () => {
  // Check if button already exists
  if (document.getElementById('chat4o-floating-button-host')) {
    return
  }

  // Create host element for Shadow DOM
  const host = document.createElement('div')
  host.id = 'chat4o-floating-button-host'
  host.style.cssText = 'position: fixed; bottom: 0; right: 0; z-index: 2147483647;'

  // Attach Shadow DOM
  const shadowRoot = host.attachShadow({ mode: 'open' })

  // Create styles
  const style = document.createElement('style')
  style.textContent = `
    .floating-container {
      position: fixed;
      bottom: 200px;
      right: 24px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }

    .status-bubble {
      max-width: 148px;
      padding: 7px 10px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.92);
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      line-height: 16px;
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.18);
      opacity: 0;
      pointer-events: none;
      transform: translateY(4px);
      transition: opacity 0.18s ease, transform 0.18s ease;
    }

    .status-bubble.is-visible {
      opacity: 1;
      transform: translateY(0);
    }

    .close-button {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #ffffff;
      border: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: #9ca3af;
      transition: all 0.2s ease;
      z-index: 1;
    }

    .close-button:hover {
      background: #f9fafb;
      color: #6b7280;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    }

    .floating-button {
      position: relative;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: none;
      outline: none;
      padding: 0;
    }

    .floating-button.is-starting {
      cursor: wait;
    }

    .floating-button.is-dragging {
      cursor: grabbing;
      transition: none;
    }

    .floating-button.is-starting::after {
      content: '';
      position: absolute;
      inset: 4px;
      border: 2px solid rgba(37, 99, 235, 0.2);
      border-top-color: #2563eb;
      border-radius: 50%;
      animation: chat4o-spin 0.8s linear infinite;
    }

    .floating-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    }

    .floating-button:active {
      transform: translateY(0) scale(0.96);
    }

    .button-icon {
      width: 28px;
      height: 28px;
      fill: #5865f2;
    }

    .hidden {
      display: none;
    }

    @keyframes chat4o-spin {
      to { transform: rotate(360deg); }
    }
  `

  // Create container
  const container = document.createElement('div')
  container.className = 'floating-container'

  // Create close button
  const closeButton = document.createElement('button')
  closeButton.className = 'close-button'
  closeButton.innerHTML = '×'
  closeButton.title = '隐藏填写按钮'

  const statusBubble = document.createElement('div')
  statusBubble.className = 'status-bubble'
  statusBubble.setAttribute('role', 'status')

  // Create main button
  const button = document.createElement('button')
  button.className = 'floating-button'
  button.title = '开始填写当前页面'

  // Use SVG icon instead of emoji
  button.innerHTML = `
    <svg class="button-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.48 2 2 6.48 2 12C2 13.93 2.6 15.72 3.63 17.2L2.3 21.7C2.11 22.29 2.63 22.81 3.22 22.62L7.72 21.29C9.2 22.32 11 22.92 13 22.92C18.52 22.92 23 18.44 23 12.92C23 6.48 18.52 2 13 2H12ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20ZM8.5 11C9.33 11 10 10.33 10 9.5C10 8.67 9.33 8 8.5 8C7.67 8 7 8.67 7 9.5C7 10.33 7.67 11 8.5 11ZM15.5 11C16.33 11 17 10.33 17 9.5C17 8.67 16.33 8 15.5 8C14.67 8 14 8.67 14 9.5C14 10.33 14.67 11 15.5 11ZM12 17C14.21 17 16.09 15.79 17 14H7C7.91 15.79 9.79 17 12 17Z"/>
    </svg>
  `

  // Close button handler - hide the entire floating button
  closeButton.addEventListener('click', (e) => {
    e.stopPropagation()
    container.classList.add('hidden')
  })

  let statusTimer: number | undefined
  let starting = false
  let dragStart: { pointerId: number; offsetX: number; offsetY: number; moved: boolean } | null = null
  let skipNextClick = false

  const clampButtonPosition = (left: number, top: number) => ({
    left: Math.min(
      Math.max(FLOATING_BUTTON_MARGIN, left),
      Math.max(FLOATING_BUTTON_MARGIN, window.innerWidth - FLOATING_BUTTON_SIZE - FLOATING_BUTTON_MARGIN)
    ),
    top: Math.min(
      Math.max(FLOATING_BUTTON_MARGIN, top),
      Math.max(FLOATING_BUTTON_MARGIN, window.innerHeight - FLOATING_BUTTON_SIZE - FLOATING_BUTTON_MARGIN)
    )
  })

  const setButtonPosition = (left: number, top: number) => {
    const clamped = clampButtonPosition(left, top)
    container.style.right = `${Math.max(FLOATING_BUTTON_MARGIN, window.innerWidth - clamped.left - FLOATING_BUTTON_SIZE)}px`
    container.style.bottom = `${Math.max(FLOATING_BUTTON_MARGIN, window.innerHeight - clamped.top - FLOATING_BUTTON_SIZE)}px`
    return clamped
  }

  const saveButtonPosition = async () => {
    const rect = button.getBoundingClientRect()
    const position = {
      right: Math.max(FLOATING_BUTTON_MARGIN, window.innerWidth - rect.right),
      bottom: Math.max(FLOATING_BUTTON_MARGIN, window.innerHeight - rect.bottom)
    }
    await chrome.storage.local.set({ [FLOATING_BUTTON_POSITION_KEY]: position })
  }

  const restoreButtonPosition = async () => {
    try {
      const stored = await chrome.storage.local.get(FLOATING_BUTTON_POSITION_KEY)
      const position = stored[FLOATING_BUTTON_POSITION_KEY] as { right?: unknown; bottom?: unknown } | undefined
      if (typeof position?.right !== 'number' || typeof position?.bottom !== 'number') return

      setButtonPosition(
        window.innerWidth - position.right - FLOATING_BUTTON_SIZE,
        window.innerHeight - position.bottom - FLOATING_BUTTON_SIZE
      )
    } catch {
      // Keep the default position when storage is not available.
    }
  }

  const showStatus = (message: string) => {
    window.clearTimeout(statusTimer)
    statusBubble.textContent = message
    statusBubble.classList.add('is-visible')
  }

  const resetButton = () => {
    starting = false
    button.classList.remove('is-starting')
    button.removeAttribute('aria-busy')
    button.title = '开始填写当前页面'
    statusTimer = window.setTimeout(() => {
      statusBubble.classList.remove('is-visible')
    }, 1600)
  }

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || starting) return

    const rect = button.getBoundingClientRect()
    dragStart = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false
    }
    button.setPointerCapture(event.pointerId)
  })

  button.addEventListener('pointermove', (event) => {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return

    const nextLeft = event.clientX - dragStart.offsetX
    const nextTop = event.clientY - dragStart.offsetY
    const currentRect = button.getBoundingClientRect()
    if (Math.abs(nextLeft - currentRect.left) > 3 || Math.abs(nextTop - currentRect.top) > 3) {
      dragStart.moved = true
      button.classList.add('is-dragging')
      setButtonPosition(nextLeft, nextTop)
    }
  })

  const finishDrag = (event: PointerEvent) => {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return

    const moved = dragStart.moved
    dragStart = null
    button.classList.remove('is-dragging')
    if (button.hasPointerCapture(event.pointerId)) {
      button.releasePointerCapture(event.pointerId)
    }

    if (moved) {
      skipNextClick = true
      void saveButtonPosition()
      window.setTimeout(() => {
        skipNextClick = false
      }, 0)
    }
  }

  button.addEventListener('pointerup', finishDrag)
  button.addEventListener('pointercancel', finishDrag)
  window.addEventListener('resize', () => {
    const rect = button.getBoundingClientRect()
    setButtonPosition(rect.left, rect.top)
  })

  // Main button handler - start a fill for this exact browser tab.
  button.addEventListener('click', async () => {
    if (skipNextClick) {
      skipNextClick = false
      return
    }

    if (starting) return

    starting = true
    button.classList.add('is-starting')
    button.setAttribute('aria-busy', 'true')
    button.title = '正在开始填写'
    showStatus('正在开始填写...')

    try {
      const response = await chrome.runtime.sendMessage({ action: 'startFloatingFill' })
      if (!response?.success) {
        throw new Error(response?.error || '无法开始填写')
      }
      showStatus('已开始填写')
    } catch {
      showStatus('无法开始，请刷新当前网页后重试')
    } finally {
      resetButton()
    }
  })

  // Add to container
  container.appendChild(statusBubble)
  container.appendChild(closeButton)
  container.appendChild(button)

  // Add to Shadow DOM
  shadowRoot.appendChild(style)
  shadowRoot.appendChild(container)

  // Add to body
  document.body.appendChild(host)
  void restoreButtonPosition()
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFloatingButton)
} else {
  createFloatingButton()
}
