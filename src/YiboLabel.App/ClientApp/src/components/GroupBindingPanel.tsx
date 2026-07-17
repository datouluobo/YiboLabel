import { useMemo } from 'react'
import clsx from 'clsx'
import type { LexiconGroupSummary, TextElement, BarcodeElement, QrCodeElement } from '../types'
import type { Point } from '../domain/editorGeometry'
import { clamp, getDefaultElementName } from '../domain/labelDocument'

type BindableElement = TextElement | BarcodeElement | QrCodeElement

type GroupBindingPanelProps = {
  open: boolean
  position: Point
  query: string
  groups: LexiconGroupSummary[]
  selectedElements: BindableElement[]
  onQueryChange: (value: string) => void
  onToggleGroup: (groupId: string) => void
  onPositionChange: (position: Point) => void
  onClose: () => void
  onDefaultGroupChange: (groupId: string | null) => void
  onRefresh: () => void
}

export function GroupBindingPanel({
  open,
  position,
  query,
  groups,
  selectedElements,
  onQueryChange,
  onToggleGroup,
  onPositionChange,
  onClose,
  onDefaultGroupChange,
  onRefresh,
}: GroupBindingPanelProps) {
  const filteredGroups = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) {
      return groups
    }

    return groups.filter((group) => group.name.toLowerCase().includes(term) || group.lexiconName.toLowerCase().includes(term))
  }, [groups, query])

  const selectedCount = selectedElements.length
  const singleElement = selectedCount === 1 ? selectedElements[0] : null
  const boundGroupIds = new Set(singleElement?.lexiconGroupIds ?? [])

  if (!open) {
    return null
  }

  return (
    <section className="group-binding-panel" style={{ left: position.x, top: position.y }}>
      <div
        className="group-binding-head"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button, input, select, textarea')) {
            return
          }

          const startX = event.clientX - position.x
          const startY = event.clientY - position.y
          event.currentTarget.setPointerCapture(event.pointerId)
          const handleMove = (moveEvent: PointerEvent) => {
            onPositionChange({
              x: clamp(moveEvent.clientX - startX, 8, window.innerWidth - 360),
              y: clamp(moveEvent.clientY - startY, 8, window.innerHeight - 220),
            })
          }
          const handleUp = () => {
            window.removeEventListener('pointermove', handleMove)
            window.removeEventListener('pointerup', handleUp)
          }
          window.addEventListener('pointermove', handleMove)
          window.addEventListener('pointerup', handleUp)
        }}
      >
        <div>
          <strong>分组绑定</strong>
          <span>
            {selectedCount === 0
              ? '未选择可绑定元素'
              : selectedCount === 1
                ? `${singleElement?.name ?? getDefaultElementName(singleElement?.type ?? 'text')}`
                : `批量绑定 ${selectedCount} 个元素`}
          </span>
        </div>
        <button className="inline-icon-button" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="关闭分组绑定">
          ×
        </button>
      </div>

      <div className="group-binding-tools">
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索分组" />
        <button className="mini-button" type="button" onClick={onRefresh}>
          刷新
        </button>
      </div>

      {singleElement ? (
        <label className="group-binding-default">
          默认分组
          <select
            value={singleElement.defaultLexiconGroupId ?? ''}
            onChange={(event) => onDefaultGroupChange(event.target.value || null)}
            disabled={(singleElement.lexiconGroupIds ?? []).length === 0}
          >
            <option value="">不指定</option>
            {groups
              .filter((group) => boundGroupIds.has(group.id))
              .map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
          </select>
        </label>
      ) : (
        <p className="empty-note">多选时可批量勾选分组；默认分组请单选元素后设置。</p>
      )}

      <div className="group-binding-list">
        {selectedCount === 0 ? (
          <p className="empty-note">请选择文本、条码或二维码元素。</p>
        ) : filteredGroups.length === 0 ? (
          <p className="empty-note">没有匹配的分组。</p>
        ) : (
          filteredGroups.map((group) => {
            const boundCount = selectedElements.filter((element) => (element.lexiconGroupIds ?? []).includes(group.id)).length
            const checked = selectedCount > 0 && boundCount === selectedCount
            const partial = boundCount > 0 && boundCount < selectedCount
            return (
              <label key={group.id} className={clsx('group-binding-row', partial && 'partial')}>
                <input type="checkbox" checked={checked} onChange={() => onToggleGroup(group.id)} />
                <span>
                  <strong>{group.name}</strong>
                  <small>
                    {group.entryCount} 条
                    {partial ? ` · ${boundCount}/${selectedCount}` : ''}
                  </small>
                </span>
              </label>
            )
          })
        )}
      </div>
    </section>
  )
}
