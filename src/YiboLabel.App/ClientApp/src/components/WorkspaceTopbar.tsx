import { Archive, Check, ChevronDown, Download, FilePlus2, FolderOpen, Info, Printer, RefreshCw, RotateCcw, Save, SearchCheck, Upload } from 'lucide-react'
import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
import { sendWindowChromeCommand } from '../platform/windowChrome'
import { getTabDisplayName, getTabKindLabel, type EditorTab } from '../domain/workspace'
import type { EditorPanelMode, WorkspaceSurface } from '../domain/printWorkflow'
import type { AppStateResponse } from '../types'

type WorkspaceTopbarProps = {
  windowIsMaximized: boolean
  activeSurface: WorkspaceSurface
  activeEditorPanel: EditorPanelMode
  hasActiveTab: boolean
  tabs: EditorTab[]
  activeTabId: string | null
  isTabDirty: (tab: EditorTab) => boolean
  recentClosedTabsCount: number
  appState: AppStateResponse | null
  activeTabDirty: boolean
  copies: number
  printerDevicePath: string
  currentPrinter: AppStateResponse['printers'][number] | null
  calibrationLabel: string
  quickPrintAllowed: boolean
  refreshingPrinters: boolean
  saving: boolean
  printing: boolean
  exporting: boolean
  dataManaging: boolean
  aboutOpen: boolean
  onShowEditor: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onCreateFreshDocument: () => void
  onOpenDocumentSpec: () => void
  onOpenPrintCalibration: () => void
  onImportDdl: () => void
  onReopenLastClosedTab: () => void
  onPrinterChange: (devicePath: string) => void
  onRefreshPrinters: () => void
  onCopiesChange: (copies: number) => void
  onDecreaseCopies: () => void
  onIncreaseCopies: () => void
  onSaveCurrentTemplate: () => void
  onSaveAsTemplate: () => void
  onShowExportDialog: () => void
  onBackupAllData: () => void
  onRestoreDataBackup: () => void
  onOpenDataDirectory: () => void
  onOpenAbout: () => void
  onOpenPrintCheck: () => void
  onPrintCurrent: () => void
  onRequestAppClose: () => void
}

export function WorkspaceTopbar({
  windowIsMaximized,
  activeSurface,
  activeEditorPanel,
  hasActiveTab,
  tabs,
  activeTabId,
  isTabDirty,
  recentClosedTabsCount,
  appState,
  activeTabDirty,
  copies,
  printerDevicePath,
  currentPrinter,
  calibrationLabel,
  quickPrintAllowed,
  refreshingPrinters,
  saving,
  printing,
  exporting,
  dataManaging,
  aboutOpen,
  onShowEditor,
  onCloseTab,
  onCreateFreshDocument,
  onOpenDocumentSpec,
  onOpenPrintCalibration,
  onImportDdl,
  onReopenLastClosedTab,
  onPrinterChange,
  onRefreshPrinters,
  onCopiesChange,
  onDecreaseCopies,
  onIncreaseCopies,
  onSaveCurrentTemplate,
  onSaveAsTemplate,
  onShowExportDialog,
  onBackupAllData,
  onRestoreDataBackup,
  onOpenDataDirectory,
  onOpenAbout,
  onOpenPrintCheck,
  onPrintCurrent,
  onRequestAppClose,
}: WorkspaceTopbarProps) {
  const pendingDragCleanupRef = useRef<(() => void) | null>(null)
  const printerMenuRef = useRef<HTMLDivElement | null>(null)
  const dataMenuRef = useRef<HTMLDivElement | null>(null)
  const dataMenuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [printerMenuOpen, setPrinterMenuOpen] = useState(false)
  const [dataMenuOpen, setDataMenuOpen] = useState(false)
  const [dataMenuPosition, setDataMenuPosition] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => () => pendingDragCleanupRef.current?.(), [])

  useEffect(() => {
    if (!printerMenuOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!printerMenuRef.current?.contains(event.target as Node)) {
        setPrinterMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPrinterMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [printerMenuOpen])

  useEffect(() => {
    if (!dataMenuOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!dataMenuRef.current?.contains(event.target as Node)) {
        setDataMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDataMenuOpen(false)
      }
    }

    const handleResize = () => setDataMenuOpen(false)

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleResize)
    }
  }, [dataMenuOpen])

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
  const tabSurfaceActive = activeSurface === 'editor' || activeSurface === 'print-check'
  const availablePrinters = appState?.printers ?? []
  const printerMenuDisabled = !hasActiveTab || availablePrinters.length === 0
  const dataMenuStyle: CSSProperties | undefined = dataMenuPosition
    ? {
        left: dataMenuPosition.left,
        top: dataMenuPosition.top,
      }
    : undefined

  const toggleDataMenu = () => {
    const bounds = dataMenuTriggerRef.current?.getBoundingClientRect()
    if (bounds) {
      setDataMenuPosition({
        left: Math.min(bounds.left, window.innerWidth - 266),
        top: bounds.bottom + 6,
      })
    }
    setDataMenuOpen((current) => !current)
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
            <img className="product-mark" src="/favicon.svg" alt="" aria-hidden="true" />
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
              <div key={tab.id} className={clsx('title-tab', tabSurfaceActive && activeTabId === tab.id && 'active', tabDirty && 'dirty')}>
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
          <div ref={dataMenuRef} className="data-management-menu-wrap">
            <button
              ref={dataMenuTriggerRef}
              className={clsx('ghost-button compact-button topbar-action-secondary data-management-trigger', dataMenuOpen && 'active')}
              type="button"
              onClick={toggleDataMenu}
              disabled={dataManaging}
              title="数据管理"
              aria-label="数据管理"
              aria-haspopup="menu"
              aria-expanded={dataMenuOpen}
            >
              <Archive size={16} />
            </button>
            {dataMenuOpen ? (
              <div className="data-management-menu" role="menu" aria-label="数据管理" style={dataMenuStyle}>
                <div className="data-management-menu-head">
                  <strong>数据管理</strong>
                  <span>模板、词库和程序设置</span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDataMenuOpen(false)
                    onBackupAllData()
                  }}
                >
                  <Download size={15} />
                  <span>
                    <strong>备份全部</strong>
                    <small>生成完整数据备份包</small>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDataMenuOpen(false)
                    onRestoreDataBackup()
                  }}
                >
                  <Upload size={15} />
                  <span>
                    <strong>恢复备份</strong>
                    <small>恢复前自动快照当前数据</small>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDataMenuOpen(false)
                    onOpenDataDirectory()
                  }}
                >
                  <FolderOpen size={15} />
                  <span>
                    <strong>打开备份目录</strong>
                    <small>查看已生成的备份文件</small>
                  </span>
                </button>
              </div>
            ) : null}
          </div>
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
          <button
            className={clsx('ghost-button compact-button topbar-action-secondary low-priority-button about-trigger', aboutOpen && 'active')}
            onClick={onOpenAbout}
            title="关于 YiboLabel"
            aria-label="关于 YiboLabel"
          >
            <Info size={15} />
          </button>
        </div>
        <div className="toolbar-spacer" aria-hidden="true" />
        <div className="toolbar-group toolbar-print">
          <div
            ref={printerMenuRef}
            className={clsx('topbar-printer', currentPrinter?.isAvailable ? 'online' : 'offline', printerMenuOpen && 'open')}
            title={currentPrinter?.statusMessage ?? `${printerStatusLabel} · ${activePrinterName}`}
          >
            <button
              className="topbar-printer-trigger"
              type="button"
              aria-label="选择打印机"
              aria-haspopup="listbox"
              aria-expanded={printerMenuOpen}
              disabled={printerMenuDisabled}
              onClick={() => setPrinterMenuOpen((current) => !current)}
            >
              <span className="printer-status-dot" aria-hidden="true" />
              <span className="topbar-printer-summary">{printerStatusLabel} · {activePrinterName}</span>
              <ChevronDown size={14} className="topbar-printer-caret" aria-hidden="true" />
            </button>
            <button className="inline-icon-button" type="button" onClick={onRefreshPrinters} disabled={refreshingPrinters} title={currentPrinter?.statusMessage ?? '刷新打印机状态'} aria-label="刷新打印机状态">
              <RefreshCw size={14} className={refreshingPrinters ? 'is-spinning' : undefined} />
            </button>
            {printerMenuOpen ? (
              <div className="topbar-printer-menu" role="listbox" aria-label="打印机列表">
                {availablePrinters.length ? (
                  availablePrinters.map((printer) => {
                    const selected = printer.devicePath === printerDevicePath
                    return (
                      <button
                        key={printer.id}
                        className={clsx('topbar-printer-option', selected && 'active')}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          onPrinterChange(printer.devicePath)
                          setPrinterMenuOpen(false)
                        }}
                      >
                        <span className={clsx('topbar-printer-option-dot', printer.isAvailable ? 'online' : 'offline')} aria-hidden="true" />
                        <span className="topbar-printer-option-copy">
                          <strong>{printer.displayName}</strong>
                          <span>{printer.isAvailable ? '在线' : '离线'} · {printer.statusMessage}</span>
                        </span>
                        {selected ? <Check size={14} aria-hidden="true" /> : null}
                      </button>
                    )
                  })
                ) : (
                  <div className="topbar-printer-empty">未发现打印机</div>
                )}
              </div>
            ) : null}
          </div>
          <button className={clsx('ghost-button compact-button topbar-action-primary layout-button', activeSurface === 'editor' && activeEditorPanel === 'document-spec' && 'active')} onClick={onOpenDocumentSpec} disabled={!hasActiveTab}>
            文档规格
          </button>
          <button className={clsx('ghost-button compact-button topbar-action-primary layout-button', activeSurface === 'editor' && activeEditorPanel === 'print-calibration' && 'active')} onClick={onOpenPrintCalibration} disabled={!hasActiveTab}>
            打印校准 · {calibrationLabel}
          </button>
          <div className="topbar-copies" aria-label="打印份数">
            <button className="topbar-copy-button" type="button" onClick={onDecreaseCopies} disabled={!hasActiveTab || copies <= 1}>-</button>
            <input type="number" min="1" max="99" value={copies} onChange={(event) => onCopiesChange(Number(event.target.value))} disabled={!hasActiveTab} aria-label="打印份数" />
            <button className="topbar-copy-button" type="button" onClick={onIncreaseCopies} disabled={!hasActiveTab || copies >= 99}>+</button>
          </div>
          {quickPrintAllowed ? (
            <div className="split-print-button">
              <button className="print-button topbar-action-primary split-main" onClick={onPrintCurrent} disabled={!hasActiveTab || printing || !currentPrinter?.isAvailable} title={currentPrinter?.isAvailable ? undefined : currentPrinter?.statusMessage ?? '没有可用打印机'}>
                <Printer size={16} />
                {printing ? '打印中...' : '立即打印'}
              </button>
              <button className={clsx('ghost-button topbar-action-primary split-side', activeSurface === 'print-check' && 'active')} onClick={onOpenPrintCheck} disabled={!hasActiveTab}>
                <SearchCheck size={16} />
                检查
              </button>
            </div>
          ) : (
            <button className={clsx('print-button topbar-action-primary', activeSurface === 'print-check' && 'active')} onClick={onOpenPrintCheck} disabled={!hasActiveTab}>
              <SearchCheck size={16} />
              检查并打印
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
