import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ScrollArea } from '@/components/ui'
import { SettingsPanel } from '@/components/settings/SettingsPanel'

interface SettingsErrorBoundaryProps {
  children: ReactNode
}

interface SettingsErrorBoundaryState {
  error: Error | null
}

class SettingsErrorBoundary extends Component<SettingsErrorBoundaryProps, SettingsErrorBoundaryState> {
  state: SettingsErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): SettingsErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[SettingsPage] Render error', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">设置页暂时没有加载成功</p>
          <p className="mt-2 text-xs leading-5">你的已保存资料没有被清空。请点击下面的按钮重新打开设置页。</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-3 rounded-md bg-red-700 px-3 py-2 text-xs font-medium text-white hover:bg-red-800"
          >
            重新打开设置
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export const SettingsPage = () => {
  return (
    <SettingsErrorBoundary>
      <ScrollArea className="h-full">
        <SettingsPanel />
      </ScrollArea>
    </SettingsErrorBoundary>
  )
}
