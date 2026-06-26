interface SidebarProps {
  children: React.ReactNode
}

export const Sidebar = ({ children }: SidebarProps) => {
  return (
    <div className="fixed right-0 top-0 h-full w-16 bg-white border-l border-slate-200 flex flex-col items-center py-4 gap-4 shadow-lg z-50">
      {children}
    </div>
  )
}

interface SidebarItemProps {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
}

export const SidebarItem = ({ icon, label, active, onClick }: SidebarItemProps) => {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${
        active ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
      }`}
      title={label}
    >
      <div className="text-xl">{icon}</div>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  )
}