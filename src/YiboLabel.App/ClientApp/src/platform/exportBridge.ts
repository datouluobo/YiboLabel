type DesktopExportRequest =
  | {
      type: 'export-save-dialog'
      requestId: string
      format: ExportFormat
      suggestedName: string
    }
  | {
      type: 'export-write-file'
      requestId: string
      path: string
      contentKind: 'text'
      contentText: string
    }
  | {
      type: 'export-write-file'
      requestId: string
      path: string
      contentKind: 'base64'
      contentBase64: string
    }
  | {
      type: 'export-print-pdf'
      requestId: string
      path: string
      pageWidthMm: number
      pageHeightMm: number
      orientation: 'portrait' | 'landscape'
    }

type DesktopExportResponse<TPayload> = {
  type: string
  requestId: string
  payload: TPayload
}

export type ExportFormat = 'template' | 'png' | 'jpg' | 'pdf'

export type SaveDialogResult = {
  success: boolean
  cancelled?: boolean
  path?: string
  fileName?: string
  error?: string
}

type BasicResult = {
  success: boolean
  error?: string
}

const pendingRequests = new Map<string, {
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
}>()

let listenerInitialized = false

export async function chooseExportPath(format: ExportFormat, suggestedName: string) {
  return sendDesktopExportRequest<SaveDialogResult>({
    type: 'export-save-dialog',
    requestId: createRequestId(),
    format,
    suggestedName,
  })
}

export async function writeTextExportFile(path: string, contentText: string) {
  await assertSuccessful(
    sendDesktopExportRequest<BasicResult>({
      type: 'export-write-file',
      requestId: createRequestId(),
      path,
      contentKind: 'text',
      contentText,
    }),
  )
}

export async function writeBase64ExportFile(path: string, contentBase64: string) {
  await assertSuccessful(
    sendDesktopExportRequest<BasicResult>({
      type: 'export-write-file',
      requestId: createRequestId(),
      path,
      contentKind: 'base64',
      contentBase64,
    }),
  )
}

export async function printPdfExport(path: string, pageWidthMm: number, pageHeightMm: number, orientation: 'portrait' | 'landscape') {
  await assertSuccessful(
    sendDesktopExportRequest<BasicResult>({
      type: 'export-print-pdf',
      requestId: createRequestId(),
      path,
      pageWidthMm,
      pageHeightMm,
      orientation,
    }),
  )
}

function sendDesktopExportRequest<TPayload>(request: DesktopExportRequest): Promise<TPayload> {
  const webview = getWebViewBridge()
  if (!webview) {
    return Promise.reject(new Error('当前运行环境不支持原生保存对话框。请在 YiboLabel 桌面应用中导出。'))
  }

  ensureExportListener()
  return new Promise<TPayload>((resolve, reject) => {
    pendingRequests.set(request.requestId, {
      resolve: (payload) => resolve(payload as TPayload),
      reject,
    })
    webview.postMessage(request)
  })
}

async function assertSuccessful(resultPromise: Promise<BasicResult>) {
  const result = await resultPromise
  if (!result.success) {
    throw new Error(result.error ?? '导出失败。')
  }
}

function ensureExportListener() {
  if (listenerInitialized) {
    return
  }

  listenerInitialized = true
  const webview = getWebViewBridge()
  webview?.addEventListener('message', (event) => {
    const response = event.data as DesktopExportResponse<unknown>
    if (!response?.requestId || !response.type?.startsWith('export-')) {
      return
    }

    const pending = pendingRequests.get(response.requestId)
    if (!pending) {
      return
    }

    pendingRequests.delete(response.requestId)
    const payload = response.payload as { success?: boolean; error?: string }
    if (payload?.success === false) {
      pending.reject(new Error(payload.error ?? '导出失败。'))
      return
    }

    pending.resolve(response.payload)
  })
}

function getWebViewBridge() {
  return (window as typeof window & {
    chrome?: {
      webview?: {
        postMessage: (message: unknown) => void
        addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
      }
    }
  }).chrome?.webview
}

function createRequestId() {
  return crypto.randomUUID()
}
