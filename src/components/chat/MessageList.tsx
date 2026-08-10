import { useEffect, useMemo, useRef } from 'react'
import { ScrollArea } from '@/components/ui'
import { MessageBubble } from './MessageBubble'
import type { Message } from '@/types'

interface MessageListProps {
  messages: Message[]
}

export const MessageList = ({ messages }: MessageListProps) => {
  const bottomRef = useRef<HTMLDivElement>(null)
  const messageSignature = useMemo(
    () => messages.map((message) => `${message.id}:${message.content}:${message.thinking || ''}:${message.isStreaming ? '1' : '0'}`).join('|'),
    [messages]
  )

  useEffect(() => {
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({
        block: 'end',
        behavior: 'smooth'
      })
    })
  }, [messageSignature])

  return (
    <ScrollArea className="flex-1 p-3">
      <div className="space-y-3">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
