export type WindowChromeCommand = 'drag' | 'toggle-maximize' | 'minimize' | 'close' | 'force-close' | 'cancel-close' | 'sync-state' | 'system-menu'

type WindowChromeDragPayload = {
  screenX: number
  screenY: number
}

export type WindowChromeBridgeMessage =
  | {
      type: 'window-chrome'
      command: 'request-close'
    }
  | {
      type: 'window-chrome'
      command: 'state-changed'
      isMaximized: boolean
    }

export function sendWindowChromeCommand(command: WindowChromeCommand, payload?: WindowChromeDragPayload) {
  const chromeBridge = getWindowChromeBridge()
  chromeBridge?.postMessage({ type: 'window-chrome', command, ...payload })
}

export function subscribeWindowChromeMessages(listener: (message: WindowChromeBridgeMessage) => void) {
  const chromeBridge = getWindowChromeBridge()
  if (!chromeBridge?.addEventListener) {
    return () => undefined
  }

  const handleMessage = (event: MessageEvent) => {
    const data = event.data as WindowChromeBridgeMessage | undefined
    if (data?.type !== 'window-chrome') {
      return
    }

    listener(data)
  }

  chromeBridge.addEventListener('message', handleMessage)
  return () => chromeBridge.removeEventListener?.('message', handleMessage)
}

function getWindowChromeBridge() {
  return (window as typeof window & {
    chrome?: {
      webview?: {
        postMessage: (message: unknown) => void
        addEventListener?: (type: 'message', listener: (event: MessageEvent) => void) => void
        removeEventListener?: (type: 'message', listener: (event: MessageEvent) => void) => void
      }
    }
  }).chrome?.webview
}
