import { useEffect, useMemo, useState } from 'react'
import { fetchLexiconSuggestions } from '../api/lexiconsApi'
import type { Point } from '../domain/editorGeometry'
import { clamp, isLexiconEnabledElement } from '../domain/labelDocument'
import type { LabelElement, LexiconGroupSummary, LexiconSuggestion } from '../types'

type ContentPickerProps = {
  open: boolean
  position: Point
  element: LabelElement | null
  groups: LexiconGroupSummary[]
  onPositionChange: (position: Point) => void
  onClose: () => void
  onApply: (text: string) => void
}

export function ContentPicker({
  open,
  position,
  element,
  groups,
  onPositionChange,
  onClose,
  onApply,
}: ContentPickerProps) {
  const [suggestions, setSuggestions] = useState<LexiconSuggestion[]>([])
  const [query, setQuery] = useState('')
  const groupIds = useMemo(() => (isLexiconEnabledElement(element) ? element.lexiconGroupIds ?? [] : []), [element])
  const groupKey = groupIds.join(',')

  useEffect(() => {
    if (!open || groupIds.length === 0) {
      setSuggestions([])
      return
    }

    const controller = new AbortController()
    fetchLexiconSuggestions(groupIds, query, controller.signal)
      .then(setSuggestions)
      .catch(() => undefined)
    return () => controller.abort()
  }, [groupIds, groupIds.length, groupKey, open, query])

  if (!open) {
    return null
  }

  return (
    <section className="content-picker" style={{ left: position.x, top: position.y }}>
      <div
        className="content-picker-head"
        onPointerDown={(event) => {
          const startX = event.clientX - position.x
          const startY = event.clientY - position.y
          event.currentTarget.setPointerCapture(event.pointerId)
          const handleMove = (moveEvent: PointerEvent) => {
            onPositionChange({
              x: clamp(moveEvent.clientX - startX, 8, window.innerWidth - 320),
              y: clamp(moveEvent.clientY - startY, 8, window.innerHeight - 180),
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
        <strong>内容候选</strong>
        <button className="inline-icon-button" type="button" onClick={onClose} aria-label="关闭内容浮窗">
          ×
        </button>
      </div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选候选" />
      {groups.length === 0 ? (
        <p className="empty-note">当前元素未绑定分组。</p>
      ) : suggestions.length === 0 ? (
        <p className="empty-note">没有匹配的内容。</p>
      ) : (
        <div className="content-picker-list">
          {suggestions.map((suggestion) => (
            <button
              key={`${suggestion.groupId}-${suggestion.entryId}`}
              type="button"
              onClick={() => onApply(suggestion.text)}
              onDoubleClick={() => {
                onApply(suggestion.text)
                onClose()
              }}
            >
              <span>{suggestion.text}</span>
              <small>{suggestion.groupName}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
