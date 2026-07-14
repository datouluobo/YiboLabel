import type { AppStateResponse } from '../types'
import { fetchJson } from './http'

export function fetchAppState() {
  return fetchJson<AppStateResponse>('/api/app-state')
}

export function fetchPrinters() {
  return fetchJson<AppStateResponse['printers']>('/api/printers')
}
