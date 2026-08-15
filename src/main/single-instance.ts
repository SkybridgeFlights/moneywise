export interface SingleInstanceWindow {
  isMinimized(): boolean
  restore(): void
  focus(): void
}

export interface SingleInstanceApplication {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', listener: () => void): void
}

export function configureSingleInstance(
  application: SingleInstanceApplication,
  getWindows: () => SingleInstanceWindow[]
): boolean {
  if (!application.requestSingleInstanceLock()) {
    application.quit()
    return false
  }

  application.on('second-instance', () => {
    const window = getWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  return true
}
