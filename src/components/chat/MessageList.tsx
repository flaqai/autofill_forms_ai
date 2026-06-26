import { ScrollArea } from '@/components/ui'
import { MessageBubble } from './MessageBubble'
import type { Message } from '@/types'

interface MessageListProps {
  messages: Message[]
}

export const MessageList = ({ messages }: MessageListProps) => {
  return (
    <ScrollArea className="flex-1 p-3">
      <div className="space-y-3">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
    </ScrollArea>
  )
}