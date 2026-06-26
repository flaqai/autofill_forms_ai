// Content script for form extraction and filling

// Extract all form fields from the current page
function extractFormFields() {
  const fields: any[] = []

  // Get all input, textarea, and select elements
  const inputs = document.querySelectorAll('input, textarea, select')

  inputs.forEach((element, index) => {
    const el = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

    // Skip hidden, submit, button, and file inputs
    if (
      el.type === 'hidden' ||
      el.type === 'submit' ||
      el.type === 'button' ||
      el.type === 'file' ||
      el.type === 'image'
    ) {
      return
    }

    const field = {
      id: el.id || `field_${index}`,
      name: el.name || el.id || `field_${index}`,
      type: el.type || 'text',
      tagName: el.tagName.toLowerCase(),
      placeholder: (el as HTMLInputElement).placeholder || '',
      label: getFieldLabel(el),
      value: el.value || '',
      required: (el as HTMLInputElement).required || false
    }

    fields.push(field)
  })

  console.log('[FormExtractor] Extracted fields:', fields.length)
  return fields
}

// Get label text for a form field
function getFieldLabel(element: HTMLElement): string {
  // Try to find associated label
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`)
    if (label) {
      return label.textContent?.trim() || ''
    }
  }

  // Try to find parent label
  const parentLabel = element.closest('label')
  if (parentLabel) {
    return parentLabel.textContent?.trim() || ''
  }

  // Try to find nearby text
  const prev = element.previousElementSibling
  if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN')) {
    return prev.textContent?.trim() || ''
  }

  return ''
}

// Fill form fields with provided data
function fillForm(data: Record<string, any>) {
  console.log('[FormFiller] Filling form with data:', data)

  let filledCount = 0

  Object.entries(data).forEach(([key, value]) => {
    // Try to find element by id first
    let element = document.getElementById(key) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

    // If not found, try by name
    if (!element) {
      element = document.querySelector(`[name="${key}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    }

    if (element) {
      // Handle different input types
      if (element.type === 'checkbox' || element.type === 'radio') {
        (element as HTMLInputElement).checked = Boolean(value)
      } else if (element.tagName === 'SELECT') {
        (element as HTMLSelectElement).value = String(value)
      } else {
        element.value = String(value)
      }

      // Trigger change event
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))

      filledCount++
      console.log(`[FormFiller] Filled field: ${key} = ${value}`)
    }
  })

  console.log(`[FormFiller] Filled ${filledCount} fields`)
  return { success: true, filledCount }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[FormContent] Received message:', message.action)

  if (message.action === 'extractFormFields') {
    try {
      const fields = extractFormFields()
      sendResponse(fields)
    } catch (error) {
      console.error('[FormContent] Extract error:', error)
      sendResponse([])
    }
    return true
  }

  if (message.action === 'fillForm') {
    try {
      const result = fillForm(message.data)
      sendResponse(result)
    } catch (error) {
      console.error('[FormContent] Fill error:', error)
      sendResponse({ success: false, error: (error as Error).message })
    }
    return true
  }

  return false
})

console.log('[FormContent] Form content script loaded')
