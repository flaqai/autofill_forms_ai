import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { isStandaloneMode, openStandalonePage } from '@/utils/standalone'

function App() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const standalone = isStandaloneMode()
  const isChatActive = location.pathname === '/chat' || location.pathname === '/'
  const isSettingsActive = location.pathname === '/settings'

  return (
    <div className="flex h-screen w-full bg-slate-50">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex flex-shrink-0 items-center justify-center text-white font-bold text-sm">
              C4
            </div>
            <span className="font-semibold text-sm text-slate-800 truncate">{t('header.title')}</span>
            {standalone && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded">
                窗口
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate('/chat')}
              className={`px-2 py-1.5 text-xs rounded-lg transition-colors ${isChatActive
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-slate-600 hover:bg-slate-100'
                }`}
              title={t('common.chat')}
            >
              聊天
            </button>
            <button
              onClick={() => navigate('/settings')}
              className={`px-2 py-1.5 text-xs rounded-lg transition-colors ${isSettingsActive
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-slate-600 hover:bg-slate-100'
                }`}
              title={t('common.settings')}
            >
              设置
            </button>
            {!standalone && (
              <button
                onClick={() => openStandalonePage('sidebar')}
                className="px-2 py-1.5 text-xs rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                title="独立窗口"
              >
                窗口
              </button>
            )}
          </div>
        </div>

        {/* Page Content */}
        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export default App
