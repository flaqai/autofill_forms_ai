import { useState } from 'react'
import type { Message } from '@/types'

interface MessageBubbleProps {
  message: Message
}

const ThinkingBlock = ({ thinking }: { thinking: string }) => {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <span>{expanded ? '收起思考过程' : '展开思考过程'}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
          {thinking}
        </div>
      )}
    </div>
  )
}

const UrlAttachment = ({ url }: { url: string }) => (
  <div className="mt-1.5 flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-slate-400 flex-shrink-0"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[11px] text-blue-500 hover:text-blue-700 hover:underline truncate"
    >
      {url}
    </a>
  </div>
)

const StreamingDots = () => (
  <span className="inline-flex items-center gap-0.5 ml-1">
    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
  </span>
)

export const MessageBubble = ({ message }: MessageBubbleProps) => {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%]">
          <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3.5 py-2.5">
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
          </div>
          {message.metadata?.url && (
            <div className="mt-1">
              <UrlAttachment url={message.metadata.url} />
            </div>
          )}
        </div>
      </div>
    )
  }

  // Assistant message
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%]">
        {message.thinking && <ThinkingBlock thinking={message.thinking} />}
        <div className="bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-tl-sm px-3.5 py-2.5 shadow-sm">
          {message.content ? (
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
          ) : null}
          {message.isStreaming && <StreamingDots />}
        </div>
      </div>
    </div>
  )
}
