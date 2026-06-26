// Floating button displayed on all web pages using Shadow DOM
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
  `

  // Create container
  const container = document.createElement('div')
  container.className = 'floating-container'

  // Create close button
  const closeButton = document.createElement('button')
  closeButton.className = 'close-button'
  closeButton.innerHTML = '×'
  closeButton.title = 'Hide Chat Button'

  // Create main button
  const button = document.createElement('button')
  button.className = 'floating-button'
  button.title = 'Open Chat4o AI'

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

  // Main button click handler - open side panel
  button.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openSidePanel' })
  })

  // Add to container
  container.appendChild(closeButton)
  container.appendChild(button)

  // Add to Shadow DOM
  shadowRoot.appendChild(style)
  shadowRoot.appendChild(container)

  // Add to body
  document.body.appendChild(host)
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFloatingButton)
} else {
  createFloatingButton()
}
