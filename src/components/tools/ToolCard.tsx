import type { Tool } from '@/types'

interface ToolCardProps {
  tool: Tool
  onClick?: () => void
}

export const ToolCard = ({ tool, onClick }: ToolCardProps) => {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all group"
    >
      <div className="text-xl">{tool.icon}</div>
      <span className="text-xs text-slate-700 font-medium text-center leading-tight">{tool.name}</span>
    </button>
  )
}