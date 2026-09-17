import { useEffect, useState } from 'react'
import { DELAY_MIME } from './components/InitiativeTracker'

/**
 * True from the moment a Delay drag starts until it ends, anywhere on the page.
 *
 * A Delay area that only exists while it is worth existing has to know a drag is coming BEFORE the
 * pointer reaches it — dragover is too late, there would be nothing under the pointer to fire it.
 * The drag starts on an initiative row, which knows nothing about whichever host draws the area, so
 * the signal is read where every dragstart passes anyway: the document. Filtered by DELAY_MIME, so
 * dragging a party card or a stat block around doesn't flash an area that would refuse the drop.
 *
 * Lives beside the two hosts that draw an area (Heroes Heaven's campaign rail and the standalone
 * app's strip) rather than inside either, for the same reason useDelayDropZone does: one
 * implementation is one behaviour.
 */
export function useDelayDragActive(): boolean {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const start = (e: DragEvent) => {
      // The row sets its payload in its own dragstart handler, which React runs at the root
      // container — below this one, so by now the types are written.
      if (e.dataTransfer?.types.includes(DELAY_MIME)) setActive(true)
    }
    const end = () => setActive(false)
    // Two endings, because neither one alone covers every drag:
    //  - 'drop' is the ending of the drag that WORKED, and it has to be listened for here because a
    //    successful delay drop takes the acting creature out of the order — React unmounts the very
    //    row that started the drag, and the browser then fires its dragend AT THAT DETACHED NODE,
    //    where it bubbles to nothing and never reaches this listener. Without this line `active`
    //    would stay true for the rest of the session and the empty area would be back on the rail
    //    the moment the creature returned — the thing the owner asked to remove. The drop itself
    //    bubbles from the still-attached zone, before the unmount.
    //  - 'dragend' is the ending of the drag that did NOT drop: Esc, off-window, released over
    //    nothing. No drop fires there, and the source is still attached, so it reaches document.
    document.addEventListener('dragstart', start)
    document.addEventListener('dragend', end)
    document.addEventListener('drop', end)
    return () => {
      document.removeEventListener('dragstart', start)
      document.removeEventListener('dragend', end)
      document.removeEventListener('drop', end)
    }
  }, [])
  return active
}
