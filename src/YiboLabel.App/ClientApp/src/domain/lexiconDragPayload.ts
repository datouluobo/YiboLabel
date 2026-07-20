export type LexiconDragPayload =
  | { kind: 'group'; groupId: string }
  | { kind: 'entry'; text: string; groupId: string | null }

let currentLexiconDragPayload: LexiconDragPayload | null = null

export function setLexiconDragPayload(payload: LexiconDragPayload | null) {
  currentLexiconDragPayload = payload
}

export function getLexiconDragPayload() {
  return currentLexiconDragPayload
}
