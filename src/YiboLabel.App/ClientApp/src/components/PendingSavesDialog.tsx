type PendingSaveItem = {
  tabId: string
  name: string
  kindLabel: string
  dirty: boolean
}

type PendingSavesDialogProps = {
  open: boolean
  items: PendingSaveItem[]
  saving: boolean
  onSaveAll: () => void
  onReviewOneByOne: () => void
  onDiscardAndExit: () => void
  onCancel: () => void
}

export function PendingSavesDialog({
  open,
  items,
  saving,
  onSaveAll,
  onReviewOneByOne,
  onDiscardAndExit,
  onCancel,
}: PendingSavesDialogProps) {
  if (!open) {
    return null
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="modal-panel pending-saves-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-saves-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-panel-body">
          <div className="modal-heading">
            <div>
              <h2 id="pending-saves-title">退出前还有未保存内容</h2>
              <p>下面这些标签仍有修改。你可以全部保存、逐个处理，或放弃修改后退出。</p>
            </div>
          </div>
          <div className="pending-saves-list" role="list">
            {items.map((item) => (
              <div key={item.tabId} className="pending-save-item" role="listitem">
                <strong>{item.kindLabel}</strong>
                <span title={item.name}>{item.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onCancel} disabled={saving}>
            取消
          </button>
          <button className="ghost-button" type="button" onClick={onDiscardAndExit} disabled={saving}>
            放弃并退出
          </button>
          <button className="ghost-button" type="button" onClick={onReviewOneByOne} disabled={saving}>
            逐个处理
          </button>
          <button className="action-button" type="button" onClick={onSaveAll} disabled={saving}>
            {saving ? '保存中...' : '全部保存'}
          </button>
        </div>
      </section>
    </div>
  )
}
