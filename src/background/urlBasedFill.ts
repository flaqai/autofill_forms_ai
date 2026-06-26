import { chatAPI } from '../services/api'
import { STORAGE_KEYS } from '../config/constants'

/**
 * Handle form filling based on URL summary
 */
export async function handleUrlBasedFill(data: {
  sourceUrl: string
  sourceSummary: string
  formFields: any[]
  pageContext: any
}) {
  const { sourceUrl, sourceSummary, formFields, pageContext } = data

  console.log('[UrlBasedFill] Starting URL-based fill', { sourceUrl, formFields })

  // Get settings
  const storageData = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS)
  let settings: any = null

  if (storageData[STORAGE_KEYS.SETTINGS]) {
    try {
      const parsed = JSON.parse(storageData[STORAGE_KEYS.SETTINGS])
      settings = parsed.state || parsed
    } catch (e) {
      console.error('[UrlBasedFill] Failed to parse settings', e)
      return { success: false, error: 'Failed to load settings' }
    }
  }

  if (!settings?.apiKey) {
    return { success: false, error: 'API Key not configured. Please configure it in Settings.' }
  }

  chatAPI.setApiKey(settings.apiKey)
  if (settings.apiBaseURL) chatAPI.setBaseURL(settings.apiBaseURL)

  // Build prompt for form filling using the summary
  const systemPrompt = `You are a helpful assistant that auto-fills web forms using content from a webpage summary.

CRITICAL INSTRUCTIONS:
1. Use the provided webpage summary to fill the form fields intelligently
2. Output ONLY a valid JSON object, nothing else
3. Do NOT use markdown code blocks or any formatting
4. Use field 'id' as the key (or 'name' if id is empty)
5. For checkboxes/radios, use boolean true/false
6. Match the content from the summary to the most appropriate form fields
7. If information is not available in the summary, use reasonable defaults or leave empty

Example output format:
{"email": "user@example.com", "name": "John Doe", "url": "https://example.com"}`

  const userPrompt = `Source Page URL: ${sourceUrl}

Source Page Summary:
${sourceSummary}

Current Page (where form is):
- Title: ${pageContext.title}
- URL: ${pageContext.url}

Form Fields to Fill:
${JSON.stringify(formFields, null, 2)}

Generate the JSON object to fill this form based on the source page summary (JSON only, no other text):`

  // Call LLM to generate form data (without web search)
  try {
    console.log('[UrlBasedFill] Calling LLM to generate form data...')
    const rawResponse = await chatAPI.sendMessage([
      { id: 'sys', role: 'system', content: systemPrompt, timestamp: new Date() },
      { id: 'usr', role: 'user', content: userPrompt, timestamp: new Date() }
    ], {
      model: settings.model || 'gpt-3.5-turbo',
      temperature: 0.2,
      enableWebSearch: false  // Do NOT enable web search for form filling
    })

    console.log('[UrlBasedFill] Raw LLM response:', rawResponse)

    // Parse response
    let jsonString = rawResponse.trim()

    // Remove markdown code blocks
    if (jsonString.includes('```')) {
      const match = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      if (match?.[1]) jsonString = match[1].trim()
    }

    // Find JSON object boundaries
    const jsonStart = jsonString.indexOf('{')
    const jsonEnd = jsonString.lastIndexOf('}')
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      jsonString = jsonString.substring(jsonStart, jsonEnd + 1)
    }

    console.log('[UrlBasedFill] Extracted JSON:', jsonString)

    const filledData = JSON.parse(jsonString)
    console.log('[UrlBasedFill] Parsed data:', filledData)

    // Validate
    if (typeof filledData !== 'object' || filledData === null || Array.isArray(filledData)) {
      throw new Error('Invalid response format: expected JSON object')
    }

    return {
      success: true,
      filledData,
      sourceInfo: {
        url: sourceUrl
      }
    }
  } catch (error: any) {
    console.error('[UrlBasedFill] Error:', error)
    let errorMessage = 'Failed to generate form data'
    if (error.message?.includes('JSON')) {
      errorMessage = 'Failed to parse AI response'
    }
    return { success: false, error: errorMessage, details: error.message }
  }
}
