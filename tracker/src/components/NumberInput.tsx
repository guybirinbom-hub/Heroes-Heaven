import { type CSSProperties, forwardRef } from 'react'

interface NumberInputProps {
  value: number | string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  /** Optional — called when the user clicks ↑ or ↓ with the new value (clamped). */
  onStep?: (next: number) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  className?: string
  style?: CSSProperties
  disabled?: boolean
  autoFocus?: boolean
  onBlur?: React.FocusEventHandler<HTMLInputElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  onClick?: React.MouseEventHandler<HTMLInputElement>
  title?: string
}

/**
 * Themed number input that replaces the browser-default up/down spinners
 * with small gold-tinted chevron buttons matching the rest of the UI.
 *
 * Pass `onStep` to receive the clamped target value when the user clicks
 * one of the buttons. Otherwise the buttons just nudge the input value
 * the same way the keyboard arrow keys would.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(props, ref) {
  const {
    value, onChange, onStep,
    min, max, step = 1,
    placeholder, className = 'input-dark', style, disabled,
    autoFocus, onBlur, onKeyDown, onClick, title,
  } = props

  const numericValue = typeof value === 'number'
    ? value
    : (parseFloat(value as string) || 0)

  const clamp = (n: number) =>
    Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n))

  const bump = (dir: 1 | -1) => {
    const next = clamp(numericValue + dir * step)
    if (onStep) {
      onStep(next)
    } else {
      // Synthesize a change event so callers using onChange still work
      onChange({
        target: { value: String(next) },
        currentTarget: { value: String(next) },
      } as unknown as React.ChangeEvent<HTMLInputElement>)
    }
  }

  return (
    <span className="num-stepper" style={style}>
      <input
        ref={ref}
        type="number"
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        autoFocus={autoFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onClick={onClick}
        title={title}
      />
      <span className="num-stepper-buttons" aria-hidden="true">
        <button type="button" tabIndex={-1}
          onMouseDown={e => { e.preventDefault(); bump(1) }}
          title="Increase">
          <svg width="9" height="6" viewBox="0 0 9 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 5 L4.5 1 L8 5" />
          </svg>
        </button>
        <button type="button" tabIndex={-1}
          onMouseDown={e => { e.preventDefault(); bump(-1) }}
          title="Decrease">
          <svg width="9" height="6" viewBox="0 0 9 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 1 L4.5 5 L8 1" />
          </svg>
        </button>
      </span>
    </span>
  )
})
