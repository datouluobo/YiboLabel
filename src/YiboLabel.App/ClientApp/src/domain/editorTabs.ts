import {
  createEditorTab as createWorkspaceTab,
  isTabDirty as computeTabDirty,
  normalizeEditorTab as restoreWorkspaceTab,
  type EditorTab,
  type WorkspaceSnapshot,
} from './workspace'
import { normalizeDocument } from './labelDocument'
import type { LabelDocument } from '../types'

export const recentClosedTabLimit = 8

export function serializeTabSnapshot(tab: Pick<EditorTab, 'document'>) {
  return JSON.stringify({
    document: normalizeDocument(tab.document),
  })
}

export function createEditorTab(
  document: LabelDocument,
  options?: {
    id?: string
    templateId?: string | null
    selectedElementIds?: string[]
  },
) {
  return createWorkspaceTab(document, serializeTabSnapshot, options)
}

export function normalizeEditorTab(tab: WorkspaceSnapshot['tabs'][number]) {
  return restoreWorkspaceTab(tab, serializeTabSnapshot)
}

export function isTabDirty(tab: Pick<EditorTab, 'document' | 'lastSavedSnapshot'>) {
  return computeTabDirty(tab, serializeTabSnapshot)
}
