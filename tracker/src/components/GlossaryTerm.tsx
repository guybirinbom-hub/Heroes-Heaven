import type { CSSProperties } from 'react'
import { Tooltip } from './Tooltip'
import { PopupPreview } from './FloatingWindow'
import { useWindowStore } from '../store/windowStore'
import { GLOSSARY } from '../data/glossary'

// Inline term backed by the static glossary (damage categories, materials,
// senses, sizes). Hover shows the framed popup and clicking opens a floating
// window — the same affordance as trait/condition references. The trigger
// wrapper itself takes `linkStyle`, so a size pill stays aligned with its
// siblings instead of nesting a styled span inside the tooltip wrapper.
export function GlossaryTerm({ gkey, label, linkStyle }: {
  gkey: string
  label: string
  linkStyle?: CSSProperties
}) {
  const openWin = useWindowStore(s => s.open)
  const entry = GLOSSARY[gkey]
  if (!entry) return <span style={linkStyle}>{label}</span>
  return (
    <Tooltip
      style={linkStyle}
      content={<PopupPreview type="glossary" ref_={gkey} title={entry.title} />}
      onActivate={pos => openWin('glossary', gkey, entry.title, pos.x, pos.y, { noCascade: true })}
    >{label}</Tooltip>
  )
}
