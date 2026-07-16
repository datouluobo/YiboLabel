import { BookOpen, Download, Printer, RefreshCw, RotateCcw, Save, Upload } from 'lucide-react'
import clsx from 'clsx'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { sendWindowChromeCommand } from '../platform/windowChrome'
import { getTabKindLabel } from '../domain/editorTabs'
import type { EditorTab } from '../domain/workspace'
import type { AppStateResponse } from '../types'

type WorkspaceTopbarProps = {
  windowIsMaximized: boolean
  activeSurface: 'editor' | 'templates' | 'lexicons'
  showDocumentDialog: boolean
  hasActiveTab: boolean
  status: string
  history: EditorTab['history']
  recentClosedTabsCount: number
  appState: AppStateResponse | null
  activeDocumentName: string
  activeTabDirty: boolean
  printerDevicePath: string
  currentPrinter: AppStateResponse['printers'][number] | null
  refreshingPrinters: boolean
  saving: boolean
  printing: boolean
  exporting: boolean
  activeTabOrigin: EditorTab['origin'] | null
  activeTemplateId: string | null
  onToggleSurface: (surface: 'templates' | 'lexicons') => void
  onShowDocumentDialog: () => void
  onUndo: () => void
  onRedo: () => void
  onImportDdl: () => void
  onReopenLastClosedTab: () => void
  onPrinterChange: (devicePath: string) => void
  onRefreshPrinters: () => void
  onSaveCurrentTemplate: () => void
  onSaveAsTemplate: () => void
  onShowExportDialog: () => void
  onPrintCurrent: () => void
  onRequestAppClose: () => void
}

export function WorkspaceTopbar({
  windowIsMaximized,
  activeSurface,
  showDocumentDialog,
  hasActiveTab,
  status,
  history,
  recentClosedTabsCount,
  appState,
  activeDocumentName,
  activeTabDirty,
  printerDevicePath,
  currentPrinter,
  refreshingPrinters,
  saving,
  printing,
  exporting,
  activeTabOrigin,
  activeTemplateId,
  onToggleSurface,
  onShowDocumentDialog,
  onUndo,
  onRedo,
  onImportDdl,
  onReopenLastClosedTab,
  onPrinterChange,
  onRefreshPrinters,
  onSaveCurrentTemplate,
  onSaveAsTemplate,
  onShowExportDialog,
  onPrintCurrent,
  onRequestAppClose,
}: WorkspaceTopbarProps) {
  const sendWindowDrag = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    sendWindowChromeCommand('drag', {
      screenX: event.screenX,
      screenY: event.screenY,
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
      sendWindowDrag(event)
    }

    if (event.button === 2) {
      sendSystemMenu(event)
    }
  }

  const handleTopbarDragStart = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
  }

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
            <div className="title-stack">
              <div className="title-heading">
                <h1>YiboLabel</h1>
                {appState?.appVersion ? <span className="workspace-version">v{appState.appVersion}</span> : null}
              </div>
              <p className="status" title={status}>{status}</p>
              {hasActiveTab ? (
                <div className="workspace-badges">
                  <span className={clsx('workspace-badge', activeTemplateId ? 'template' : 'draft')}>
                    {activeTabOrigin ? getTabKindLabel({ origin: activeTabOrigin, templateId: activeTemplateId }) : '未绑定草稿'}
                  </span>
                  <span className={clsx('workspace-badge', activeTabDirty ? 'dirty' : 'saved')}>
                    {activeTabDirty ? '未保存修改' : '已保存'}
                  </span>
                  <span className="workspace-document-name" title={activeDocumentName}>
                    {activeDocumentName}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div
          className="topbar-drag-region"
        />
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
        <button className={clsx('ghost-button compact-button topbar-action-secondary', activeSurface === 'templates' && 'active')} onClick={() => onToggleSurface('templates')}>
          模板库
        </button>
        <button className={clsx('ghost-button compact-button topbar-action-secondary', activeSurface === 'lexicons' && 'active')} onClick={() => onToggleSurface('lexicons')}>
          <BookOpen size={14} />
          词库
        </button>
        <button className={clsx('ghost-button compact-button topbar-action-secondary', showDocumentDialog && 'active')} onClick={onShowDocumentDialog} disabled={!hasActiveTab}>
          文档与打印
        </button>
        <button className="ghost-button topbar-action-secondary" onClick={onUndo} disabled={!hasActiveTab || history.past.length === 0}>
          撤销
        </button>
        <button className="ghost-button topbar-action-secondary" onClick={onRedo} disabled={!hasActiveTab || history.future.length === 0}>
          重做
        </button>
        <button className="ghost-button topbar-action-secondary" onClick={onImportDdl}>
          <Upload size={16} />
          导入为草稿
        </button>
        <button className="ghost-button compact-button topbar-action-secondary" onClick={onReopenLastClosedTab} disabled={recentClosedTabsCount === 0}>
          <RotateCcw size={14} />
          恢复关闭
        </button>
        <div className={clsx('topbar-printer', currentPrinter?.isAvailable ? 'online' : 'offline')}>
          <span className="printer-status-dot" aria-hidden="true" />
          <label>
            <span>打印机</span>
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
        <button className="action-button topbar-action-primary" onClick={onSaveCurrentTemplate} disabled={!hasActiveTab || saving}>
          <Save size={16} />
          {saving ? '保存中...' : '保存'}
        </button>
        <button className="ghost-button topbar-action-primary" onClick={onSaveAsTemplate} disabled={!hasActiveTab || saving}>
          <Save size={16} />
          另存为模板
        </button>
        <button className="ghost-button topbar-action-primary" onClick={onShowExportDialog} disabled={!hasActiveTab || exporting}>
          <Download size={16} />
          {exporting ? '导出中...' : '导出'}
        </button>
        <button className="print-button topbar-action-primary" onClick={onPrintCurrent} disabled={!hasActiveTab || printing || !currentPrinter?.isAvailable} title={currentPrinter?.isAvailable ? undefined : currentPrinter?.statusMessage ?? '没有可用打印机'}>
          <Printer size={16} />
          {printing ? '打印中...' : '立即打印'}
        </button>
      </div>
    </header>
  )
}
