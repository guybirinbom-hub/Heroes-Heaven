import type { HostSave, HostSaveFile, HostSaveOutcome } from '../data/hostSaveContext'

/**
 * Save a text file the GM asked for — the ONE way the tracker writes a file
 * (components/hostSave.exports.test.tsx refuses any other way of handing the browser a file — an object
 * URL, a `download` name or attribute, a `data:` URL, a native save or share — anywhere else under
 * tracker/src).
 *
 *  - Inside Heroes Heaven (`hostSave`, from useHostSave): the host's own export, which saves or shares
 *    on the Android app too, where the WebView ignores an anchor download. A name the host refuses
 *    (thrown synchronously) arrives as a rejection, exactly like a failed save, so the caller has one
 *    place to say "Export failed".
 *  - Standalone (no host): a temporary object-URL anchor, clicked at once inside the caller's own click,
 *    ATTACHED to the document while it is clicked (a detached anchor's click is not a download in every
 *    browser — the encounter-table export used one) and its URL revoked a second later rather than in
 *    the same tick (revoking at once can cancel the download before the browser has read the blob).
 *
 * The file's name, text and type are the caller's, passed on untouched.
 */
export function saveTextFile(file: HostSaveFile, hostSave: HostSave | null): Promise<HostSaveOutcome> {
  if (hostSave) {
    try {
      return hostSave(file)
    } catch (e) {
      return Promise.reject(e)
    }
  }
  anchorDownload(file)
  return Promise.resolve('saved')
}

function anchorDownload({ filename, text, mime }: HostSaveFile): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
