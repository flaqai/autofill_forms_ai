import { useTranslation } from 'react-i18next'
import { openStandalonePage } from '@/utils/standalone'

interface WelcomeViewProps {
  onFormFillClick: () => void
}

interface ActionItemProps {
  icon: string
  title: string
  description: string
  onClick: () => void
}

const ActionItem = ({ icon, title, description, onClick }: ActionItemProps) => (
  <button
    onClick={onClick}
    className="w-full p-4 bg-white border border-slate-200 rounded-xl hover:border-blue-300 hover:shadow-md transition-all text-left group"
  >
    <div className="flex items-start gap-3">
      <div className="text-2xl flex-shrink-0 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-slate-800 mb-0.5">{title}</h3>
        <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
      </div>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-slate-300 group-hover:text-blue-500 transition-colors flex-shrink-0 mt-0.5"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </div>
  </button>
)

export const WelcomeView = ({ onFormFillClick }: WelcomeViewProps) => {
  const { t } = useTranslation()

  const handleFullscreenClick = () => {
    openStandalonePage('sidebar')
  }

  return (
    <div className="h-full flex flex-col items-center justify-start p-4 pt-8">
      <div className="w-full max-w-sm space-y-4">
        {/* Welcome Message */}
        <div className="text-center space-y-1.5">
          <h1 className="text-xl font-bold text-slate-900">
            {t('home.welcomeMessage')}
          </h1>
          <p className="text-xs text-slate-500">
            选择一个工具开始使用,或直接在下方输入消息
          </p>
        </div>

        {/* Tools Section */}
        <div className="space-y-2.5">
          <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide px-1">
            快捷工具
          </h2>
          <div className="space-y-2">
            <ActionItem
              icon="⛶"
              title="独立窗口"
              description="把插件移到单独窗口,减少网页遮挡"
              onClick={handleFullscreenClick}
            />
            <ActionItem
              icon="📝"
              title="填充表单"
              description="使用推广资料智能匹配表单字段"
              onClick={onFormFillClick}
            />
          </div>
        </div>

        {/* Quick Tips */}
        <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
          <div className="flex items-start gap-2.5">
            <span className="text-lg flex-shrink-0">💡</span>
            <div>
              <h3 className="text-xs font-semibold text-slate-800 mb-1">快速提示</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                按 <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-mono">Ctrl+Shift+Y</kbd> 快速打开侧边栏
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
