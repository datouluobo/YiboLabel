import type { LabelDocument } from '../types'
import { createId, normalizeDocument } from './labelDocument'

export const historyLimit = 40
export const workspaceStorageKey = 'yibolabel.workspace.v8'
export type SidebarTab = 'elements' | 'lexicon' | 'templates'

export type HistoryState = {
  past: LabelDocument[]
  future: LabelDocument[]
}

export type EditorTab = {
  id: string
  templateId: string | null
  origin: EditorTabOrigin
  document: LabelDocument
  selectedElementIds: string[]
  history: HistoryState
  lastSavedSnapshot: string
}

export type EditorTabOrigin = 'blank' | 'imported' | 'template' | 'detached'

export type ClosedTabSnapshot = {
  templateId: string | null
  origin: EditorTabOrigin
  document: LabelDocument
  selectedElementIds: string[]
  lastSavedSnapshot: string
}

export type WorkspaceSnapshot = {
  version: 11
  activeTabId: string | null
  ui?: {
    activeSurface: 'editor' | 'templates' | 'lexicons' | 'print-check'
    lastEditorTabId: string | null
    activeEditorPanel: 'inspector' | 'document-spec' | 'print-calibration'
    sidebarTab?: SidebarTab
    previewTemplateId?: string | null
  }
  tabs: Array<{
    id: string
    templateId: string | null
    origin?: EditorTabOrigin
    document: LabelDocument
    selectedElementIds: string[]
    history: HistoryState
    lastSavedSnapshot: string
  }>
}

export function createEditorTab(
  document: LabelDocument,
  serializeTabSnapshot: (tab: Pick<EditorTab, 'document'>) => string,
  options?: {
    id?: string
    templateId?: string | null
    origin?: EditorTabOrigin
    selectedElementIds?: string[]
  },
): EditorTab {
  const normalized = normalizeDocument(document)
  return {
    id: options?.id ?? createId(),
    templateId: options?.templateId ?? null,
    origin: options?.origin ?? inferTabOrigin(options?.templateId ?? null),
    document: normalized,
    selectedElementIds: options?.selectedElementIds ?? [normalized.elements[0]?.id].filter(Boolean) as string[],
    history: { past: [], future: [] },
    lastSavedSnapshot: serializeTabSnapshot({
      document: normalized,
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
  serializeTabSnapshot: (tab: Pick<EditorTab, 'document'>) => string,
): EditorTab {
  const normalizedDocument = normalizeDocument(tab.document)
  const validSelection = (tab.selectedElementIds ?? []).filter((id) => normalizedDocument.elements.some((element) => element.id === id))
  return {
    id: tab.id || createId(),
    templateId: tab.templateId ?? null,
    origin: tab.origin ?? inferTabOrigin(tab.templateId ?? null),
    document: normalizedDocument,
    selectedElementIds: validSelection,
    history: normalizeHistory(tab.history),
    lastSavedSnapshot:
      tab.lastSavedSnapshot ||
      serializeTabSnapshot({
        document: normalizedDocument,
      }),
  }
}

export function readWorkspaceSnapshot(): WorkspaceSnapshot | null {
  try {
    const raw = window.localStorage.getItem(workspaceStorageKey)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as
      | WorkspaceSnapshot
      | (Omit<WorkspaceSnapshot, 'version'> & { version: 10 })
      | (Omit<WorkspaceSnapshot, 'version'> & { version: 9; ui?: { activeSurface: 'editor' | 'templates' | 'lexicons'; lastEditorTabId: string | null; showDocumentDialog: boolean } })
      | (Omit<WorkspaceSnapshot, 'version'> & { version: 8 })
      | (Omit<WorkspaceSnapshot, 'version'> & { version: 7 })
    if (!parsed || !Array.isArray(parsed.tabs)) {
      return null
    }

    if (parsed.version === 11) {
      return {
        ...parsed,
        tabs: parsed.tabs.map((tab) => ({
          ...tab,
          origin: tab.origin ?? inferTabOrigin(tab.templateId ?? null),
        })),
      }
    }

    if (parsed.version === 10) {
      return {
        version: 11,
        activeTabId: parsed.activeTabId ?? null,
        tabs: parsed.tabs.map((tab) => ({
          ...tab,
          origin: tab.origin ?? inferTabOrigin(tab.templateId ?? null),
        })),
        ui: {
          activeSurface: parsed.ui?.activeSurface ?? 'editor',
          lastEditorTabId: parsed.ui?.lastEditorTabId ?? parsed.activeTabId ?? null,
          activeEditorPanel: parsed.ui?.activeEditorPanel ?? 'inspector',
          sidebarTab: parsed.ui?.activeSurface === 'templates' ? 'templates' : 'elements',
          previewTemplateId: null,
        },
      }
    }

    if (parsed.version === 9) {
      return {
        version: 11,
        activeTabId: parsed.activeTabId ?? null,
        tabs: parsed.tabs.map((tab) => ({
          ...tab,
          origin: tab.origin ?? inferTabOrigin(tab.templateId ?? null),
        })),
        ui: {
          activeSurface: parsed.ui?.activeSurface ?? 'editor',
          lastEditorTabId: parsed.ui?.lastEditorTabId ?? parsed.activeTabId ?? null,
          activeEditorPanel: parsed.ui?.showDocumentDialog ? 'document-spec' : 'inspector',
          sidebarTab: parsed.ui?.activeSurface === 'templates' ? 'templates' : 'elements',
          previewTemplateId: null,
        },
      }
    }

    if (parsed.version === 8) {
      const legacyUi = parsed.ui as { activeSurface?: 'editor' | 'templates' | 'lexicons'; lastEditorTabId?: string | null; showDocumentDialog?: boolean } | undefined
      return {
        version: 11,
        activeTabId: parsed.activeTabId ?? null,
        tabs: parsed.tabs.map((tab) => ({
          ...tab,
          origin: tab.origin ?? inferTabOrigin(tab.templateId ?? null),
        })),
        ui: {
          activeSurface: legacyUi?.activeSurface ?? 'editor',
          lastEditorTabId: legacyUi?.lastEditorTabId ?? parsed.activeTabId ?? null,
          activeEditorPanel: legacyUi?.showDocumentDialog ? 'document-spec' : 'inspector',
          sidebarTab: legacyUi?.activeSurface === 'templates' ? 'templates' : 'elements',
          previewTemplateId: null,
        },
      }
    }

    if (parsed.version === 7) {
      return {
        version: 11,
        activeTabId: parsed.activeTabId ?? null,
        tabs: parsed.tabs.map((tab) => ({
          ...tab,
          origin: inferTabOrigin(tab.templateId ?? null),
        })),
        ui: {
          activeSurface: 'editor',
          lastEditorTabId: parsed.activeTabId ?? null,
          activeEditorPanel: 'inspector',
          sidebarTab: 'elements',
          previewTemplateId: null,
        },
      }
    }

    return null
  } catch {
    return null
  }
}

export function getTabDisplayName(tab: Pick<EditorTab, 'document'>) {
  return tab.document.name?.trim() || '未命名标签'
}

export function getTabKindLabel(tab: Pick<EditorTab, 'origin' | 'templateId'>) {
  if (tab.origin === 'blank') {
    return '空白草稿'
  }
  if (tab.origin === 'imported') {
    return '导入草稿'
  }
  if (tab.origin === 'detached') {
    return '已解绑草稿'
  }
  return tab.templateId ? '模板草稿' : '未绑定草稿'
}

export function getTabStatusLabel(
  tab: Pick<EditorTab, 'document' | 'lastSavedSnapshot'>,
  serializeTabSnapshot: (tab: Pick<EditorTab, 'document'>) => string,
) {
  return isTabDirty(tab, serializeTabSnapshot) ? '未保存修改' : '已保存'
}

export function isTabDirty(
  tab: Pick<EditorTab, 'document' | 'lastSavedSnapshot'>,
  serializeTabSnapshot: (tab: Pick<EditorTab, 'document'>) => string,
) {
  return serializeTabSnapshot(tab) !== tab.lastSavedSnapshot
}

function inferTabOrigin(templateId: string | null): EditorTabOrigin {
  return templateId ? 'template' : 'blank'
}
