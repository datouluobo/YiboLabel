import type { PrintRequest, PrintResult } from '../types'
import { postJson } from './http'

export function printDocument(request: PrintRequest) {
  return postJson<PrintResult>('/api/print', request)
}
