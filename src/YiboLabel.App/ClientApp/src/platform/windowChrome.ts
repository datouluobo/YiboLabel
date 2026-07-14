export type WindowChromeCommand = 'drag' | 'toggle-maximize' | 'minimize' | 'close'

export function sendWindowChromeCommand(command: WindowChromeCommand) {
  const chromeBridge = (window as typeof window & { chrome?: { webview?: { postMessage: (message: unknown) => void } } }).chrome?.webview
  chromeBridge?.postMessage({ type: 'window-chrome', command })
}
