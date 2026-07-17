import { BookOpen, Download, Eye, FilePlus2, Printer, RefreshCw, RotateCcw, Save, Upload } from 'lucide-react'
import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
import { sendWindowChromeCommand } from '../platform/windowChrome'
import { getTabDisplayName, getTabKindLabel, type EditorTab } from '../domain/workspace'
import type { AppStateResponse } from '../types'

type WorkspaceTopbarProps = {
  windowIsMaximized: boolean
  activeSurface: 'editor' | 'templates' | 'lexicons'
  showDocumentDialog: boolean
  hasActiveTab: boolean
  tabs: EditorTab[]
  activeTabId: string | null
  isTabDirty: (tab: EditorTab) => boolean
  recentClosedTabsCount: number
  bindableSelectedCount: number
  contentPickerOpen: boolean
  groupBinderOpen: boolean
  appState: AppStateResponse | null
  activeTabDirty: boolean
  printerDevicePath: string
  currentPrinter: AppStateResponse['printers'][number] | null
  refreshingPrinters: boolean
  saving: boolean
  printing: boolean
  exporting: boolean
  onShowEditor: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onCreateFreshDocument: () => void
  onToggleSurface: (surface: 'templates' | 'lexicons') => void
  onShowDocumentDialog: () => void
  onToggleGroupBinder: () => void
  onToggleContentPicker: () => void
  onImportDdl: () => void
  onReopenLastClosedTab: () => void
  onPrinterChange: (devicePath: string) => void
  onRefreshPrinters: () => void
  onSaveCurrentTemplate: () => void
  onSaveAsTemplate: () => void
  onShowExportDialog: () => void
  onShowPrintPreview: () => void
  onPrintCurrent: () => void
  onRequestAppClose: () => void
}

export function WorkspaceTopbar({
  windowIsMaximized,
  activeSurface,
  showDocumentDialog,
  hasActiveTab,
  tabs,
  activeTabId,
  isTabDirty,
  recentClosedTabsCount,
  bindableSelectedCount,
  contentPickerOpen,
  groupBinderOpen,
  appState,
  activeTabDirty,
  printerDevicePath,
  currentPrinter,
  refreshingPrinters,
  saving,
  printing,
  exporting,
  onShowEditor,
  onCloseTab,
  onCreateFreshDocument,
  onToggleSurface,
  onShowDocumentDialog,
  onToggleGroupBinder,
  onToggleContentPicker,
  onImportDdl,
  onReopenLastClosedTab,
  onPrinterChange,
  onRefreshPrinters,
  onSaveCurrentTemplate,
  onSaveAsTemplate,
  onShowExportDialog,
  onShowPrintPreview,
  onPrintCurrent,
  onRequestAppClose,
}: WorkspaceTopbarProps) {
  const pendingDragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => pendingDragCleanupRef.current?.(), [])

  const sendWindowDrag = (screenX: number, screenY: number) => {
    sendWindowChromeCommand('drag', {
      screenX,
      screenY,
    })
  }

  const sendSystemMenu = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    sendWindowChromeCommand('system-menu', {
      screenX: event.screenX,
      screenY: event.screenY,
    })
  }

  const handleDragRegionMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button === 0) {
      event.preventDefault()
      pendingDragCleanupRef.current?.()

      const startX = event.screenX
      const startY = event.screenY
      const dragThreshold = 4

      const cleanup = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', cleanup)
        pendingDragCleanupRef.current = null
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = Math.abs(moveEvent.screenX - startX)
        const deltaY = Math.abs(moveEvent.screenY - startY)
        if (deltaX < dragThreshold && deltaY < dragThreshold) {
          return
        }

        cleanup()
        sendWindowDrag(moveEvent.screenX, moveEvent.screenY)
      }

      pendingDragCleanupRef.current = cleanup
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', cleanup)
    }
  }

  const handleTopbarDragStart = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault()
  }

  const activePrinterName = currentPrinter?.displayName ?? appState?.printers[0]?.displayName ?? '未发现打印机'
  const printerStatusLabel = currentPrinter?.isAvailable ? '在线' : '离线'

  return (
    <header className={clsx('topbar', windowIsMaximized ? 'window-maximized' : 'window-normal')} onDragStart={handleTopbarDragStart}>
      <div
        className="topbar-head topbar-drag-surface"
        onMouseDown={handleDragRegionMouseDown}
        onContextMenu={sendSystemMenu}
        onDoubleClick={() => sendWindowChromeCommand('toggle-maximize')}
      >
        <div
          className="topbar-leading"
        >
          <div className="title-block">
            <span className="product-mark">YiboLabel</span>
            <h1>YiboLabel</h1>
            {appState?.appVersion ? <span className="workspace-version">v{appState.appVersion}</span> : null}
          </div>
        </div>
        <div className="title-tab-strip" aria-label="打开的标签页">
          {tabs.map((tab) => {
            const tabDirty = isTabDirty(tab)
            const tabName = getTabDisplayName(tab)
            const tabTitle = `${tabName} · ${getTabKindLabel(tab)}`
            return (
              <div key={tab.id} className={clsx('title-tab', activeSurface === 'editor' && activeTabId === tab.id && 'active', tabDirty && 'dirty')}>
                <button
                  className="title-tab-trigger"
                  type="button"
                  title={tabTitle}
                  onMouseDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.stopPropagation()}
                  onClick={() => onShowEditor(tab.id)}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      onCloseTab(tab.id)
                    }
                  }}
                >
                  <span className="title-tab-state" aria-label={tabDirty ? '有未保存修改' : '已保存'} />
                  <span>{tabName}</span>
                </button>
                <button
                  className="title-tab-close"
                  type="button"
                  aria-label={`关闭 ${tabName}`}
                  onMouseDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.stopPropagation()}
                  onClick={() => onCloseTab(tab.id)}
                >
                  ×
                </button>
              </div>
            )
          })}
          <button
            className="title-tab-new"
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
            onClick={onCreateFreshDocument}
            title="新建标签"
            aria-label="新建标签"
          >
            <FilePlus2 size={14} />
          </button>
        </div>
        <div
          className="window-controls"
          aria-label="窗口控制"
          onMouseDownCapture={(event) => event.stopPropagation()}
          onDoubleClickCapture={(event) => event.stopPropagation()}
          onContextMenuCapture={(event) => event.stopPropagation()}
        >
          <button className="window-control-button" type="button" onClick={() => sendWindowChromeCommand('minimize')} aria-label="最小化">
            <span className="window-control-glyph minimize" aria-hidden="true" />
          </button>
          <button
            className="window-control-button"
            type="button"
            onClick={() => sendWindowChromeCommand('toggle-maximize')}
            aria-label={windowIsMaximized ? '还原' : '最大化'}
            title={windowIsMaximized ? '还原' : '最大化'}
          >
            <span className={clsx('window-control-glyph', windowIsMaximized ? 'restore' : 'maximize')} aria-hidden="true" />
          </button>
          <button className="window-control-button close" type="button" onClick={onRequestAppClose} aria-label="关闭">
            <span className="window-control-glyph close" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="topbar-actions command-bar" aria-label="工作区操作">
        <div className="toolbar-group toolbar-navigation">
          <button className={clsx('special-tool-button compact-button topbar-action-secondary', activeSurface === 'templates' && 'active')} onClick={() => onToggleSurface('templates')}>
            模板
          </button>
          <button className={clsx('special-tool-button compact-button topbar-action-secondary', activeSurface === 'lexicons' && 'active')} onClick={() => onToggleSurface('lexicons')}>
            <BookOpen size={14} />
            词库
          </button>
        </div>
        <div className="toolbar-group toolbar-history">
          <button className={clsx('special-tool-button topbar-action-secondary', groupBinderOpen && 'active')} onClick={onToggleGroupBinder} disabled={bindableSelectedCount === 0}>
            绑定
          </button>
          <button className={clsx('special-tool-button topbar-action-secondary', contentPickerOpen && 'active')} onClick={onToggleContentPicker} disabled={bindableSelectedCount !== 1}>
            候选
          </button>
        </div>
        <div className="toolbar-group toolbar-output">
          <button className={clsx('ghost-button topbar-action-primary save-button', activeTabDirty && 'dirty')} onClick={onSaveCurrentTemplate} disabled={!hasActiveTab || saving}>
            <Save size={16} />
            {saving ? '保存中...' : '保存'}
          </button>
          <button className="ghost-button topbar-action-primary" onClick={onSaveAsTemplate} disabled={!hasActiveTab || saving}>
            <Save size={16} />
            另存
          </button>
          <button className="ghost-button topbar-action-primary" onClick={onShowExportDialog} disabled={!hasActiveTab || exporting}>
            <Download size={16} />
            {exporting ? '导出中...' : '导出'}
          </button>
        </div>
        <div className="toolbar-group toolbar-entry">
          <button className="ghost-button topbar-action-secondary low-priority-button" onClick={onImportDdl} title="导入为草稿">
            <Upload size={16} />
            <span className="button-label">导入</span>
          </button>
          <button className="ghost-button compact-button topbar-action-secondary low-priority-button" onClick={onReopenLastClosedTab} disabled={recentClosedTabsCount === 0} title="恢复关闭标签">
            <RotateCcw size={14} />
            <span className="button-label">恢复</span>
          </button>
        </div>
        <div className="toolbar-spacer" aria-hidden="true" />
        <div className="toolbar-group toolbar-print">
          <div className={clsx('topbar-printer', currentPrinter?.isAvailable ? 'online' : 'offline')} title={currentPrinter?.statusMessage ?? `${printerStatusLabel} · ${activePrinterName}`}>
            <span className="printer-status-dot" aria-hidden="true" />
            <label>
              <span className="visually-hidden">打印机</span>
              <select
                aria-label="选择打印机"
                value={printerDevicePath}
                onChange={(event) => onPrinterChange(event.target.value)}
                disabled={!hasActiveTab || !appState?.printers.length}
              >
                {appState?.printers.length ? (
                  appState.printers.map((printer) => (
                    <option key={printer.id} value={printer.devicePath}>
                      {printer.isAvailable ? '在线' : '离线'} · {printer.displayName}
                    </option>
                  ))
                ) : (
                  <option value="">未发现打印机</option>
                )}
              </select>
            </label>
            <button className="inline-icon-button" type="button" onClick={onRefreshPrinters} disabled={refreshingPrinters} title={currentPrinter?.statusMessage ?? '刷新打印机状态'} aria-label="刷新打印机状态">
              <RefreshCw size={14} className={refreshingPrinters ? 'is-spinning' : undefined} />
            </button>
          </div>
          <button className={clsx('ghost-button compact-button topbar-action-primary layout-button', showDocumentDialog && 'active')} onClick={onShowDocumentDialog} disabled={!hasActiveTab}>
            页面布局
          </button>
          <button className="ghost-button topbar-action-primary preview-button" onClick={onShowPrintPreview} disabled={!hasActiveTab} title="预览页面将在后续版本开放">
            <Eye size={16} />
            预览
          </button>
          <button className="print-button topbar-action-primary" onClick={onPrintCurrent} disabled={!hasActiveTab || printing || !currentPrinter?.isAvailable} title={currentPrinter?.isAvailable ? undefined : currentPrinter?.statusMessage ?? '没有可用打印机'}>
            <Printer size={16} />
            {printing ? '打印中...' : '立即打印'}
          </button>
        </div>
      </div>
    </header>
  )
}
