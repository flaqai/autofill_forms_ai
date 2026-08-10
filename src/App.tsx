import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { isStandaloneMode, openStandalonePage } from '@/utils/standalone'

interface PageErrorBoundaryProps {
  children: ReactNode
  resetKey: string
  onError: (message: string) => void
}

interface PageErrorBoundaryState {
  error: Error | null
}

class PageErrorBoundary extends Component<PageErrorBoundaryProps, PageErrorBoundaryState> {
  state: PageErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PluginPage] Render error', error, info)
    this.props.onError(error.message || '页面渲染时发生未知错误')
  }

  componentDidUpdate(previousProps: PageErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    return this.state.error ? null : this.props.children
  }
}

function getRuntimeErrorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string') return reason
  return '插件页面遇到了未知运行错误'
}

function App() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const standalone = isStandaloneMode()
  const isChatActive = location.pathname === '/chat' || location.pathname === '/'
  const isBatchActive = location.pathname === '/batch'
  const isSettingsActive = location.pathname === '/settings'
  const [runtimeIssue, setRuntimeIssue] = useState<string | null>(null)
  const [copiedIssue, setCopiedIssue] = useState(false)
  const [pageRecoveryToken, setPageRecoveryToken] = useState(0)

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const message = event.error instanceof Error
        ? event.error.message
        : event.message
      if (message) setRuntimeIssue(message)
    }
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      setRuntimeIssue(getRuntimeErrorMessage(event.reason))
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  const copyRuntimeIssue = async () => {
    if (!runtimeIssue) return

    try {
      await navigator.clipboard.writeText(`Chat4o AI Plugin pending issue\nPage: ${location.pathname}\nReason: ${runtimeIssue}`)
      setCopiedIssue(true)
      window.setTimeout(() => setCopiedIssue(false), 1800)
    } catch {
      setCopiedIssue(false)
    }
  }

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
            <button
              onClick={() => navigate('/batch')}
              className={`px-2 py-1.5 text-xs rounded-lg transition-colors ${isBatchActive
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-slate-600 hover:bg-slate-100'
                }`}
              title="批量提交"
            >
              批量
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
        <div className="relative flex-1 overflow-hidden">
          <PageErrorBoundary resetKey={`${location.pathname}:${pageRecoveryToken}`} onError={setRuntimeIssue}>
            <Outlet />
          </PageErrorBoundary>

          {runtimeIssue && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4">
              <div className="w-full max-w-sm rounded-lg border border-amber-200 bg-white p-4 shadow-xl">
                <p className="text-sm font-semibold text-slate-900">待确认问题</p>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  插件遇到了一个需要继续分析的问题。你的已保存资料没有被清空。
                </p>
                <p className="mt-2 max-h-20 overflow-auto rounded bg-slate-50 px-2 py-1.5 font-mono text-[10px] leading-4 text-slate-500">
                  {runtimeIssue}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void copyRuntimeIssue()}
                    className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {copiedIssue ? '已复制' : '复制诊断信息'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRuntimeIssue(null)
                      setPageRecoveryToken((token) => token + 1)
                    }}
                    className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    重新打开页面
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
