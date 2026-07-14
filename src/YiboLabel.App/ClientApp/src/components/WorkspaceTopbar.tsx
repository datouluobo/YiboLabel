import { BookOpen, Printer, RefreshCw, RotateCcw, Save, Upload } from 'lucide-react'
import clsx from 'clsx'
import { sendWindowChromeCommand } from '../platform/windowChrome'
import type { EditorTab } from '../domain/workspace'
import type { AppStateResponse } from '../types'

type WorkspaceTopbarProps = {
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
  onPrintCurrent: () => void
}

export function WorkspaceTopbar({
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
  onPrintCurrent,
}: WorkspaceTopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-leading">
        <div
          className="title-block"
          onMouseDown={(event) => {
            if (event.button === 0) {
              sendWindowChromeCommand('drag')
            }
          }}
          onDoubleClick={() => sendWindowChromeCommand('toggle-maximize')}
        >
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
                  {activeTemplateId ? '模板草稿' : '未绑定草稿'}
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
      <div className="topbar-actions command-bar">
        <button className={clsx('ghost-button compact-button', activeSurface === 'templates' && 'active')} onClick={() => onToggleSurface('templates')}>
          模板库
        </button>
        <button className={clsx('ghost-button compact-button', activeSurface === 'lexicons' && 'active')} onClick={() => onToggleSurface('lexicons')}>
          <BookOpen size={14} />
          词库
        </button>
        <button className={clsx('ghost-button compact-button', showDocumentDialog && 'active')} onClick={onShowDocumentDialog} disabled={!hasActiveTab}>
          文档与打印
        </button>
        <button className="ghost-button" onClick={onUndo} disabled={!hasActiveTab || history.past.length === 0}>
          撤销
        </button>
        <button className="ghost-button" onClick={onRedo} disabled={!hasActiveTab || history.future.length === 0}>
          重做
        </button>
        <button className="ghost-button" onClick={onImportDdl}>
          <Upload size={16} />
          导入 DDL
        </button>
        <button className="ghost-button compact-button" onClick={onReopenLastClosedTab} disabled={recentClosedTabsCount === 0}>
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
        <button className="action-button" onClick={onSaveCurrentTemplate} disabled={!hasActiveTab || saving}>
          <Save size={16} />
          {saving ? '保存中...' : activeTemplateId ? '保存' : '保存为模板'}
        </button>
        <button className="ghost-button" onClick={onSaveAsTemplate} disabled={!hasActiveTab || saving}>
          <Save size={16} />
          另存为
        </button>
        <button className="print-button" onClick={onPrintCurrent} disabled={!hasActiveTab || printing || !currentPrinter?.isAvailable} title={currentPrinter?.isAvailable ? undefined : currentPrinter?.statusMessage ?? '没有可用打印机'}>
          <Printer size={16} />
          {printing ? '打印中...' : '立即打印'}
        </button>
      </div>
      <div className="window-controls" aria-label="窗口控制">
        <button className="window-control-button" type="button" onClick={() => sendWindowChromeCommand('minimize')} aria-label="最小化">
          —
        </button>
        <button className="window-control-button" type="button" onClick={() => sendWindowChromeCommand('toggle-maximize')} aria-label="最大化或还原">
          □
        </button>
        <button className="window-control-button close" type="button" onClick={() => sendWindowChromeCommand('close')} aria-label="关闭">
          ×
        </button>
      </div>
    </header>
  )
}
