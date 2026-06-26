import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

interface NavItemProps {
  icon: string
  label: string
  path: string
  active?: boolean
  onClick?: () => void
}

const NavItem = ({ icon, label, path, active, onClick }: NavItemProps) => {
  const navigate = useNavigate()

  const handleClick = () => {
    navigate(path)
    onClick?.()
  }

  return (
    <button
      onClick={handleClick}
      className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${active ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
        }`}
      title={label}
    >
      <div className="text-xl">{icon}</div>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  )
}

export const Sidebar = () => {
  const { t } = useTranslation()
  const location = useLocation()

  return (
    <div className="w-16 bg-white border-l border-slate-200 flex flex-col items-center py-4 gap-3">
      <NavItem icon="💬" label={t('common.chat')} path="/chat" active={location.pathname === '/chat'} />
      <NavItem
        icon="⚙️"
        label={t('common.settings')}
        path="/settings"
        active={location.pathname === '/settings'}
      />

      <div className="flex-1" />

      {/* User Avatar or Additional Actions */}
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
        AI
      </div>
    </div>
  )
}
