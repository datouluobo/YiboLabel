import {
  createLexiconEntry as createLexiconEntryRequest,
  createLexiconGroup as createLexiconGroupRequest,
  deleteLexiconEntry as deleteLexiconEntryRequest,
  deleteLexiconGroup as deleteLexiconGroupRequest,
  moveLexiconEntry as moveLexiconEntryRequest,
  moveLexiconGroup as moveLexiconGroupRequest,
  renameLexiconGroup as renameLexiconGroupRequest,
  updateLexiconEntry as updateLexiconEntryRequest,
} from '../api/lexiconsApi'
import { getErrorMessage } from '../api/http'
import type { LexiconLibrary } from '../types'

type UseLexiconSidebarActionsArgs = {
  lexiconLibrary: LexiconLibrary
  activeLexiconId: string | null
  activeSidebarGroupId: string | null
  setActiveLexiconId: (value: string) => void
  setActiveSidebarGroupId: (value: string | null) => void
  setStatus: (value: string) => void
  refreshLexiconGroups: () => Promise<void>
}

export function useLexiconSidebarActions({
  lexiconLibrary,
  activeLexiconId,
  activeSidebarGroupId,
  setActiveLexiconId,
  setActiveSidebarGroupId,
  setStatus,
  refreshLexiconGroups,
}: UseLexiconSidebarActionsArgs) {
  function findLexiconGroupById(groupId: string) {
    for (const lexicon of lexiconLibrary.lexicons) {
      const group = lexicon.groups.find((item) => item.id === groupId)
      if (group) {
        return { lexicon, group }
      }
    }
    return null
  }

  function findLexiconEntryById(groupId: string, entryId: string) {
    const resolved = findLexiconGroupById(groupId)
    if (!resolved) {
      return null
    }

    const entry = resolved.group.entries.find((item) => item.id === entryId) ?? null
    return entry ? { ...resolved, entry } : null
  }

  async function createSidebarLexiconGroup() {
    const targetLexicon = lexiconLibrary.lexicons.find((lexicon) => lexicon.id === activeLexiconId) ?? lexiconLibrary.lexicons[0] ?? null
    if (!targetLexicon) {
      setStatus('词库尚未初始化。')
      return
    }

    const name = window.prompt('分组名称', '新分组')?.trim()
    if (!name) {
      return
    }

    try {
      const created = await createLexiconGroupRequest(targetLexicon.id, name)
      await refreshLexiconGroups()
      setActiveLexiconId(targetLexicon.id)
      setActiveSidebarGroupId(created.id)
      setStatus(`已创建分组：${created.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function renameSidebarLexiconGroup(groupId: string) {
    const resolved = findLexiconGroupById(groupId)
    if (!resolved) {
      setStatus('未找到要重命名的分组。')
      return
    }

    const name = window.prompt('分组名称', resolved.group.name)?.trim()
    if (!name || name === resolved.group.name) {
      return
    }

    try {
      const saved = await renameLexiconGroupRequest(resolved.lexicon.id, resolved.group.id, name)
      await refreshLexiconGroups()
      setActiveLexiconId(resolved.lexicon.id)
      setActiveSidebarGroupId(saved.id)
      setStatus(`已重命名分组：${saved.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function deleteSidebarLexiconGroup(groupId: string) {
    const resolved = findLexiconGroupById(groupId)
    if (!resolved) {
      setStatus('未找到要删除的分组。')
      return
    }

    const confirmed = window.confirm(`确认删除分组“${resolved.group.name}”？其中的条目也会一并删除。`)
    if (!confirmed) {
      return
    }

    try {
      await deleteLexiconGroupRequest(resolved.lexicon.id, resolved.group.id)
      await refreshLexiconGroups()
      setActiveLexiconId(resolved.lexicon.id)
      if (activeSidebarGroupId === groupId) {
        setActiveSidebarGroupId(null)
      }
      setStatus(`已删除分组：${resolved.group.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function moveSidebarLexiconGroup(movingGroupId: string, anchorGroupId: string, placement: 'before' | 'after') {
    const moving = findLexiconGroupById(movingGroupId)
    const anchor = findLexiconGroupById(anchorGroupId)
    if (!moving || !anchor || moving.lexicon.id !== anchor.lexicon.id || moving.group.id === anchor.group.id) {
      return
    }

    try {
      await moveLexiconGroupRequest(moving.lexicon.id, moving.group.id, anchor.group.id, placement)
      await refreshLexiconGroups()
      setActiveLexiconId(moving.lexicon.id)
      setActiveSidebarGroupId(moving.group.id)
      setStatus(`已调整分组顺序：${moving.group.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function createSidebarLexiconEntry(groupId: string) {
    const resolved = findLexiconGroupById(groupId)
    if (!resolved) {
      setStatus('请先选择一个分组。')
      return
    }

    const text = window.prompt('条目内容')?.trim()
    if (!text) {
      return
    }

    try {
      await createLexiconEntryRequest(resolved.lexicon.id, resolved.group.id, text)
      await refreshLexiconGroups()
      setActiveLexiconId(resolved.lexicon.id)
      setActiveSidebarGroupId(resolved.group.id)
      setStatus('已添加词库条目。')
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function renameSidebarLexiconEntry(groupId: string, entryId: string) {
    const resolved = findLexiconEntryById(groupId, entryId)
    if (!resolved) {
      setStatus('未找到要重命名的条目。')
      return
    }

    const text = window.prompt('条目内容', resolved.entry.text)?.trim()
    if (!text || text === resolved.entry.text) {
      return
    }

    try {
      await updateLexiconEntryRequest(resolved.lexicon.id, resolved.group.id, resolved.entry.id, text)
      await refreshLexiconGroups()
      setActiveLexiconId(resolved.lexicon.id)
      setActiveSidebarGroupId(resolved.group.id)
      setStatus('已更新词库条目。')
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function deleteSidebarLexiconEntry(groupId: string, entryId: string) {
    const resolved = findLexiconEntryById(groupId, entryId)
    if (!resolved) {
      setStatus('未找到要删除的条目。')
      return
    }

    const confirmed = window.confirm(`确认删除条目“${resolved.entry.text}”？`)
    if (!confirmed) {
      return
    }

    try {
      await deleteLexiconEntryRequest(resolved.lexicon.id, resolved.group.id, resolved.entry.id)
      await refreshLexiconGroups()
      setActiveLexiconId(resolved.lexicon.id)
      setActiveSidebarGroupId(resolved.group.id)
      setStatus('已删除词库条目。')
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function moveSidebarLexiconEntry(sourceGroupId: string, movingEntryId: string, targetGroupId: string, anchorEntryId: string | null, placement: 'before' | 'after') {
    const resolved = findLexiconEntryById(sourceGroupId, movingEntryId)
    const target = findLexiconGroupById(targetGroupId)
    const anchor = anchorEntryId ? findLexiconEntryById(targetGroupId, anchorEntryId) : null
    if (!resolved || !target || (anchorEntryId && !anchor) || (resolved.group.id === target.group.id && resolved.entry.id === anchorEntryId)) {
      return
    }

    try {
      await moveLexiconEntryRequest(resolved.lexicon.id, resolved.group.id, resolved.entry.id, anchorEntryId, placement, target.group.id)
      await refreshLexiconGroups()
      setActiveLexiconId(resolved.lexicon.id)
      setActiveSidebarGroupId(target.group.id)
      setStatus('已调整条目顺序。')
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  return {
    createSidebarLexiconGroup,
    renameSidebarLexiconGroup,
    deleteSidebarLexiconGroup,
    moveSidebarLexiconGroup,
    createSidebarLexiconEntry,
    renameSidebarLexiconEntry,
    deleteSidebarLexiconEntry,
    moveSidebarLexiconEntry,
  }
}
