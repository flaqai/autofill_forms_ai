export type EvaluationIssue =
  | 'wrong_value'
  | 'missed_field'
  | 'wrong_option'
  | 'length_limit'
  | 'should_be_empty'
  | 'unresolved'

export type EvaluationPageStatus =
  | 'pending'
  | 'accepted'
  | 'corrected'
  | 'not_submission_page'
  | 'authentication_required'
  | 'page_unavailable'

export type EvaluationFieldReview = {
  issue: EvaluationIssue
  correctedValue?: string
  note?: string
  reviewedAt: string
}

export type EvaluationFieldRecord = {
  fieldKey: string
  id: string
  name: string
  label: string
  context: string
  placeholder: string
  tagName: string
  type: string
  required: boolean
  options: Array<{ label: string; value: string }>
  originalValue: string
  autoFilledValue: string
  source?: string
  confidence?: number
  reason?: string
  fillOutcome: 'filled' | 'failed' | 'not_attempted'
  review?: EvaluationFieldReview
}

export type EvaluationSession = {
  id: string
  createdAt: string
  updatedAt: string
  reviewedAt?: string
  url: string
  title: string
  status: EvaluationPageStatus
  assumeUnmarkedFieldsCorrect: boolean
  filledCount: number
  attemptedCount: number
  failedKeys: string[]
  fields: EvaluationFieldRecord[]
}

export type CreateEvaluationSessionInput = Omit<
  EvaluationSession,
  'createdAt' | 'updatedAt' | 'status' | 'assumeUnmarkedFieldsCorrect'
>

const EVALUATION_STORAGE_PREFIX = 'chat4o-evaluation-session:'
const MAX_EVALUATION_SESSIONS = 300

function canUseChromeStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome?.storage?.local)
}

function storageKey(sessionId: string) {
  return `${EVALUATION_STORAGE_PREFIX}${sessionId}`
}

export function isEvaluationStorageKey(key: string) {
  return key.startsWith(EVALUATION_STORAGE_PREFIX)
}

export function createEvaluationSessionId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

async function readStorageRecord(key: string): Promise<EvaluationSession | undefined> {
  if (!canUseChromeStorage()) {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  }

  const result = await chrome.storage.local.get(key)
  return result[key] as EvaluationSession | undefined
}

async function writeStorageRecord(session: EvaluationSession) {
  const key = storageKey(session.id)
  if (!canUseChromeStorage()) {
    localStorage.setItem(key, JSON.stringify(session))
    return
  }

  await chrome.storage.local.set({ [key]: session })
}

async function trimStoredSessions() {
  const sessions = await readEvaluationSessions()
  const expired = sessions.slice(MAX_EVALUATION_SESSIONS)
  if (expired.length === 0) return

  const keys = expired.map((session) => storageKey(session.id))
  if (!canUseChromeStorage()) {
    keys.forEach((key) => localStorage.removeItem(key))
    return
  }

  await chrome.storage.local.remove(keys)
}

export async function createEvaluationSession(input: CreateEvaluationSessionInput) {
  const now = new Date().toISOString()
  const session: EvaluationSession = {
    ...input,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    assumeUnmarkedFieldsCorrect: false
  }

  await writeStorageRecord(session)
  void trimStoredSessions()
  return session
}

export async function readEvaluationSession(sessionId: string) {
  return readStorageRecord(storageKey(sessionId))
}

export async function readEvaluationSessions(): Promise<EvaluationSession[]> {
  try {
    if (!canUseChromeStorage()) {
      return Object.keys(localStorage)
        .filter(isEvaluationStorageKey)
        .map((key) => JSON.parse(localStorage.getItem(key) || 'null'))
        .filter(Boolean)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    }

    const result = await chrome.storage.local.get(null)
    return Object.entries(result)
      .filter(([key]) => isEvaluationStorageKey(key))
      .map(([, value]) => value as EvaluationSession)
      .filter((session) => Boolean(session?.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

export async function recordEvaluationFieldReview(
  sessionId: string,
  field: EvaluationFieldRecord,
  review: EvaluationFieldReview
) {
  const session = await readEvaluationSession(sessionId)
  if (!session) return false

  const existingIndex = session.fields.findIndex((candidate) => candidate.fieldKey === field.fieldKey)
  const reviewedField = {
    ...(existingIndex >= 0 ? session.fields[existingIndex] : field),
    ...field,
    review
  }

  if (existingIndex >= 0) {
    session.fields[existingIndex] = reviewedField
  } else {
    session.fields.push(reviewedField)
  }

  session.status = 'corrected'
  session.updatedAt = review.reviewedAt
  await writeStorageRecord(session)
  return true
}

export async function completeEvaluationSession(
  sessionId: string,
  status: Exclude<EvaluationPageStatus, 'pending'>,
  assumeUnmarkedFieldsCorrect = false
) {
  const session = await readEvaluationSession(sessionId)
  if (!session) return false

  const now = new Date().toISOString()
  const hasCorrections = session.fields.some((field) => Boolean(field.review))
  session.status = status === 'accepted' && hasCorrections ? 'corrected' : status
  session.assumeUnmarkedFieldsCorrect = assumeUnmarkedFieldsCorrect
  session.reviewedAt = now
  session.updatedAt = now
  await writeStorageRecord(session)
  return true
}

export async function clearEvaluationSessions() {
  const sessions = await readEvaluationSessions()
  const keys = sessions.map((session) => storageKey(session.id))
  if (keys.length === 0) return

  if (!canUseChromeStorage()) {
    keys.forEach((key) => localStorage.removeItem(key))
    return
  }

  await chrome.storage.local.remove(keys)
}

export async function exportEvaluationPackageText(runLogs: unknown[] = []) {
  const evaluations = await readEvaluationSessions()
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    version: 1,
    summary: {
      runCount: runLogs.length,
      evaluationCount: evaluations.length,
      reviewedPages: evaluations.filter((session) => session.status !== 'pending').length,
      correctedFields: evaluations.reduce(
        (total, session) => total + session.fields.filter((field) => Boolean(field.review)).length,
        0
      )
    },
    runLogs,
    evaluations
  }, null, 2)
}
