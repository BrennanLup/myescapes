/**
 * The 1-100 score slider of the review forms (desktop confirm overlay and the phone log flow).
 *
 * A native range input can't show "no value": it always has a thumb somewhere, and at 50 a
 * score nobody set looked like a 50. So while the score is unset the input stays in place (same
 * element, so a drag that starts there keeps going) but is see-through, over an empty dashed track
 * with a "Tap to rate" hint. The first tap, drag or arrow key sets the score and the normal slider
 * appears. Light: no three.js, the phone imports it.
 */

export interface ScoreSliderProps {
  value: number | null
  onChange(score: number): void
  /** Accessible name, e.g. "Overall slider". */
  label: string
  testId?: string
  /** Hint shown on the empty track. */
  hint?: string
  /** The field's error is showing: marks the slider invalid and points it at the error text. */
  invalid?: boolean
  /** id of the error text that describes the slider. */
  describedBy?: string
}

export function ScoreSlider({ value, onChange, label, testId, hint = 'Tap to rate', invalid, describedBy }: ScoreSliderProps) {
  const unset = value === null
  return (
    <div
      className="relative flex h-10 min-w-0 flex-1 items-center rounded-full focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-accent/70"
      data-unset={unset ? 'true' : 'false'}
    >
      {unset && (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center">
          <span className="absolute inset-x-1 h-2 rounded-full border-2 border-dashed border-panel-edge bg-white/60" />
          <span className="relative rounded-full border-2 border-panel-edge bg-panel px-2.5 py-0.5 text-xs font-bold text-ink-soft" data-testid={testId ? `${testId}-hint` : undefined}>
            {hint}
          </span>
        </span>
      )}
      <input
        type="range"
        min={1}
        max={100}
        aria-label={label}
        aria-valuetext={unset ? 'Not rated yet' : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        data-testid={testId}
        // Unset: the thumb waits in the middle, invisible, so any tap or drag lands on a value.
        value={value ?? 50}
        className={'relative h-10 w-full cursor-pointer accent-accent outline-none ' + (unset ? 'opacity-0' : '')}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        // A tap exactly on the hidden thumb (50) changes nothing, so no change event: set it here.
        onPointerUp={(e) => {
          if (unset) onChange(Number(e.currentTarget.value))
        }}
        onKeyDown={(e) => {
          if (unset && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onChange(50)
          }
        }}
      />
    </div>
  )
}

