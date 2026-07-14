import type { LabelDocument } from '../types'
import { createId, normalizeDocument } from './labelDocument'

export const historyLimit = 40
export const workspaceStorageKey = 'yibolabel.workspace.v6'

export type HistoryState = {
  past: LabelDocument[]
  future: LabelDocument[]
}

export type EditorTab = {
  id: string
  templateId: string | null
  document: LabelDocument
  templateDescription: string
  templateTags: string[]
  templateSource: string
  selectedElementIds: string[]
  history: HistoryState
  lastSavedSnapshot: string
}

export type ClosedTabSnapshot = {
  templateId: string | null
  document: LabelDocument
  templateDescription: string
  templateTags: string[]
  templateSource: string
  selectedElementIds: string[]
  lastSavedSnapshot: string
}

export type WorkspaceSnapshot = {
  version: 6
  activeTabId: string | null
  tabs: Array<{
    id: string
    templateId: string | null
    document: LabelDocument
    templateDescription: string
    templateTags: string[]
    templateSource: string
    selectedElementIds: string[]
    history: HistoryState
    lastSavedSnapshot: string
  }>
}

export function createEditorTab(
  document: LabelDocument,
  serializeTabSnapshot: (tab: Pick<EditorTab, 'document' | 'templateDescription' | 'templateTags' | 'templateSource'>) => string,
  options?: {
    id?: string
    templateId?: string | null
    selectedElementIds?: string[]
    templateDescription?: string
    templateTags?: string[]
    templateSource?: string
  },
): EditorTab {
  const normalized = normalizeDocument(document)
  return {
    id: options?.id ?? createId(),
    templateId: options?.templateId ?? null,
    document: normalized,
    templateDescription: options?.templateDescription ?? '',
    templateTags: options?.templateTags ?? [],
    templateSource: options?.templateSource ?? (options?.templateId ? 'manual' : 'blank'),
    selectedElementIds: options?.selectedElementIds ?? [normalized.elements[0]?.id].filter(Boolean) as string[],
    history: { past: [], future: [] },
    lastSavedSnapshot: serializeTabSnapshot({
      document: normalized,
      templateDescription: options?.templateDescription ?? '',
      templateTags: options?.templateTags ?? [],
      templateSource: options?.templateSource ?? (options?.templateId ? 'manual' : 'blank'),
    }),
  }
}

export function normalizeHistory(history: HistoryState | undefined) {
  return {
    past: (history?.past ?? []).map((document) => normalizeDocument(document)).slice(-historyLimit),
    future: (history?.future ?? []).map((document) => normalizeDocument(document)).slice(0, historyLimit),
  }
}

export function normalizeEditorTab(
  tab: WorkspaceSnapshot['tabs'][number],
  serializeTabSnapshot: (tab: Pick<EditorTab, 'document' | 'templateDescription' | 'templateTags' | 'templateSource'>) => string,
): EditorTab {
  const normalizedDocument = normalizeDocument(tab.document)
  const validSelection = (tab.selectedElementIds ?? []).filter((id) => normalizedDocument.elements.some((element) => element.id === id))
  return {
    id: tab.id || createId(),
    templateId: tab.templateId ?? null,
    document: normalizedDocument,
    templateDescription: tab.templateDescription ?? '',
    templateTags: tab.templateTags ?? [],
    templateSource: tab.templateSource ?? (tab.templateId ? 'manual' : 'blank'),
    selectedElementIds: validSelection,
    history: normalizeHistory(tab.history),
    lastSavedSnapshot:
      tab.lastSavedSnapshot ||
      serializeTabSnapshot({
        document: normalizedDocument,
        templateDescription: tab.templateDescription ?? '',
        templateTags: tab.templateTags ?? [],
        templateSource: tab.templateSource ?? (tab.templateId ? 'manual' : 'blank'),
      }),
  }
}

export function readWorkspaceSnapshot(): WorkspaceSnapshot | null {
  try {
    const raw = window.localStorage.getItem(workspaceStorageKey)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as WorkspaceSnapshot
    if (parsed?.version !== 6 || !Array.isArray(parsed.tabs)) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export function getTabDisplayName(tab: Pick<EditorTab, 'document'>) {
  return tab.document.name?.trim() || '未命名标签'
}

export function isTabDirty(
  tab: Pick<EditorTab, 'document' | 'templateDescription' | 'templateTags' | 'templateSource' | 'lastSavedSnapshot'>,
  serializeTabSnapshot: (tab: Pick<EditorTab, 'document' | 'templateDescription' | 'templateTags' | 'templateSource'>) => string,
) {
  return serializeTabSnapshot(tab) !== tab.lastSavedSnapshot
}
