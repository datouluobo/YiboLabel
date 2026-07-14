import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { LexiconEntry, LexiconGroup, LexiconLibrary } from '../types'

type LexiconManagerProps = {
  library: LexiconLibrary
  activeGroup: LexiconGroup | null
  filteredEntries: LexiconEntry[]
  query: string
  onQueryChange: (query: string) => void
  onSelectGroup: (group: LexiconGroup) => void
  onCreateGroup: () => void
  onRenameGroup: (group: LexiconGroup) => void
  onDeleteGroup: (group: LexiconGroup) => void
  onCreateEntry: () => void
  onUpdateEntry: (entry: LexiconEntry, text: string) => void
  onDeleteEntry: (entry: LexiconEntry) => void
}

export function LexiconManager({
  library,
  activeGroup,
  filteredEntries,
  query,
  onQueryChange,
  onSelectGroup,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onCreateEntry,
  onUpdateEntry,
  onDeleteEntry,
}: LexiconManagerProps) {
  const groups = library.lexicons.flatMap((lexicon) => lexicon.groups)
  const totalEntries = groups.reduce((sum, group) => sum + group.entries.length, 0)

  return (
    <section className="canvas-panel lexicon-workspace">
      <div className="panel-heading template-browser-head">
        <div>
          <span>词库</span>
          <p className="panel-note">管理可绑定到文本、条码和二维码对象的分组与条目。</p>
        </div>
        <div className="canvas-metrics lexicon-metrics">
          <div>
            <span>分组</span>
            <strong>{groups.length}</strong>
          </div>
          <div>
            <span>条目</span>
            <strong>{totalEntries}</strong>
          </div>
        </div>
      </div>

      <div className="lexicon-manager-grid">
        <section className="lexicon-column">
          <div className="lexicon-column-head">
            <strong>分组</strong>
            <button className="mini-button" type="button" onClick={onCreateGroup}>
              新增
            </button>
          </div>
          <div className="lexicon-list">
            {groups.length === 0 ? (
              <p className="empty-note">还没有分组。</p>
            ) : (
              groups.map((group) => (
                <button
                  key={group.id}
                  className={clsx('lexicon-list-item', activeGroup?.id === group.id && 'active')}
                  type="button"
                  onClick={() => onSelectGroup(group)}
                >
                  <strong>{group.name}</strong>
                  <span>{group.entries.length} 条</span>
                </button>
              ))
            )}
          </div>
          {activeGroup ? (
            <div className="lexicon-actions">
              <button className="mini-button" type="button" onClick={() => onRenameGroup(activeGroup)}>
                重命名
              </button>
              <button className="mini-button" type="button" onClick={() => onDeleteGroup(activeGroup)}>
                删除
              </button>
            </div>
          ) : null}
        </section>

        <section className="lexicon-column lexicon-entry-column">
          <div className="lexicon-column-head">
            <strong>{activeGroup ? `${activeGroup.name} 条目` : '条目'}</strong>
            <button className="mini-button" type="button" onClick={onCreateEntry} disabled={!activeGroup}>
              新增
            </button>
          </div>
          <label className="lexicon-search">
            搜索条目
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="按内容筛选" disabled={!activeGroup} />
          </label>
          <div className="lexicon-entry-list">
            {!activeGroup ? (
              <p className="empty-note">先选择一个分组。</p>
            ) : filteredEntries.length === 0 ? (
              <p className="empty-note">没有匹配的条目。</p>
            ) : (
              filteredEntries.map((entry) => (
                <LexiconEntryRow
                  key={entry.id}
                  entry={entry}
                  onUpdate={(text) => onUpdateEntry(entry, text)}
                  onDelete={() => onDeleteEntry(entry)}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  )
}

function LexiconEntryRow({ entry, onUpdate, onDelete }: { entry: LexiconEntry; onUpdate: (text: string) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState(entry.text)

  useEffect(() => {
    setDraft(entry.text)
  }, [entry.text])

  return (
    <div className="lexicon-entry-row">
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onUpdate(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(entry.text)
            event.currentTarget.blur()
          }
        }}
      />
      <button className="mini-button" type="button" onClick={onDelete}>
        删除
      </button>
    </div>
  )
}
