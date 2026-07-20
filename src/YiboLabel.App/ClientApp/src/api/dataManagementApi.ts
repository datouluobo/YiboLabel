import type { DataBackupResult, DataDirectoryInfo, DataRestoreResult } from '../types'
import { fetchJson, postJson } from './http'

export function fetchDataDirectoryInfo() {
  return fetchJson<DataDirectoryInfo>('/api/data-management/directory')
}

export function createFullDataBackup() {
  return postJson<DataBackupResult>('/api/data-management/backup', {})
}

export async function restoreDataBackup(file: File) {
  const formData = new FormData()
  formData.append('backup', file)

  const response = await fetch('/api/data-management/restore', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const text = await response.text()
    try {
      const parsed = JSON.parse(text) as { error?: string }
      throw new Error(parsed.error ?? text)
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(text || '恢复备份失败。')
      }

      throw error
    }
  }

  return (await response.json()) as DataRestoreResult
}

export function openDataDirectory() {
  return postJson<{ opened: boolean }>('/api/data-management/open-directory', {})
}
