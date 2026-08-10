export type RunFeedbackValue = 'worked' | 'partial' | 'wrong-page' | 'wrong-fields' | 'failed'

export type RunFeedback = {
  value: RunFeedbackValue
  note?: string
  createdAt: string
}

export type RunLogEntry = {
  id: string
  mode: 'single' | 'batch'
  createdAt: string
  updatedAt: string
  productName?: string
  productWebsite?: string
  inputUrl: string
  currentUrl?: string
  submitUrl?: string
  tabId?: number
  status: string
  message: string
  filledCount?: number
  failedCount?: number
  diagnostics: string[]
  feedback?: RunFeedback
}

const RUN_LOGS_KEY = 'chat4o-run-logs'
const MAX_LOG_ENTRIES = 300

function canUseChromeStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome?.storage?.local)
}

async function getStoredLogs(): Promise<RunLogEntry[]> {
  if (!canUseChromeStorage()) {
    const raw = localStorage.getItem(RUN_LOGS_KEY)
    return raw ? JSON.parse(raw) : []
  }

  const data = await chrome.storage.local.get(RUN_LOGS_KEY)
  return Array.isArray(data[RUN_LOGS_KEY]) ? data[RUN_LOGS_KEY] : []
}

async function setStoredLogs(logs: RunLogEntry[]) {
  const limitedLogs = logs
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_LOG_ENTRIES)

  if (!canUseChromeStorage()) {
    localStorage.setItem(RUN_LOGS_KEY, JSON.stringify(limitedLogs))
    return
  }

  await chrome.storage.local.set({ [RUN_LOGS_KEY]: limitedLogs })
}

export async function readRunLogs() {
  try {
    return await getStoredLogs()
  } catch {
    return []
  }
}

export async function upsertRunLog(entry: RunLogEntry) {
  const logs = await readRunLogs()
  const nextLogs = [
    entry,
    ...logs.filter((log) => log.id !== entry.id)
  ]
  await setStoredLogs(nextLogs)
}

export async function updateRunLogFeedback(id: string, feedback: RunFeedback) {
  const logs = await readRunLogs()
  const nextLogs = logs.map((log) => (
    log.id === id
      ? {
          ...log,
          feedback,
          updatedAt: feedback.createdAt
        }
      : log
  ))
  await setStoredLogs(nextLogs)
}

export async function clearRunLogs() {
  await setStoredLogs([])
}

export async function exportRunLogsText() {
  const logs = await readRunLogs()
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    version: 1,
    logs
  }, null, 2)
}
