import type {
  DocumentSpecPresetSummary,
  PrinterCalibrationRecord,
  SaveDocumentSpecPresetRequest,
  SavePrinterCalibrationRequest,
  UpdateDocumentSpecPresetRequest,
} from '../types'
import { deleteJson, fetchJson, postJson, putJson } from './http'

export function fetchDocumentSpecPresets(includeHidden = false) {
  return fetchJson<DocumentSpecPresetSummary[]>(`/api/document-spec-presets?includeHidden=${includeHidden ? 'true' : 'false'}`)
}

export function createDocumentSpecPreset(request: SaveDocumentSpecPresetRequest) {
  return postJson<DocumentSpecPresetSummary>('/api/document-spec-presets', request)
}

export function updateDocumentSpecPreset(id: string, request: UpdateDocumentSpecPresetRequest) {
  return putJson<DocumentSpecPresetSummary>(`/api/document-spec-presets/${id}`, request)
}

export function deleteDocumentSpecPreset(id: string) {
  return deleteJson(`/api/document-spec-presets/${id}`)
}

export function fetchPrinterCalibrations(devicePath: string) {
  return fetchJson<PrinterCalibrationRecord[]>(`/api/printer-calibrations?devicePath=${encodeURIComponent(devicePath)}`)
}

export function savePrinterCalibration(request: SavePrinterCalibrationRequest) {
  return putJson<PrinterCalibrationRecord>('/api/printer-calibrations', request)
}

export function deletePrinterCalibration(devicePath: string, calibrationId: string) {
  return deleteJson(`/api/printer-calibrations/${encodeURIComponent(calibrationId)}?devicePath=${encodeURIComponent(devicePath)}`)
}
