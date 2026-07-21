export {}

declare global {
  interface UpdaterEvent {
    status: 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error'
    version?: string
    percent?: number
    message?: string
  }
  interface Window {
    electronAPI?: {
      openImageWindow: (imageData: string, name: string, themeTokens?: Record<string, string>) => Promise<void>
      zoomBy: (direction: number) => void
      winMinimize: () => void
      winToggleMaximize: () => void
      winClose: () => void
      winIsMaximized: () => Promise<boolean>
      /** Subscribe to maximize-state changes; returns an unsubscribe fn. */
      onMaximizeChange: (cb: (maximized: boolean) => void) => () => void
      /** Subscribe to auto-update progress events; returns an unsubscribe fn. */
      onUpdaterEvent: (cb: (e: UpdaterEvent) => void) => () => void
      /** Quit and install a downloaded update. */
      restartToUpdate: () => Promise<void>
      openExternal: (url: string) => void
      appUninstall: () => Promise<void>
      setAppIcon: (pngBuffer: ArrayBuffer | Uint8Array) => void
    }
  }
}
