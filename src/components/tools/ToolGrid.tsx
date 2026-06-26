import { ToolCard } from './ToolCard'
import type { Tool } from '@/types'

interface ToolGridProps {
  tools: Tool[]
  onToolClick?: (tool: Tool) => void
}

export const ToolGrid = ({ tools, onToolClick }: ToolGridProps) => {
  return (
    <div className="grid grid-cols-3 gap-2">
      {tools.map((tool) => (
        <ToolCard
          key={tool.id}
          tool={tool}
          onClick={() => onToolClick?.(tool)}
        />
      ))}
    </div>
  )
}