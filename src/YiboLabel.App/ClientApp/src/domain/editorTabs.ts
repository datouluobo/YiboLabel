import {
  createEditorTab as createWorkspaceTab,
  getTabKindLabel as resolveTabKindLabel,
  getTabStatusLabel as resolveTabStatusLabel,
  isTabDirty as computeTabDirty,
  normalizeEditorTab as restoreWorkspaceTab,
  type EditorTab,
  type EditorTabOrigin,
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
    origin?: EditorTabOrigin
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

export function getTabKindLabel(tab: Pick<EditorTab, 'origin' | 'templateId'>) {
  return resolveTabKindLabel(tab)
}

export function getTabStatusLabel(tab: Pick<EditorTab, 'document' | 'lastSavedSnapshot'>) {
  return resolveTabStatusLabel(tab, serializeTabSnapshot)
}
