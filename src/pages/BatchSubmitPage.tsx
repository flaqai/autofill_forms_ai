import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import type { ProductProfile } from '@/types'
import {
  batchRunner,
  type BatchItem,
  type BatchRunnerState,
  type BatchStatus
} from '@/utils/batchRunner'
import {
  exportEvaluationPackageText,
  isEvaluationStorageKey,
  readEvaluationSessions,
  type EvaluationSession
} from '@/utils/evaluationLogs'

function statusLabel(status: BatchStatus) {
  const labels: Record<BatchStatus, string> = {
    pending: '待处理',
    opening: '打开中',
    preflight: '登录预检',
    checking: '检查页面',
    finding: '寻找提交页',
    awaiting_human: '需要人工',
    verifying: '验证人工操作',
    filling: '填写中',
    review: '等待检查',
    failed: '失败'
  }

  return labels[status]
}

function statusClass(status: BatchStatus) {
  if (status === 'review') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'awaiting_human') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (status === 'verifying') return 'bg-violet-50 text-violet-700 border-violet-200'
  if (status === 'failed') return 'bg-red-50 text-red-700 border-red-200'
  if (status === 'pending') return 'bg-slate-50 text-slate-600 border-slate-200'
  return 'bg-blue-50 text-blue-700 border-blue-200'
}

type QueueFilter = 'all' | 'attention' | 'review' | 'failed' | 'awaiting_human'

function getDisplayHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}

function matchesQueueFilter(item: BatchItem, filter: QueueFilter) {
  if (filter === 'all') return true
  if (filter === 'attention') {
    return ['review', 'failed', 'awaiting_human'].includes(item.status)
  }
  return item.status === filter
}

type BatchQueuePanelProps = {
  items: BatchItem[]
  pendingCount: number
  productProfile: ProductProfile
  onItemCardClick: (event: React.MouseEvent<HTMLDivElement>, item: BatchItem) => void
}

const BatchQueuePanel = ({
  items,
  pendingCount,
  productProfile,
  onItemCardClick
}: BatchQueuePanelProps) => {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<QueueFilter>('all')
  const [compact, setCompact] = useState(true)
  const [cursorId, setCursorId] = useState('')
  const itemRefs = useRef(new Map<string, HTMLDivElement>())

  const normalizedQuery = query.trim().toLowerCase()
  const visibleItems = items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .filter(({ item, originalIndex }) => {
      if (!matchesQueueFilter(item, filter)) return false
      if (!normalizedQuery) return true

      const searchableText = [
        item.inputUrl,
        item.currentUrl,
        item.submitUrl,
        item.message,
        getDisplayHost(item.inputUrl)
      ].filter(Boolean).join(' ').toLowerCase()
      const numberMatches = normalizedQuery === String(originalIndex + 1) || normalizedQuery === `#${originalIndex + 1}`
      return numberMatches || searchableText.includes(normalizedQuery)
    })

  const attentionCount = items.filter((item) => matchesQueueFilter(item, 'attention')).length
  const reviewCount = items.filter((item) => item.status === 'review').length
  const failedCount = items.filter((item) => item.status === 'failed').length
  const humanCount = items.filter((item) => item.status === 'awaiting_human').length
  const filterOptions: Array<{ value: QueueFilter; label: string; count: number }> = [
    { value: 'all', label: '全部', count: items.length },
    { value: 'attention', label: '需处理', count: attentionCount },
    { value: 'review', label: '待检查', count: reviewCount },
    { value: 'failed', label: '失败', count: failedCount },
    { value: 'awaiting_human', label: '需人工', count: humanCount }
  ]

  const jumpToItem = (direction: -1 | 1) => {
    if (visibleItems.length === 0) return

    const currentIndex = visibleItems.findIndex(({ item }) => item.id === cursorId)
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : visibleItems.length - 1
      : (currentIndex + direction + visibleItems.length) % visibleItems.length
    const nextItem = visibleItems[nextIndex].item
    setCursorId(nextItem.id)
    window.setTimeout(() => {
      itemRefs.current.get(nextItem.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 0)
  }

  return (
    <section className="space-y-2" aria-label="处理队列">
      <div className="sticky top-0 z-20 -mx-1 rounded-lg border border-slate-200 bg-slate-50/95 p-2 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">处理队列</h2>
            <div className="text-[11px] text-slate-500">
              显示 {visibleItems.length}/{items.length} · 待处理 {pendingCount}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => jumpToItem(-1)}
              disabled={visibleItems.length === 0}
              title="上一个筛选结果"
              aria-label="上一个筛选结果"
              className="size-8 rounded-md border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => jumpToItem(1)}
              disabled={visibleItems.length === 0}
              title="下一个筛选结果"
              aria-label="下一个筛选结果"
              className="size-8 rounded-md border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => setCompact((value) => !value)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
            >
              {compact ? '完整' : '精简'}
            </button>
          </div>
        </div>

        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setCursorId('')
          }}
          placeholder="搜索域名、网址或编号（如 #12）"
          className="mt-2 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />

        <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
          {filterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setFilter(option.value)
                setCursorId('')
              }}
              className={`shrink-0 rounded-full border px-2 py-1 text-[11px] transition-colors ${
                filter === option.value
                  ? 'border-blue-300 bg-blue-50 font-medium text-blue-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
              }`}
            >
              {option.label} {option.count}
            </button>
          ))}
        </div>
      </div>

      {visibleItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-8 text-center text-xs text-slate-500">
          没有符合当前搜索或筛选条件的网站
        </div>
      ) : visibleItems.map(({ item, originalIndex }) => {
        const displayHost = getDisplayHost(item.inputUrl)
        const selected = item.id === cursorId

        return (
          <div
            key={item.id}
            ref={(element) => {
              if (element) itemRefs.current.set(item.id, element)
              else itemRefs.current.delete(item.id)
            }}
            onClick={(event) => onItemCardClick(event, item)}
            title={item.tabId ? '点击卡片打开对应标签页' : undefined}
            className={`rounded-lg border bg-white p-3 transition-colors ${compact ? 'space-y-1.5' : 'space-y-2'} ${
              item.status === 'awaiting_human' ? 'border-amber-300' : 'border-slate-200'
            } ${selected ? 'ring-2 ring-blue-400 ring-offset-1' : ''} ${
              item.tabId ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/30' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 text-xs font-medium text-slate-500">#{originalIndex + 1}</div>
              <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] ${statusClass(item.status)}`}>
                {statusLabel(item.status)}
              </span>
            </div>

            {compact ? (
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900" title={item.inputUrl}>{displayHost}</div>
                <div className="truncate text-[11px] text-slate-400" title={item.inputUrl}>{item.inputUrl}</div>
              </div>
            ) : (
              <div className="break-all text-sm text-slate-900">{item.inputUrl}</div>
            )}

            {item.submitUrl && item.submitUrl !== item.inputUrl && (
              <div className={`${compact ? 'truncate' : 'break-all'} text-xs text-blue-600`} title={item.submitUrl}>
                提交页：{item.submitUrl}
              </div>
            )}
            <div className={`${compact ? 'truncate' : 'leading-relaxed'} text-xs text-slate-500`} title={item.message}>
              {item.message}
            </div>

            {(item.status === 'review' || item.status === 'failed') ? (
              <div className="flex gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => void batchRunner.retryItem(item.id, productProfile)}
                  className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
                >
                  重试当前页
                </button>
                {item.tabId && (
                  <button
                    type="button"
                    onClick={() => void batchRunner.activateTab(item.tabId)}
                    className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    打开标签页
                  </button>
                )}
              </div>
            ) : item.status === 'awaiting_human' && item.tabId ? (
              <div className="flex gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => void batchRunner.activateHumanTask(item.id)}
                  className="flex-1 rounded-md border border-amber-200 bg-white px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50"
                >
                  打开人工页面
                </button>
                <button
                  type="button"
                  onClick={() => void batchRunner.resumeHumanTask(item.id, productProfile)}
                  className="flex-1 rounded-md bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700"
                >
                  已处理，继续
                </button>
              </div>
            ) : item.tabId ? (
              <button
                type="button"
                onClick={() => void batchRunner.activateTab(item.tabId)}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                打开对应标签页
              </button>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}

const initialState = batchRunner.getState()

export const BatchSubmitPage = () => {
  const { productProfile } = useSettingsStore()
  const [state, setState] = useState<BatchRunnerState>(initialState)
  const [evaluations, setEvaluations] = useState<EvaluationSession[]>([])
  const [evaluationStatus, setEvaluationStatus] = useState('')
  const {
    urlText,
    items,
    running,
    runLogs,
    logStatus
  } = state

  useEffect(() => batchRunner.subscribe(setState), [])
  useEffect(() => {
    const refresh = () => {
      void readEvaluationSessions().then(setEvaluations)
    }
    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (Object.keys(changes).some(isEvaluationStorageKey)) refresh()
    }

    refresh()
    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [])

  const copyEvaluationPackage = async () => {
    const text = await exportEvaluationPackageText(runLogs)
    await navigator.clipboard.writeText(text)
    setEvaluationStatus(`已复制 ${evaluations.length} 次网页验收和 ${runLogs.length} 条运行记录`)
  }

  const handleItemCardClick = (event: React.MouseEvent<HTMLDivElement>, item: BatchItem) => {
    if (!item.tabId || window.getSelection()?.toString().trim()) return

    const target = event.target as HTMLElement
    if (target.closest('button, a, input, textarea, select, summary, details')) return

    if (item.status === 'awaiting_human') {
      void batchRunner.activateHumanTask(item.id)
      return
    }

    void batchRunner.activateTab(item.tabId)
  }

  const pendingCount = items.filter((item) => item.status === 'pending').length
  const humanCount = items.filter((item) => item.status === 'awaiting_human').length
  const reviewCount = items.filter((item) => item.status === 'review').length
  const failedCount = items.filter((item) => item.status === 'failed').length
  const reviewedEvaluationCount = evaluations.filter((session) => session.status !== 'pending').length
  const correctedFieldCount = evaluations.reduce(
    (total, session) => total + session.fields.filter((field) => Boolean(field.review)).length,
    0
  )
  return (
    <div className="h-full bg-slate-50 overflow-y-auto">
      <div className="p-4 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">批量提交</h1>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            粘贴一批网址，插件会自动打开页面、寻找提交入口、填写推广资料，然后停在网页上等你检查，不会替你点击最终提交。
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-700">网址列表</label>
          <textarea
            value={urlText}
            onChange={(event) => batchRunner.setUrlText(event.target.value)}
            placeholder={'https://saaschatbots.com/submit-listing/\nhttps://www.sheerid.com/\nhttps://ailib.ru/en/add-ai/free/#'}
            className="w-full min-h-36 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
          />
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="rounded-lg border border-slate-200 bg-white p-2">
            <div className="text-lg font-semibold text-slate-900">{items.length}</div>
            <div className="text-[11px] text-slate-500">总数</div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
            <div className="text-lg font-semibold text-amber-700">{humanCount}</div>
            <div className="text-[11px] text-amber-700">需人工</div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
            <div className="text-lg font-semibold text-emerald-700">{reviewCount}</div>
            <div className="text-[11px] text-emerald-700">待检查</div>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-2">
            <div className="text-lg font-semibold text-red-700">{failedCount}</div>
            <div className="text-[11px] text-red-700">失败</div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => batchRunner.prepareQueue()}
            disabled={running}
            className="flex-1 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            生成队列
          </button>
          {running ? (
            <button
              onClick={() => batchRunner.stop()}
              className="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-slate-800 text-white hover:bg-slate-900"
            >
              停止
            </button>
          ) : (
            <button
              onClick={() => batchRunner.start(productProfile)}
              className="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              {items.length > 0 ? '开始处理' : '生成并开始'}
            </button>
          )}
        </div>

        {items.length > 0 && (
          <BatchQueuePanel
            items={items}
            pendingCount={pendingCount}
            productProfile={productProfile}
            onItemCardClick={handleItemCardClick}
          />
        )}

        {running && (
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700">
            批量任务正在后台继续运行。需要人工的网站会单独停下，不会阻塞其他网站。
          </div>
        )}

        {humanCount > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
            <div>
              <div className="text-sm font-semibold text-amber-900">人工处理队列</div>
              <p className="mt-1 text-xs leading-relaxed text-amber-700">
                登录、验证码和授权标签已保留。你处理它们时，其他网站会继续自动运行；任意一个完成后都可以立即恢复。
              </p>
            </div>
            <button
              onClick={() => batchRunner.resumeAllHumanTasks(productProfile)}
              className="w-full px-3 py-2 text-xs font-medium rounded-lg border border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
            >
              重新检查全部人工页面
            </button>
          </div>
        )}

        <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">人工验收数据</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              网页左下角“验收”和字段旁按钮产生的记录会自动汇总到这里。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-blue-100 bg-white px-2 py-2">
              <div className="text-base font-semibold text-slate-900">{evaluations.length}</div>
              <div className="text-[10px] text-slate-500">填充页面</div>
            </div>
            <div className="rounded-md border border-emerald-100 bg-white px-2 py-2">
              <div className="text-base font-semibold text-emerald-700">{reviewedEvaluationCount}</div>
              <div className="text-[10px] text-slate-500">已人工确认</div>
            </div>
            <div className="rounded-md border border-amber-100 bg-white px-2 py-2">
              <div className="text-base font-semibold text-amber-700">{correctedFieldCount}</div>
              <div className="text-[10px] text-slate-500">纠正或遗漏</div>
            </div>
          </div>
          <button
            onClick={() => void copyEvaluationPackage()}
            disabled={evaluations.length === 0 && runLogs.length === 0}
            className="w-full px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            复制完整评测包
          </button>
          {evaluationStatus && (
            <div className="text-xs text-blue-700">{evaluationStatus}</div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">运行记录</h2>
              <p className="text-xs text-slate-500">仅保存在本机，最多保留最近 300 条。</p>
            </div>
            <span className="text-xs text-slate-500">{runLogs.length} 条</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => batchRunner.copyLogs()}
              className="flex-1 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
            >
              复制诊断日志
            </button>
            <button
              onClick={() => batchRunner.clearLogs()}
              className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            >
              清空
            </button>
          </div>
          {logStatus && (
            <div className="text-xs text-blue-600">{logStatus}</div>
          )}
        </div>

      </div>
    </div>
  )
}
