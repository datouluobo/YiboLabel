import { useEffect } from 'react'
import type { LabelElement } from '../types'

type KeyboardShortcutOptions = {
  activeTabId: string | null
  visibleElements: LabelElement[]
  undo: () => void
  redo: () => void
  setActiveSelection: (ids: string[]) => void
  duplicateSelectedElements: () => void
  saveCurrentTemplate: () => Promise<void>
  closeTab: (id: string) => void
  reorderSelected: (action: 'front' | 'back' | 'forward' | 'backward') => void
  reopenLastClosedTab: () => void
  deleteSelectedElements: () => void
  nudgeSelection: (deltaX: number, deltaY: number) => void
}

export function useKeyboardShortcuts({
  activeTabId,
  visibleElements,
  undo,
  redo,
  setActiveSelection,
  duplicateSelectedElements,
  saveCurrentTemplate,
  closeTab,
  reorderSelected,
  reopenLastClosedTab,
  deleteSelectedElements,
  nudgeSelection,
}: KeyboardShortcutOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextInputTarget(event.target)) {
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setActiveSelection(visibleElements.map((element) => element.id))
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelectedElements()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveCurrentTemplate()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        if (activeTabId) {
          closeTab(activeTabId)
        }
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key === ']') {
        event.preventDefault()
        reorderSelected(event.shiftKey ? 'front' : 'forward')
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key === '[') {
        event.preventDefault()
        reorderSelected(event.shiftKey ? 'back' : 'backward')
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        reopenLastClosedTab()
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelectedElements()
        return
      }

      const step = event.shiftKey ? 5 : 0.5
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        nudgeSelection(-step, 0)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        nudgeSelection(step, 0)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        nudgeSelection(0, -step)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        nudgeSelection(0, step)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activeTabId,
    closeTab,
    deleteSelectedElements,
    duplicateSelectedElements,
    nudgeSelection,
    redo,
    reopenLastClosedTab,
    reorderSelected,
    saveCurrentTemplate,
    setActiveSelection,
    undo,
    visibleElements,
  ])
}

function isTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target.closest('input, textarea, select, [contenteditable="true"]') !== null
}
