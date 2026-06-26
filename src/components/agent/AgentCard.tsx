import type { Agent } from '@/types'

interface AgentCardProps {
  agent: Agent
  onClick?: () => void
}

export const AgentCard = ({ agent, onClick }: AgentCardProps) => {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all text-left w-full"
    >
      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center text-lg">
        {agent.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <h3 className="text-xs font-semibold text-slate-900">{agent.name}</h3>
          {agent.badge && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-600 rounded">
              {agent.badge}
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-500 line-clamp-2 leading-tight">{agent.description}</p>
      </div>
    </button>
  )
}