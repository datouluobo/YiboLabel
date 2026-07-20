export type LexiconActionSource = 'button' | 'drag-drop' | 'popover'

export type LexiconActionRecord =
  | {
      kind: 'bind-group'
      tabId: string
      elementId: string
      elementName: string
      groupId: string
      groupName: string
      source: LexiconActionSource
    }
  | {
      kind: 'unbind-group'
      tabId: string
      elementId: string
      elementName: string
      groupId: string
      groupName: string
      source: LexiconActionSource
    }
  | {
      kind: 'apply-entry'
      tabId: string
      elementId: string
      elementName: string
      groupId: string | null
      groupName: string | null
      entryText: string
      previousValue: string
      nextValue: string
      source: LexiconActionSource
    }
