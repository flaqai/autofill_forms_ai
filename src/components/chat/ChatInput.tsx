import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  leadingAction?: React.ReactNode
}

export const ChatInput = ({ onSend, disabled, leadingAction }: ChatInputProps) => {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [input])

  const handleSend = () => {
    if (!input.trim() || disabled) return
    onSend(input)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="p-3 bg-white border-t border-slate-200">
      {leadingAction && (
        <div className="mb-2">
          {leadingAction}
        </div>
      )}
      <div className="relative flex items-end gap-2 bg-white rounded-xl border-2 border-slate-200 focus-within:border-blue-400 transition-all shadow-sm">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.inputPlaceholder')}
          className="flex-1 max-h-24 min-h-[40px] bg-transparent resize-none outline-none text-sm px-3 py-2.5 text-slate-700 placeholder-slate-400"
          rows={1}
          disabled={disabled}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || disabled}
          className="flex-shrink-0 m-1 p-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-all active:scale-95"
          title={t('chat.send')}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m22 2-7 20-4-9-9-4Z" />
            <path d="M22 2 11 13" />
          </svg>
        </button>
      </div>
    </div>
  )
}
