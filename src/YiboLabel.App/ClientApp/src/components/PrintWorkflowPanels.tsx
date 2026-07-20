import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeftRightEllipsis, Printer, RefreshCw, Save, TestTubeDiagonal } from 'lucide-react'
import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ElementPreview } from './ElementInspector'
import { getElementBounds, type ElementOverlapSummary } from '../domain/editorGeometry'
import { formatDocumentSpecSummary, type PrintCheckCategory, type PrintCheckFilter, type PrintCheckItem, type PrintCheckReport, type PrintCheckTarget } from '../domain/printWorkflow'
import type { AppStateResponse, DocumentSpecPresetSummary, LabelDocument, PrinterCalibrationRecord } from '../types'

type DocumentSpecPanelProps = {
  open: boolean
  labelDocument: LabelDocument
  specPresets: DocumentSpecPresetSummary[]
  activeSourcePreset: DocumentSpecPresetSummary | null
  sourcePresetChanged: boolean
  onDocumentFieldChange: <K extends keyof LabelDocument>(key: K, value: LabelDocument[K]) => void
  onApplyPreset: (preset: DocumentSpecPresetSummary) => void
  onSaveAsPreset: () => void
  onSavePresetEdit: (preset: DocumentSpecPresetSummary, nextName: string, nextNotes: string) => void
  onArchivePreset: (preset: DocumentSpecPresetSummary) => void
  onToggleHiddenPreset: (preset: DocumentSpecPresetSummary) => void
  onDeletePreset: (preset: DocumentSpecPresetSummary) => void
}

type PrintCalibrationPanelProps = {
  open: boolean
  labelDocument: LabelDocument
  currentPrinter: AppStateResponse['printers'][number] | null
  calibrationLabel: string
  calibrationProfiles: PrinterCalibrationRecord[]
  refreshingPrinters: boolean
  onDocumentFieldChange: <K extends keyof LabelDocument>(key: K, value: LabelDocument[K]) => void
  onCalibrationProfileChange: (profileId: string) => void
  onRefreshPrinters: () => void
  onMarkCalibrationSaved: () => void
  onSaveCalibrationAsNew: () => void
  onRenameCalibration: () => void
  onSetDefaultCalibration: () => void
  onDeleteCalibration: () => void
  onResetCalibration: () => void
  onTestPrint: () => void
}

type PrintCheckSurfaceProps = {
  labelDocument: LabelDocument
  currentPrinter: AppStateResponse['printers'][number] | null
  activeTabDirty: boolean
  report: PrintCheckReport
  overlapSummary: ElementOverlapSummary
  saving: boolean
  printing: boolean
  onBackToEditor: () => void
  onOpenDocumentSpec: () => void
  onOpenPrintCalibration: () => void
  onSave: () => void
  onPrint: () => void
}

type PreviewIssue = {
  itemId: string
  left: number
  top: number
  width: number
  height: number
  variant: 'warning' | 'danger' | 'empty'
  label: string
}

type PrintCheckFocusSource = 'auto' | 'list' | 'preview' | 'nav'

const previewScale = 9

export function DocumentSpecPanel({
  open,
  labelDocument,
  specPresets,
  activeSourcePreset,
  sourcePresetChanged,
  onDocumentFieldChange,
  onApplyPreset,
  onSaveAsPreset,
  onSavePresetEdit,
  onArchivePreset,
  onToggleHiddenPreset,
  onDeletePreset,
}: DocumentSpecPanelProps) {
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [editingPresetName, setEditingPresetName] = useState('')
  const [editingPresetNotes, setEditingPresetNotes] = useState('')

  useEffect(() => {
    if (!editingPresetId) {
      return
    }

    const preset = specPresets.find((item) => item.id === editingPresetId) ?? null
    if (!preset) {
      setEditingPresetId(null)
      setEditingPresetName('')
      setEditingPresetNotes('')
    }
  }, [editingPresetId, specPresets])

  if (!open) {
    return null
  }

  return (
    <aside className="inspector object-panel workflow-panel">
      <div className="panel-heading">
        <span>文档规格</span>
      </div>
      <div className="inspector-fields workflow-panel-fields">
        <section className="workflow-overview">
          <strong>{labelDocument.name}</strong>
          <span>{formatDocumentSpecSummary(labelDocument)}</span>
          <span>规格来源：{labelDocument.sourceSpecName ?? '当前模板内规格'}</span>
        </section>
        <section className="inspector-section workflow-section">
          <div className="inspector-section-head">
            <strong>基础参数</strong>
            <span>控制画布与标签纸规格</span>
          </div>
          <div className="inspector-section-body">
            <label>
              模板名称
              <input value={labelDocument.name} onChange={(event) => onDocumentFieldChange('name', event.target.value)} />
            </label>
            <div className="field-row">
              <label>
                宽度 (mm)
                <input type="number" min="20" step="1" value={labelDocument.widthMm} onChange={(event) => onDocumentFieldChange('widthMm', Number(event.target.value))} />
              </label>
              <label>
                高度 (mm)
                <input type="number" min="20" step="1" value={labelDocument.heightMm} onChange={(event) => onDocumentFieldChange('heightMm', Number(event.target.value))} />
              </label>
            </div>
            <label>
              间隙 (mm)
              <input type="number" min="0" step="0.5" value={labelDocument.gapMm} onChange={(event) => onDocumentFieldChange('gapMm', Number(event.target.value))} />
            </label>
            <label>
              规格来源备注
              <input
                value={labelDocument.sourceSpecName ?? ''}
                placeholder="例如：40 x 30 mm 常用标签"
                onChange={(event) => onDocumentFieldChange('sourceSpecName', event.target.value || null)}
              />
            </label>
          </div>
        </section>
        {activeSourcePreset && sourcePresetChanged ? (
          <div className="workflow-warning">
            <strong>当前规格已偏离来源预设</strong>
            <span>
              此规格来源于“{activeSourcePreset.name}”。
              {activeSourcePreset.referenceCount > 0 ? `该预设已有 ${activeSourcePreset.referenceCount} 个模板使用，建议复制为新规格后再继续复用。` : '如果你想复用这套新尺寸，建议保存为新规格预设。'}
            </span>
            <div className="workflow-preset-actions">
              <button className="ghost-button compact-button" type="button" onClick={onSaveAsPreset}>
                <Save size={14} />
                复制为新规格
              </button>
            </div>
          </div>
        ) : null}
        <section className="inspector-section workflow-section workflow-preset-section">
          <div className="inspector-section-head">
            <strong>规格预设</strong>
            <span>复用常用标签尺寸</span>
          </div>
          <div className="workflow-preset-actions">
            <button className="ghost-button compact-button" type="button" onClick={onSaveAsPreset}>
              <Save size={14} />
              保存为预设
            </button>
          </div>
          <div className="workflow-preset-list">
            {specPresets.length === 0 ? (
              <p className="workflow-note">还没有规格预设。</p>
            ) : specPresets.map((preset) => (
              <div key={preset.id} className={clsx('workflow-preset-card', labelDocument.sourceSpecId === preset.id && 'active')}>
                <div>
                  <strong>{preset.name}</strong>
                  <span>{preset.widthMm} x {preset.heightMm} mm · 间隙 {preset.gapMm} mm</span>
                  <span>{preset.isHidden ? '已隐藏' : preset.isArchived ? '已归档' : '正常可用'}</span>
                  <span>{preset.referenceCount > 0 ? `${preset.referenceCount} 个模板使用` : '尚未被模板引用'}</span>
                </div>
                <div className="workflow-preset-card-actions">
                  <button className="mini-button" type="button" onClick={() => onApplyPreset(preset)}>
                    套用
                  </button>
                  <button
                    className="mini-button"
                    type="button"
                    onClick={() => {
                      setEditingPresetId(preset.id)
                      setEditingPresetName(preset.name)
                      setEditingPresetNotes(preset.notes ?? '')
                    }}
                  >
                    编辑
                  </button>
                  <button className="mini-button" type="button" onClick={() => onToggleHiddenPreset(preset)}>
                    {preset.isHidden ? '取消隐藏' : '隐藏'}
                  </button>
                  <button className="mini-button" type="button" onClick={() => onArchivePreset(preset)}>
                    {preset.isArchived ? '取消归档' : '归档'}
                  </button>
                  <button className="mini-button danger" type="button" onClick={() => onDeletePreset(preset)} disabled={preset.referenceCount > 0}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
          {editingPresetId ? (
            <div className="workflow-inline-editor">
              <div className="inspector-section-head">
                <strong>编辑规格预设</strong>
                <span>只修改名称和备注，不改历史尺寸。</span>
              </div>
              <label>
                规格名称
                <input value={editingPresetName} onChange={(event) => setEditingPresetName(event.target.value)} />
              </label>
              <label>
                规格备注
                <textarea value={editingPresetNotes} onChange={(event) => setEditingPresetNotes(event.target.value)} rows={3} />
              </label>
              <div className="workflow-preset-actions">
                <button
                  className="ghost-button compact-button"
                  type="button"
                  onClick={() => {
                    const preset = specPresets.find((item) => item.id === editingPresetId)
                    if (!preset) {
                      return
                    }

                    onSavePresetEdit(preset, editingPresetName, editingPresetNotes)
                    setEditingPresetId(null)
                  }}
                >
                  <Save size={14} />
                  保存编辑
                </button>
                <button className="ghost-button compact-button" type="button" onClick={() => setEditingPresetId(null)}>
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </section>
        <p className="workflow-note workflow-footnote">这里只处理画布规格和模板基础，不处理打印机、校准、份数和打印动作。</p>
      </div>
    </aside>
  )
}

export function PrintCalibrationPanel({
  open,
  labelDocument,
  currentPrinter,
  calibrationLabel,
  calibrationProfiles,
  refreshingPrinters,
  onDocumentFieldChange,
  onCalibrationProfileChange,
  onRefreshPrinters,
  onMarkCalibrationSaved,
  onSaveCalibrationAsNew,
  onRenameCalibration,
  onSetDefaultCalibration,
  onDeleteCalibration,
  onResetCalibration,
  onTestPrint,
}: PrintCalibrationPanelProps) {
  if (!open) {
    return null
  }

  return (
    <aside className="inspector object-panel workflow-panel">
      <div className="panel-heading">
        <span>打印校准</span>
      </div>
      <div className="inspector-fields workflow-panel-fields">
        <section className="workflow-overview">
          <strong>{calibrationLabel}</strong>
          <span>{currentPrinter?.displayName ?? '未选择打印机'}</span>
          <span>{formatDocumentSpecSummary(labelDocument)}</span>
        </section>
        <section className="inspector-section workflow-section">
          <div className="inspector-section-head">
            <strong>打印机状态</strong>
            <span>{currentPrinter ? (currentPrinter.isAvailable ? '在线' : '离线') : '未选择'}</span>
          </div>
          <div className={clsx('printer-status workflow-printer-status', currentPrinter?.isAvailable ? 'online' : 'offline')}>
            <span className="printer-status-dot" aria-hidden="true" />
            <div>
              <strong>{currentPrinter?.displayName ?? '未选择打印机'}</strong>
              <span>{currentPrinter?.statusMessage ?? '请先选择打印机。'}</span>
            </div>
            <button className="inline-icon-button" type="button" onClick={onRefreshPrinters} disabled={refreshingPrinters} title="刷新打印机状态" aria-label="刷新打印机状态">
              <RefreshCw size={14} className={refreshingPrinters ? 'is-spinning' : undefined} />
            </button>
          </div>
        </section>
        <section className="inspector-section workflow-section">
          <div className="inspector-section-head">
            <strong>校准方案</strong>
            <span>{calibrationProfiles.length ? `${calibrationProfiles.length} 个方案` : '暂无方案'}</span>
          </div>
          <label>
            当前方案
            <select
              value={labelDocument.calibrationProfileId ?? ''}
              onChange={(event) => onCalibrationProfileChange(event.target.value)}
              disabled={!currentPrinter}
            >
              <option value="">默认校准</option>
              {calibrationProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
          </label>
          <div className="workflow-preset-list calibration-profile-list">
          {calibrationProfiles.length === 0 ? (
            <p className="workflow-note">这台打印机还没有保存的校准方案。</p>
          ) : calibrationProfiles.map((profile) => (
            <div key={profile.id} className={clsx('workflow-preset-card', labelDocument.calibrationProfileId === profile.id && 'active')}>
              <div>
                <strong>{profile.label}</strong>
                <span>{profile.isDefault ? '默认方案' : '备用方案'} · {profile.state === 'calibrated' ? '已校准' : profile.state}</span>
                <span>偏移 {profile.printOffsetXMm}/{profile.printOffsetYMm} mm · 方向 {profile.printRotation}° · 浓度 {profile.darkness}</span>
              </div>
              <div className="workflow-preset-card-actions">
                <button className="mini-button" type="button" onClick={() => onCalibrationProfileChange(profile.id)}>
                  切换
                </button>
                <button className="mini-button" type="button" onClick={onSetDefaultCalibration} disabled={labelDocument.calibrationProfileId !== profile.id || profile.isDefault}>
                  设为默认
                </button>
              </div>
            </div>
          ))}
          </div>
        </section>
        <section className="inspector-section workflow-section">
          <div className="inspector-section-head">
            <strong>校准参数</strong>
            <span>偏移、方向与打印浓度</span>
          </div>
          <div className="field-row">
            <label>
              横向偏移 X (mm)
              <input type="number" min="-20" max="20" step="0.1" value={labelDocument.printOffsetXMm} onChange={(event) => onDocumentFieldChange('printOffsetXMm', Number(event.target.value))} />
            </label>
            <label>
              纵向偏移 Y (mm)
              <input type="number" min="-20" max="20" step="0.1" value={labelDocument.printOffsetYMm} onChange={(event) => onDocumentFieldChange('printOffsetYMm', Number(event.target.value))} />
            </label>
          </div>
          <div className="field-row">
            <label>
              打印方向
              <select value={labelDocument.printRotation} onChange={(event) => onDocumentFieldChange('printRotation', Number(event.target.value))}>
                <option value="0">正常</option>
                <option value="90">顺时针 90°</option>
                <option value="180">旋转 180°</option>
                <option value="270">逆时针 90°</option>
              </select>
            </label>
            <label>
              打印浓度
              <input type="number" min="1" max="15" step="1" value={labelDocument.darkness} onChange={(event) => onDocumentFieldChange('darkness', Number(event.target.value))} />
            </label>
          </div>
          <label className="toggle-row workflow-toggle-row">
            <input type="checkbox" checked={labelDocument.printInvert} onChange={(event) => onDocumentFieldChange('printInvert', event.target.checked)} />
            黑白反相
          </label>
        </section>
        <section className="inspector-section workflow-section">
          <div className="inspector-section-head">
            <strong>操作</strong>
            <span>测试、保存或管理方案</span>
          </div>
          <div className="workflow-panel-actions">
            <button className="ghost-button compact-button" type="button" onClick={onTestPrint} disabled={!currentPrinter?.isAvailable}>
              <TestTubeDiagonal size={14} />
              测试打印
            </button>
            <button className="ghost-button compact-button" type="button" onClick={onResetCalibration}>
              <ChevronsLeftRightEllipsis size={14} />
              重置默认
            </button>
            <button className="ghost-button compact-button" type="button" onClick={onMarkCalibrationSaved} disabled={!currentPrinter}>
              <Save size={14} />
              保存校准
            </button>
            <button className="ghost-button compact-button" type="button" onClick={onSaveCalibrationAsNew} disabled={!currentPrinter}>
              <Save size={14} />
              另存方案
            </button>
            <button className="ghost-button compact-button" type="button" onClick={onRenameCalibration} disabled={!currentPrinter || !labelDocument.calibrationProfileId}>
              重命名
            </button>
            <button className="ghost-button compact-button" type="button" onClick={onDeleteCalibration} disabled={!currentPrinter || !labelDocument.calibrationProfileId}>
              删除方案
            </button>
          </div>
        </section>
        <p className="workflow-note workflow-footnote">当前校准仅适用于当前打印机。切换打印机后，会自动显示对应打印机的校准状态。</p>
      </div>
    </aside>
  )
}

export function PrintCheckSurface({
  labelDocument,
  currentPrinter,
  activeTabDirty,
  report,
  overlapSummary: _overlapSummary,
  saving,
  printing,
  onBackToEditor,
  onOpenDocumentSpec,
  onOpenPrintCalibration,
  onSave,
  onPrint,
}: PrintCheckSurfaceProps) {
  const itemRefs = useRef(new Map<string, HTMLDivElement>())
  const pulseTimeoutRef = useRef<number | null>(null)
  const previewIssues = useMemo(() => buildPreviewIssues(report.items, labelDocument), [labelDocument, report.items])
  const [filter, setFilter] = useState<PrintCheckFilter>('issues')
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(() => createDefaultExpandedCategories(report))
  const [showPassedItemsByCategory, setShowPassedItemsByCategory] = useState<Record<string, boolean>>({})
  const [focusSource, setFocusSource] = useState<PrintCheckFocusSource>('auto')
  const [pulseItemId, setPulseItemId] = useState<string | null>(null)
  const [pulseCategoryKey, setPulseCategoryKey] = useState<string | null>(null)

  const categories = useMemo(
    () => report.categories.filter((category) => filter === 'all' || category.issueCount > 0),
    [filter, report.categories],
  )
  const navigationItems = useMemo(
    () => categories.flatMap((category) => getVisibleItems(category.items, filter, showPassedItemsByCategory[category.key] ?? false)),
    [categories, filter, showPassedItemsByCategory],
  )
  const focusItemId = hoveredItemId ?? activeItemId
  const focusedPreviewIssues = useMemo(
    () => previewIssues.filter((issue) => issue.itemId === focusItemId),
    [focusItemId, previewIssues],
  )
  const activeItem = useMemo(
    () => report.items.find((item) => item.id === activeItemId) ?? null,
    [activeItemId, report.items],
  )
  const activeNavigationIndex = navigationItems.findIndex((item) => item.id === activeItemId)

  const activateItem = useCallback((itemId: string, source: PrintCheckFocusSource) => {
    setFocusSource(source)
    setActiveItemId(itemId)
  }, [])

  useEffect(() => {
    setExpandedCategories((current) => {
      const knownKeys = new Set(report.categories.map((category) => category.key))
      const hasAnyExpanded = Object.entries(current).some(([key, value]) => knownKeys.has(key as PrintCheckCategory) && value)
      if (!hasAnyExpanded) {
        return createDefaultExpandedCategories(report)
      }

      const next: Record<string, boolean> = {}
      for (const category of report.categories) {
        next[category.key] = current[category.key] ?? false
      }
      return next
    })
  }, [report])

  useEffect(() => {
    if (navigationItems.length === 0) {
      setActiveItemId(null)
      return
    }

    if (activeItemId && navigationItems.some((item) => item.id === activeItemId)) {
      return
    }

    activateItem(navigationItems[0].id, 'auto')
  }, [activateItem, activeItemId, navigationItems])

  useEffect(() => {
    if (!activeItem) {
      return
    }

    setExpandedCategories(createExclusiveExpandedCategories(report, activeItem.category))
    const target = itemRefs.current.get(activeItem.id)
    target?.scrollIntoView({
      block: focusSource === 'preview' || focusSource === 'nav' ? 'center' : 'nearest',
      behavior: 'smooth',
    })

    if (focusSource === 'preview') {
      setPulseItemId(activeItem.id)
      setPulseCategoryKey(activeItem.category)
      if (pulseTimeoutRef.current !== null) {
        window.clearTimeout(pulseTimeoutRef.current)
      }
      pulseTimeoutRef.current = window.setTimeout(() => {
        setPulseItemId(null)
        setPulseCategoryKey(null)
        pulseTimeoutRef.current = null
      }, 1600)
    }
  }, [activeItem, focusSource, report])

  useEffect(() => () => {
    if (pulseTimeoutRef.current !== null) {
      window.clearTimeout(pulseTimeoutRef.current)
    }
  }, [])

  return (
    <section className="print-check-surface">
      <div className="print-check-preview-pane">
        <div className="print-check-preview-head">
          <div>
            <strong>打印预览</strong>
            <span>{formatDocumentSpecSummary(labelDocument)}</span>
          </div>
          <span>方向 {labelDocument.printRotation}° · 偏移 {labelDocument.printOffsetXMm}/{labelDocument.printOffsetYMm} mm</span>
        </div>
        <div className="print-preview-stage">
          <div
            className={clsx('print-preview-sheet', labelDocument.printInvert && 'invert')}
            style={{
              width: `${labelDocument.widthMm * previewScale}px`,
              height: `${labelDocument.heightMm * previewScale}px`,
              transform: `translate(${labelDocument.printOffsetXMm * previewScale}px, ${labelDocument.printOffsetYMm * previewScale}px) rotate(${labelDocument.printRotation}deg)`,
            }}
          >
            {labelDocument.elements.filter((element) => !element.hidden).map((element) => (
              <div
                key={element.id}
                className="print-preview-element"
                style={{
                  left: `${element.x * previewScale}px`,
                  top: `${element.y * previewScale}px`,
                  width: `${element.width * previewScale}px`,
                  height: `${element.height * previewScale}px`,
                  transform: `rotate(${element.rotation}deg)`,
                }}
              >
                <ElementPreview element={element} canvasScale={previewScale} />
              </div>
            ))}
            {focusedPreviewIssues.map((issue) => (
              <button
                key={issue.itemId}
                className={clsx('print-preview-issue', issue.variant, 'active')}
                title={issue.label}
                type="button"
                onMouseEnter={() => setHoveredItemId(issue.itemId)}
                onMouseLeave={() => setHoveredItemId((current) => (current === issue.itemId ? null : current))}
                onClick={() => activateItem(issue.itemId, 'preview')}
                style={{
                  left: `${issue.left * previewScale}px`,
                  top: `${issue.top * previewScale}px`,
                  width: `${Math.max(issue.width * previewScale, 8)}px`,
                  height: `${Math.max(issue.height * previewScale, 8)}px`,
                }}
              >
                <span className="sr-only">{issue.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <aside className="print-check-panel">
        <div className="print-check-panel-head">
          <div>
            <strong>{report.pageTitle}</strong>
            <span>{report.blockingCount} 个未通过 · {report.warningCount} 个提醒 · {report.passCount} 个通过</span>
          </div>
          <div className={clsx('print-check-status-badge', report.pageStatus)}>
            {report.pageStatus === 'pass' ? <Check size={14} /> : <AlertTriangle size={14} />}
            <span>{getStatusLabel(report.pageStatus)}</span>
          </div>
        </div>
        <section className="workflow-overview print-check-overview">
          <strong>{labelDocument.name}</strong>
          <span>规格：{formatDocumentSpecSummary(labelDocument)}</span>
          <span>打印机：{currentPrinter?.displayName ?? '未选择'}</span>
          <span>校准：{report.calibrationLabel}</span>
          <span>份数：{labelDocument.copies}</span>
          <span>保存状态：{activeTabDirty ? '未保存修改' : '已保存'}</span>
        </section>
        <div className="print-check-toolbar">
          <div className="print-check-filter">
            <button className={clsx('ghost-button compact-button', filter === 'issues' && 'active')} type="button" onClick={() => setFilter('issues')}>
              仅问题
            </button>
            <button className={clsx('ghost-button compact-button', filter === 'all' && 'active')} type="button" onClick={() => setFilter('all')}>
              全部
            </button>
          </div>
          <div className="print-check-nav">
            <button className="ghost-button compact-button print-check-nav-button" type="button" onClick={() => moveActiveItem(-1)} disabled={navigationItems.length <= 1}>
              <ChevronLeft size={14} />
              上一条
            </button>
            <span className="print-check-nav-progress">{activeNavigationIndex >= 0 ? `${activeNavigationIndex + 1} / ${navigationItems.length}` : `0 / ${navigationItems.length}`}</span>
            <button className="ghost-button compact-button print-check-nav-button" type="button" onClick={() => moveActiveItem(1)} disabled={navigationItems.length <= 1}>
              下一条
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
        <div className="print-check-list">
          {categories.map((category) => {
            const expanded = expandedCategories[category.key] ?? false
            const showPassed = showPassedItemsByCategory[category.key] ?? false
            const visibleItems = getVisibleItems(category.items, filter, showPassed)

            return (
              <section key={category.key} className={clsx('print-check-category', category.status, expanded && 'expanded', pulseCategoryKey === category.key && 'pulse')}>
                <button
                  className="print-check-category-head"
                  type="button"
                  onClick={() =>
                    setExpandedCategories(
                      expanded
                        ? createExclusiveExpandedCategories(report, null)
                        : createExclusiveExpandedCategories(report, category.key),
                    )
                  }
                >
                  <div className="print-check-category-title">
                    <ChevronDown size={16} className={clsx('print-check-category-chevron', expanded && 'expanded')} />
                    <div>
                      <strong>{category.title}</strong>
                      <span>{category.description}</span>
                    </div>
                  </div>
                  <div className="print-check-category-meta">
                    <span className={clsx('print-check-category-badge', category.status)}>{getStatusLabel(category.status)}</span>
                    <span className="print-check-category-count">{category.failCount} 未通过</span>
                    <span className="print-check-category-count">{category.warningCount} 提醒</span>
                    <span className="print-check-category-count">{category.passCount} 通过</span>
                  </div>
                </button>
                {expanded ? (
                  <div className="print-check-category-body">
                    {category.passCount > 0 ? (
                      <div className="print-check-category-summary">
                        <span>已通过 {category.passCount} 项</span>
                        {filter === 'all' ? (
                          <button
                            className="mini-button"
                            type="button"
                            onClick={() => setShowPassedItemsByCategory((current) => ({ ...current, [category.key]: !showPassed }))}
                          >
                            {showPassed ? '收起通过项' : '查看通过项'}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {visibleItems.length === 0 ? (
                      <p className="workflow-note">当前筛选下没有需要显示的检查项。</p>
                    ) : (
                      <div className="print-check-items">
                        {visibleItems.map((item) => {
                          const issueItem = item.status !== 'pass'
                          const categoryAction = resolveCategoryAction(item, category.key)
                          return (
                            <div
                              key={item.id}
                              ref={(node) => {
                                if (node) {
                                  itemRefs.current.set(item.id, node)
                                } else {
                                  itemRefs.current.delete(item.id)
                                }
                              }}
                              className={clsx('print-check-item', item.status, activeItemId === item.id && 'active', hoveredItemId === item.id && 'hovered', pulseItemId === item.id && 'pulse')}
                              onMouseEnter={() => setHoveredItemId(item.id)}
                              onMouseLeave={() => setHoveredItemId((current) => (current === item.id ? null : current))}
                              onClick={() => activateItem(item.id, 'list')}
                            >
                              <div className="print-check-item-head">
                                {item.status === 'pass' ? <Check size={14} /> : <AlertTriangle size={14} />}
                                <strong>{item.title}</strong>
                                <span className="print-check-item-status">{getStatusLabel(item.status)}</span>
                              </div>
                              <div className="print-check-item-body">
                                <p className="print-check-item-detail">{item.detail}</p>
                                {item.actionHint ? <p className="print-check-item-hint">建议：{item.actionHint}</p> : null}
                              </div>
                              {issueItem && categoryAction ? (
                                <div className="print-check-item-footer">
                                  <div className="print-check-item-actions">
                                    <button className="mini-button" type="button" onClick={(event) => {
                                      event.stopPropagation()
                                      categoryAction.onClick()
                                    }}>
                                      {categoryAction.label}
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
        <div className="print-check-actions">
          <div className="print-check-actions-secondary">
            <button className="ghost-button compact-button" type="button" onClick={onBackToEditor}>
              返回编辑器
            </button>
            <button className="ghost-button compact-button" type="button" onClick={onOpenDocumentSpec}>
              文档规格
            </button>
            <button className="ghost-button compact-button" type="button" onClick={onOpenPrintCalibration}>
              打印校准
            </button>
          </div>
          <div className="print-check-actions-primary">
            <button className="ghost-button compact-button" type="button" onClick={onSave} disabled={saving}>
              <Save size={14} />
              {saving ? '保存中...' : '保存'}
            </button>
            <button className="print-button compact-button" type="button" onClick={onPrint} disabled={printing || report.blockingCount > 0}>
              <Printer size={14} />
              {printing ? '打印中...' : '立即打印'}
            </button>
          </div>
        </div>
      </aside>
    </section>
  )

  function moveActiveItem(offset: -1 | 1) {
    if (navigationItems.length === 0) {
      return
    }

    const currentIndex = activeNavigationIndex >= 0 ? activeNavigationIndex : 0
    const nextIndex = (currentIndex + offset + navigationItems.length) % navigationItems.length
    activateItem(navigationItems[nextIndex].id, 'nav')
  }

  function resolveCategoryAction(item: PrintCheckItem, category: PrintCheckCategory) {
    if (item.id === 'output-unsaved') {
      return { label: '立即保存', onClick: onSave }
    }

    if (category === 'device' || category === 'calibration') {
      return { label: '打开打印校准', onClick: onOpenPrintCalibration }
    }

    if (category === 'document') {
      return { label: '打开文档规格', onClick: onOpenDocumentSpec }
    }

    if (category === 'content' || category === 'layout' || item.id === 'output-hidden-elements') {
      return { label: '返回编辑器', onClick: onBackToEditor }
    }

    return null
  }
}

function buildPreviewIssues(items: PrintCheckItem[], labelDocument: LabelDocument): PreviewIssue[] {
  return items.flatMap((item) => {
    if (item.status === 'pass' || !item.previewVariant) {
      return []
    }

    return (item.previewTargets ?? [item.target]).flatMap((target) => buildPreviewIssue(target, item, labelDocument))
  })
}

function buildPreviewIssue(target: PrintCheckTarget, item: PrintCheckItem, labelDocument: LabelDocument): PreviewIssue[] {
  if (target.kind === 'region') {
    return [{
      itemId: item.id,
      left: target.left,
      top: target.top,
      width: target.width,
      height: target.height,
      variant: item.previewVariant ?? 'warning',
      label: item.title,
    }]
  }

  if (target.kind === 'element') {
    const element = labelDocument.elements.find((entry) => entry.id === target.elementId)
    if (!element) {
      return []
    }

    const bounds = getElementBounds(element)
    return [{
      itemId: item.id,
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      variant: item.previewVariant ?? 'warning',
      label: item.title,
    }]
  }

  return []
}

function createDefaultExpandedCategories(report: PrintCheckReport) {
  const firstIssueCategory = report.categories.find((category) => category.status === 'fail') ?? report.categories.find((category) => category.status === 'warn') ?? report.categories[0] ?? null
  return createExclusiveExpandedCategories(report, firstIssueCategory?.key ?? null)
}

function createExclusiveExpandedCategories(report: PrintCheckReport, expandedKey: PrintCheckCategory | null) {
  return Object.fromEntries(report.categories.map((category) => [category.key, category.key === expandedKey]))
}

function getVisibleItems(items: PrintCheckItem[], filter: PrintCheckFilter, showPassed: boolean) {
  return items.filter((item) => item.status !== 'pass' || (filter === 'all' && showPassed))
}

function getStatusLabel(status: PrintCheckReport['pageStatus']) {
  return status === 'pass' ? '通过' : status === 'warn' ? '提醒' : '未通过'
}
