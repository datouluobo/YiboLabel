export type ElementType = 'text' | 'barcode' | 'qrcode' | 'line' | 'rectangle' | 'image'

export interface PrinterEndpoint {
  id: string
  displayName: string
  devicePath: string
  driverName: string
  isAvailable: boolean
  statusMessage: string
}

export interface AppStateResponse {
  appName: string
  appVersion: string
  printers: PrinterEndpoint[]
  defaultWidthMm: number
  defaultHeightMm: number
  dpi: number
}

export interface LabelTemplateSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  widthMm: number
  heightMm: number
  elementCount: number
}

export interface LabelTemplateRecord {
  id: string
  schemaVersion: number
  name: string
  createdAt: string
  updatedAt: string
  document: LabelDocument
}

export interface LabelDocument {
  name: string
  widthMm: number
  heightMm: number
  printerDevicePath?: string | null
  copies: number
  darkness: number
  gapMm: number
  printRotation: number
  printInvert: boolean
  printOffsetXMm: number
  printOffsetYMm: number
  elements: LabelElement[]
}

export interface BaseElement {
  id: string
  type: ElementType
  name?: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  locked?: boolean
  hidden?: boolean
  zIndex?: number
  lexiconGroupIds?: string[]
  defaultLexiconGroupId?: string | null
}

export interface TextElement extends BaseElement {
  type: 'text'
  text: string
  fontSize: number
  fontFamily: string
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
}

export interface BarcodeElement extends BaseElement {
  type: 'barcode'
  value: string
  symbology: string
  showHumanReadable: boolean
  textPosition: 'bottom' | 'top'
  humanReadableFontSize: number
  humanReadableFontFamily: string
}

export interface QrCodeElement extends BaseElement {
  type: 'qrcode'
  value: string
  showHumanReadable: boolean
  textPosition: 'bottom' | 'top'
  humanReadableFontSize: number
  humanReadableFontFamily: string
}

export interface LineElement extends BaseElement {
  type: 'line'
  thickness: number
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle'
  thickness: number
}

export interface ImageElement extends BaseElement {
  type: 'image'
  dataUrl: string
  invert: boolean
}

export type LabelElement =
  | TextElement
  | BarcodeElement
  | QrCodeElement
  | LineElement
  | RectangleElement
  | ImageElement

export interface SaveTemplateRequest {
  name: string
  document: LabelDocument
}

export interface RenameTemplateRequest {
  name: string
}

export interface DuplicateTemplateRequest {
  name?: string
}

export interface PrintRequest {
  document: LabelDocument
  devicePathOverride?: string
}

export interface PrintResult {
  devicePath: string
  copies: number
  tsplPath: string
  agentOutput: string
}

export interface LexiconGroupSummary {
  id: string
  lexiconId: string
  lexiconName: string
  name: string
  entryCount: number
}

export interface LexiconLibrary {
  schemaVersion: number
  lexicons: Lexicon[]
}

export interface Lexicon {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  groups: LexiconGroup[]
}

export interface LexiconGroup {
  id: string
  lexiconId: string
  name: string
  createdAt: string
  updatedAt: string
  entries: LexiconEntry[]
}

export interface LexiconEntry {
  id: string
  text: string
  createdAt: string
  updatedAt: string
}

export interface LexiconSuggestion {
  entryId: string
  text: string
  groupId: string
  groupName: string
  lexiconId: string
  lexiconName: string
}
