import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sidebar } from '@/components/layout/Sidebar'
import { isStandaloneMode } from '@/utils/standalone'

function App() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const standalone = isStandaloneMode()

  return (
    <div className="flex h-screen w-full bg-slate-50">
      {/* Left Sidebar - Only in standalone mode */}
      {standalone && <Sidebar />}

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col overflow-hidden ${standalone ? 'max-w-7xl mx-auto' : ''}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
              C4
            </div>
            <span className="font-semibold text-base text-slate-800">{t('header.title')}</span>
            {standalone && (
              <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
                Fullscreen
              </span>
            )}
          </div>

          {/* Standalone mode navigation */}
          {standalone && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${location.pathname === '/'
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-100'
                  }`}
              >
                {t('common.home')}
              </button>
              <button
                onClick={() => navigate('/chat')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${location.pathname === '/chat'
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-100'
                  }`}
              >
                {t('common.chat')}
              </button>
              <button
                onClick={() => navigate('/settings')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${location.pathname === '/settings'
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-100'
                  }`}
              >
                {t('common.settings')}
              </button>
            </div>
          )}
        </div>

        {/* Page Content */}
        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      </div>

      {/* Right Sidebar - Only in sidebar mode */}
      {!standalone && <Sidebar />}
    </div>
  )
}

export default App