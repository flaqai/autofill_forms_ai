import { useState } from 'react'
import { Button, Input } from '@/components/ui'

interface FormFillDialogProps {
  onConfirm: (url: string) => void
  onClose: () => void
}

export const FormFillDialog = ({ onConfirm, onClose }: FormFillDialogProps) => {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  const handleConfirm = () => {
    if (!url.trim()) {
      setError('请输入网址')
      return
    }

    try {
      new URL(url) // Validate URL
      onConfirm(url)
      onClose()
    } catch {
      setError('请输入有效的网址')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">填充表单</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              参考网址
            </label>
            <Input
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setError('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
              className="w-full"
            />
            {error && (
              <p className="mt-1.5 text-xs text-red-600">{error}</p>
            )}
          </div>
          <p className="text-xs text-slate-500">
            AI 将访问该网址并提取内容,用于填充当前页面的表单
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
          <Button
            onClick={onClose}
            className="bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            取消
          </Button>
          <Button onClick={handleConfirm}>
            确认
          </Button>
        </div>
      </div>
    </div>
  )
}
