import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { fetchLexiconSuggestions } from '../api/lexiconsApi'
import type { LexiconSuggestion } from '../types'

type ContentValueInputProps = {
  value: string
  groupIds: string[]
  onChange: (value: string) => void
}

export function ContentValueInput({ value, groupIds, onChange }: ContentValueInputProps) {
  const [suggestions, setSuggestions] = useState<LexiconSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const groupKey = groupIds.join(',')

  useEffect(() => {
    if (groupIds.length === 0) {
      setSuggestions([])
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetchLexiconSuggestions(groupIds, value, controller.signal)
        .then((items) => {
          setSuggestions(items)
          setActiveIndex(0)
        })
        .catch(() => undefined)
    }, 120)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [groupIds.length, groupKey, value])

  function commitSuggestion(index: number) {
    const suggestion = suggestions[index]
    if (!suggestion) {
      return
    }

    onChange(suggestion.text)
    setOpen(false)
  }

  return (
    <div className="content-input-wrap">
      <textarea
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (!open || suggestions.length === 0) {
            return
          }

          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveIndex((current) => (current + 1) % suggestions.length)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            commitSuggestion(activeIndex)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && suggestions.length > 0 ? (
        <div className="autocomplete-popover">
          {suggestions.slice(0, 8).map((suggestion, index) => (
            <button
              key={`${suggestion.groupId}-${suggestion.entryId}`}
              type="button"
              className={clsx('suggestion-row', index === activeIndex && 'active')}
              onMouseDown={(event) => {
                event.preventDefault()
                commitSuggestion(index)
              }}
            >
              <span>{suggestion.text}</span>
              <small>{suggestion.groupName}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
