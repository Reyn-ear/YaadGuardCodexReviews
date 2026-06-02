import { ChevronRight } from 'lucide-react'
import type { PanelState } from './MapPage'

interface InfoCardProps {
  panelState: PanelState
  mmPerHr: number
  onDetailsClick: () => void
}

const THRESHOLD_MM_PER_HR = 50

function getAdvisory(panelState: PanelState, mmPerHr: number) {
  if (panelState.status === 'error') {
    return 'Conditions could not be assessed. Try another location or check the data sources.'
  }

  if (panelState.status === 'loading') {
    return 'Assessing flood exposure now. Keep monitoring rainfall in the meantime.'
  }

  if (panelState.status === 'ready') {
    const riskBand = panelState.insight.riskProfile.band

    if (mmPerHr >= THRESHOLD_MM_PER_HR || riskBand === 'Severe' || riskBand === 'High') {
      return 'This region is prone to flooding. If rainfall exceeds 50 mm/hour, evacuation may be needed.'
    }

    if (mmPerHr >= 25 || riskBand === 'Moderate') {
      return 'Monitor conditions closely in heavy rainfall. If rainfall rises toward 50 mm/hour, evacuation planning may be needed.'
    }

    return 'This region is prone to flooding during sustained rain. Keep a close watch if rainfall intensifies.'
  }

  if (mmPerHr >= THRESHOLD_MM_PER_HR) {
    return 'This region is prone to flooding. If rainfall exceeds 50 mm/hour, evacuation may be needed.'
  }

  if (mmPerHr >= 25) {
    return 'Monitor conditions closely in heavy rainfall. If rainfall rises toward 50 mm/hour, evacuation planning may be needed.'
  }

  return 'This region is prone to flooding during sustained rain. Keep a close watch if rainfall intensifies.'
}

function getRiskLabel(panelState: PanelState) {
  if (panelState.status === 'ready') {
    return panelState.insight.riskProfile.band
  }

  if (panelState.status === 'loading') {
    return 'Assessing'
  }

  if (panelState.status === 'error') {
    return 'Unavailable'
  }

  return 'Overview'
}

export function InfoCard({ panelState, mmPerHr, onDetailsClick }: InfoCardProps) {
  return (
    <article className="map-page__info-card" aria-live="polite">
      <div className="map-page__info-card-header">
        <div className="map-page__info-card-heading">
          <p className="map-page__eyebrow">Flood outlook</p>
          <h2>{getRiskLabel(panelState)}</h2>
        </div>
        <span className="map-page__info-card-pill">{getRiskLabel(panelState)}</span>
      </div>

      <p className="map-page__info-rainfall">
        Current rainfall: <strong>{mmPerHr.toFixed(0)} mm/hour</strong>
      </p>

      <p className="map-page__info-copy">{getAdvisory(panelState, mmPerHr)}</p>

      <button
        type="button"
        className="map-page__info-details"
        onClick={onDetailsClick}
        aria-controls="map-page-sidebar"
        aria-label="Open detailed flood analysis"
      >
        <span>Details</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>

      <div className="map-page__info-meta">
        <span>Threshold watch: 50 mm/hour</span>
      </div>
    </article>
  )
}