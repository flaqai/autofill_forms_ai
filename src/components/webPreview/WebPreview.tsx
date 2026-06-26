import { useState } from 'react'
import { Button, Input, ScrollArea } from '@/components/ui'
import { useSettingsStore } from '@/store/settingsStore'
import { chatAPI } from '@/services/api'

interface WebPreviewProps {
  onClose: () => void
}

export const WebPreview = ({ onClose }: WebPreviewProps) => {
  const [url, setUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const { apiKey, apiBaseURL, model } = useSettingsStore()

  // Summarize URL content using LLM with web search capability
  const handleSummarize = async () => {
    if (!url) {
      setError('Please enter a valid URL')
      return
    }

    try {
      new URL(url) // Validate URL
    } catch {
      setError('Invalid URL format')
      return
    }

    if (!apiKey) {
      setError('API Key not configured. Please configure it in Settings.')
      return
    }

    setIsLoading(true)
    setError('')
    setSummary('')

    try {
      chatAPI.setApiKey(apiKey)
      if (apiBaseURL) chatAPI.setBaseURL(apiBaseURL)

      const prompt = `Please visit this URL and provide a detailed summary of the webpage content: ${url}

Focus on extracting:
1. Main title and purpose of the page
2. Key information, facts, and data
3. Important names, dates, URLs, and contact information
4. Product/service descriptions if applicable
5. Any forms or data that might be relevant

Provide a structured summary that can be used to auto-fill forms on other websites.`

      const result = await chatAPI.sendMessage([
        { id: 'usr', role: 'user', content: prompt, timestamp: new Date() }
      ], {
        model: model || 'gpt-3.5-turbo',
        temperature: 0.3,
        enableWebSearch: true
      })

      setSummary(result)
      setIsLoading(false)
    } catch (err: any) {
      console.error('[WebPreview] Summarize error:', err)
      setError(err.message || 'Failed to summarize content. Make sure you are using a model with web search capability.')
      setIsLoading(false)
    }
  }

  // Save summary for form filling
  const handleSaveForFormFill = async () => {
    if (!summary || !url) return

    try {
      await chrome.storage.local.set({
        'webSummary': {
          url: url,
          summary: summary,
          timestamp: Date.now()
        }
      })

      alert('Summary saved! You can now navigate to a form page and use Auto-Fill.')
      onClose()
    } catch (err: any) {
      console.error('[WebPreview] Save error:', err)
      setError('Failed to save summary')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Web Content Summarizer</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* URL Input */}
        <div className="p-4 border-b border-slate-200">
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="Enter URL (e.g., https://example.com)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSummarize()}
              className="flex-1"
            />
            <Button onClick={handleSummarize} disabled={isLoading || !url}>
              {isLoading ? 'Summarizing...' : 'Summarize'}
            </Button>
            {summary && (
              <Button onClick={handleSaveForFormFill} disabled={isLoading}>
                Use for Form Fill
              </Button>
            )}
          </div>
          {error && (
            <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
              {error}
            </div>
          )}
          <div className="mt-2 text-xs text-slate-500">
            Note: This requires a model with web search capability (e.g., Gemini 2.0 Flash)
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full p-4">
            {summary ? (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-semibold text-slate-700 mb-2">AI Summary</div>
                  <div className="text-sm text-slate-900 whitespace-pre-wrap bg-blue-50 p-4 rounded-lg border border-blue-200">
                    {summary}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200">
                  <div className="text-sm font-semibold text-slate-700 mb-2">Source URL</div>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline break-all"
                  >
                    {url}
                  </a>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400">
                <div className="text-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="64"
                    height="64"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mx-auto mb-4"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <p className="text-lg font-medium">Enter a URL to get AI summary</p>
                  <p className="text-sm mt-2">The AI will visit the page and extract key information</p>
                </div>
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}
