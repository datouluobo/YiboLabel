import { FilePlus2 } from 'lucide-react'
import clsx from 'clsx'
import { getTabDisplayName, type EditorTab } from '../domain/workspace'

type EditorTabStripProps = {
  tabs: EditorTab[]
  activeSurface: 'editor' | 'templates' | 'lexicons'
  activeTabId: string | null
  isTabDirty: (tab: EditorTab) => boolean
  onShowEditor: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onCreateFreshDocument: () => void
}

export function EditorTabStrip({
  tabs,
  activeSurface,
  activeTabId,
  isTabDirty,
  onShowEditor,
  onCloseTab,
  onCreateFreshDocument,
}: EditorTabStripProps) {
  return (
    <section className="tab-row">
      <div className="tab-strip" aria-label="打开的标签页">
        {tabs.length === 0 ? (
          <>
            <div className="tab-strip-empty">当前没有打开的标签页</div>
            <button className="new-tab-button" type="button" onClick={onCreateFreshDocument} title="新建标签" aria-label="新建标签">
              <FilePlus2 size={16} />
            </button>
          </>
        ) : (
          <>
            {tabs.map((tab) => {
              const tabDirty = isTabDirty(tab)
              return (
                <div key={tab.id} className={clsx('editor-tab', activeSurface === 'editor' && activeTabId === tab.id && 'active', tabDirty && 'dirty')}>
                  <button
                    className="editor-tab-trigger"
                    onClick={() => onShowEditor(tab.id)}
                    onAuxClick={(event) => {
                      if (event.button === 1) {
                        onCloseTab(tab.id)
                      }
                    }}
                  >
                    <strong>{getTabDisplayName(tab)}</strong>
                    {tabDirty ? <em className="tab-dirty" aria-label="有未保存修改" /> : null}
                  </button>
                  <button
                    className="editor-tab-close"
                    aria-label={`关闭 ${getTabDisplayName(tab)}`}
                    onClick={() => onCloseTab(tab.id)}
                  >
                    ×
                  </button>
                </div>
              )
            })}
            <button className="new-tab-button" type="button" onClick={onCreateFreshDocument} title="新建标签" aria-label="新建标签">
              <FilePlus2 size={16} />
            </button>
          </>
        )}
      </div>
    </section>
  )
}
