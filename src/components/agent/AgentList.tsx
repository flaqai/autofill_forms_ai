import { AgentCard } from './AgentCard'
import type { Agent } from '@/types'

interface AgentListProps {
  agents: Agent[]
  onAgentClick?: (agent: Agent) => void
}

export const AgentList = ({ agents, onAgentClick }: AgentListProps) => {
  return (
    <div className="space-y-2">
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          onClick={() => onAgentClick?.(agent)}
        />
      ))}
    </div>
  )
}