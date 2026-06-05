import { Droplets } from 'lucide-react'
import { STORM_CATEGORIES, getCategory } from './rain-sim'

const MAX_MM = 178

interface Props {
  mmPerHr: number
  onChange: (mmPerHr: number) => void
  isLoading: boolean
  hasElevation: boolean
}

export function RainControls({
  mmPerHr,
  onChange,
  isLoading,
  hasElevation,
}: Props) {
  const category = getCategory(mmPerHr)

  if (!hasElevation) {
    return (
      <div className="rain-controls rain-controls--idle">
        <Droplets size={16} aria-hidden="true" />
        <span>Select a grid cell to enable rainfall simulation</span>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="rain-controls rain-controls--idle">
        <Droplets size={16} aria-hidden="true" className="is-spinning" />
        <span>Loading elevation data...</span>
      </div>
    )
  }

  return (
    <div className="rain-controls">
      <div className="rain-controls__header">
        <Droplets size={16} aria-hidden="true" />
        <span className="rain-controls__title">Rainfall Simulation</span>
        <span
          className="rain-controls__badge"
          style={{ color: category.color }}
        >
          {category.label}
          {mmPerHr > 0 && <em> · {mmPerHr} mm/hr</em>}
        </span>
      </div>

      <div className="rain-controls__track-wrap">
        <input
          type="range"
          min={0}
          max={MAX_MM}
          step={1}
          value={mmPerHr}
          onChange={(e) => onChange(Number(e.target.value))}
          className="rain-controls__slider"
          aria-label="Rainfall intensity"
        />

        <div className="rain-controls__notches" aria-hidden="true">
          {STORM_CATEGORIES.map((cat, idx) => {
            const isFirstChild = idx === 0
            const isLastChild = idx === STORM_CATEGORIES.length - 1
            const isAbove = idx % 2 === 0
            const leftPct = (cat.mmPerHr / MAX_MM) * 100

            const positionClass = isAbove
              ? 'rain-controls__notch--above'
              : 'rain-controls__notch--below'
            const edgeClass = isFirstChild
              ? 'rain-controls__notch--edge-left'
              : isLastChild
                ? 'rain-controls__notch--edge-right'
                : ''

            return (
              <button
                key={cat.mmPerHr}
                type="button"
                className={`rain-controls__notch ${positionClass} ${edgeClass}`.trim()}
                style={{ left: `${leftPct}%`, color: cat.color }}
                onClick={() => onChange(cat.mmPerHr)}
                title={`${cat.label}${cat.mmPerHr > 0 ? ` (${cat.mmPerHr} mm/hr)` : ''}`}
              >
                <span className="rain-controls__notch-tick" />
                <span className="rain-controls__notch-label">{cat.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {mmPerHr > 0 && (
        <div className="rain-controls__legend" aria-label="Water depth legend">
          <span>Water depth</span>
          <div className="rain-controls__legend-bar">
            <span>0 m</span>
            <div className="rain-controls__legend-gradient" />
            <span>≥ 0.5 m</span>
          </div>
        </div>
      )}
    </div>
  )
}
