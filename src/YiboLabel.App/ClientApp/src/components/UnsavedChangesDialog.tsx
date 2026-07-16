type UnsavedChangesDialogProps = {
  open: boolean
  title: string
  body: string
  saving: boolean
  saveLabel?: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

export function UnsavedChangesDialog({
  open,
  title,
  body,
  saving,
  saveLabel = '保存',
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps) {
  if (!open) {
    return null
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="modal-panel unsaved-changes-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-panel-body">
          <div className="modal-heading">
            <div>
              <h2 id="unsaved-changes-title">{title}</h2>
              <p>{body}</p>
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onCancel} disabled={saving}>
            取消
          </button>
          <button className="ghost-button" type="button" onClick={onDiscard} disabled={saving}>
            不保存
          </button>
          <button className="action-button" type="button" onClick={onSave} disabled={saving}>
            {saving ? '保存中...' : saveLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
