import type {
  LexiconEntry,
  LexiconGroup,
  LexiconGroupSummary,
  LexiconLibrary,
  LexiconSuggestion,
} from '../types'
import { deleteJson, fetchJson, postJson, putJson } from './http'

export function fetchLexiconGroups() {
  return fetchJson<LexiconGroupSummary[]>('/api/lexicon-groups')
}

export function fetchLexiconLibrary() {
  return fetchJson<LexiconLibrary>('/api/lexicons')
}

export function fetchLexiconSuggestions(groupIds: string[], query: string, signal?: AbortSignal) {
  const groupKey = groupIds.join(',')
  return fetchJson<LexiconSuggestion[]>(
    `/api/lexicon-suggestions?groups=${encodeURIComponent(groupKey)}&q=${encodeURIComponent(query)}`,
    signal,
  )
}

export function createLexiconGroup(lexiconId: string, name: string) {
  return postJson<LexiconGroup>(`/api/lexicons/${lexiconId}/groups`, { name })
}

export function renameLexiconGroup(lexiconId: string, groupId: string, name: string) {
  return putJson<LexiconGroup>(`/api/lexicons/${lexiconId}/groups/${groupId}`, { name })
}

export function deleteLexiconGroup(lexiconId: string, groupId: string) {
  return deleteJson(`/api/lexicons/${lexiconId}/groups/${groupId}`)
}

export function moveLexiconGroup(lexiconId: string, groupId: string, anchorId: string, placement: 'before' | 'after') {
  return postJson<void>(`/api/lexicons/${lexiconId}/groups/${groupId}/move`, { anchorId, placement })
}

export function createLexiconEntry(lexiconId: string, groupId: string, text: string) {
  return postJson<LexiconEntry>(`/api/lexicons/${lexiconId}/groups/${groupId}/entries`, { text })
}

export function updateLexiconEntry(lexiconId: string, groupId: string, entryId: string, text: string) {
  return putJson<LexiconEntry>(`/api/lexicons/${lexiconId}/groups/${groupId}/entries/${entryId}`, { text })
}

export function deleteLexiconEntry(lexiconId: string, groupId: string, entryId: string) {
  return deleteJson(`/api/lexicons/${lexiconId}/groups/${groupId}/entries/${entryId}`)
}

export function moveLexiconEntry(
  lexiconId: string,
  groupId: string,
  entryId: string,
  anchorId: string | null,
  placement: 'before' | 'after',
  targetGroupId?: string,
) {
  return postJson<void>(`/api/lexicons/${lexiconId}/groups/${groupId}/entries/${entryId}/move`, { anchorId, placement, targetGroupId })
}
