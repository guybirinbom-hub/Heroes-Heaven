import { useEffect, useState } from 'react'

// ── Auto-update toast ──────────────────────────────────────────────────────
// Bottom-right notice driven by electron-updater events from the main process.
// Shows a download-progress bar, then a "restart to update" prompt once the
// new version is ready. Silent for checking / up-to-date / error states.

export function UpdateNotice() {
  const [evt, setEvt] = useState<UpdaterEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onUpdaterEvent) return
    return api.onUpdaterEvent(e => {
      setEvt(e)
      if (e.status === 'downloading' || e.status === 'downloaded') setDismissed(false)
    })
  }, [])

  if (!evt || dismissed) return null
  const downloading = evt.status === 'downloading'
  const ready = evt.status === 'downloaded'
  if (!downloading && !ready) return null

  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 16, zIndex: 4000,
      width: 300,
      background: 'var(--bg-panel)',
      border: 'var(--app-bw) solid var(--border-strong)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-lg)',
      padding: '14px 16px',
      fontFamily: 'var(--font-ui)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span className="page-title-display" style={{ fontSize: 14, fontWeight: 600 }}>
          {ready ? 'Update ready' : 'Downloading update…'}
        </span>
        {evt.version && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>
            v{evt.version}
          </span>
        )}
      </div>

      {downloading && (
        <>
          <div style={{
            height: 8, borderRadius: 4, overflow: 'hidden',
            background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border)',
          }}>
            <div style={{
              height: '100%', width: `${evt.percent ?? 0}%`,
              background: 'var(--accent)', transition: 'width 0.2s ease',
            }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
            {evt.percent ?? 0}%
          </div>
        </>
      )}

      {ready && (
        <>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
            A new version has been downloaded. Restart to finish installing.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setDismissed(true)}>Later</button>
            <button className="btn btn-primary btn-sm"
              onClick={() => window.electronAPI?.restartToUpdate?.()}>
              Restart now
            </button>
          </div>
        </>
      )}
    </div>
  )
}
