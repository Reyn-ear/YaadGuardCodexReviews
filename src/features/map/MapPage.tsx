import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import {
  CloudLightning,
  LoaderCircle,
  MapPin,
  MapPinned,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { FeatureCollection, Polygon } from 'geojson'
import { Layer, Map, NavigationControl, Source } from 'react-map-gl/maplibre'
import type {
  FillLayer,
  LineLayer,
  MapLayerMouseEvent,
  MapRef,
} from 'react-map-gl/maplibre'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  GRID_FILL_LAYER_ID,
  GRID_LAT_STEP,
  GRID_LNG_STEP,
  GRID_OUTLINE_LAYER_ID,
  GRID_SOURCE_ID,
  MAP_STYLE_URL,
  TERRAIN_BASE_SHIFT,
  TERRAIN_BLUE_FACTOR,
  TERRAIN_EXAGGERATION,
  TERRAIN_GREEN_FACTOR,
  TERRAIN_HILLSHADE_LAYER_ID,
  TERRAIN_MAX_ZOOM,
  TERRAIN_MIN_ZOOM,
  TERRAIN_RED_FACTOR,
  TERRAIN_SOURCE_ID,
  TERRAIN_TILE_URL,
  WATER_FILL_LAYER_ID,
  WATER_SOURCE_ID,
} from './config'
import { createGridFeatureCollection } from './grid'
import { getRegionInsights } from './insights'
import { RainControls } from './RainControls'
import './rain-controls.css'
import { InfoCard } from './InfoCard'
import { usePlaceSearch } from './usePlaceSearch'
import { useRainSimulation } from './useRainSimulation'
import { buildWaterDepthFeatures } from './rain-sim'
import type {
  BoundsTuple,
  GridCellFeature,
  LngLatTuple,
  RegionInsightInput,
  RegionInsightResponse,
  SearchResult,
} from './types'

export type PanelState =
  | { status: 'empty' }
  | { status: 'loading'; label: string }
  | {
      status: 'ready'
      label: string
      kind: RegionInsightInput['kind']
      insight: RegionInsightResponse
    }
  | { status: 'error'; title: string; message: string }

interface FocusTarget {
  id: string
  result: SearchResult
}

interface TerrainView {
  bounds: BoundsTuple
}

type MapMode = 'map' | 'terrain'

const REGION_INSIGHTS_STALE_TIME_MS = 10 * 60 * 1000
const REGION_INSIGHTS_GC_TIME_MS = 30 * 60 * 1000

const GRID_FILL_LAYER: FillLayer = {
  id: GRID_FILL_LAYER_ID,
  type: 'fill',
  source: GRID_SOURCE_ID,
  paint: {
    'fill-color': '#38bdf8',
    'fill-opacity': [
      'case',
      ['boolean', ['feature-state', 'active'], false],
      0.4,
      ['boolean', ['feature-state', 'hover'], false],
      0.15,
      0,
    ],
  },
}

const GRID_OUTLINE_LAYER: LineLayer = {
  id: GRID_OUTLINE_LAYER_ID,
  type: 'line',
  source: GRID_SOURCE_ID,
  paint: {
    'line-color': '#38bdf8',
    'line-width': [
      'case',
      ['boolean', ['feature-state', 'active'], false],
      2,
      1,
    ],
    'line-opacity': [
      'case',
      ['boolean', ['feature-state', 'active'], false],
      1,
      0.15,
    ],
  },
}

const WATER_FILL_LAYER: FillLayer = {
  id: WATER_FILL_LAYER_ID,
  type: 'fill',
  source: WATER_SOURCE_ID,
  paint: {
    'fill-color': [
      'interpolate',
      ['linear'],
      ['get', 'depth'],
      0,
      'rgba(191, 219, 254, 0.3)',
      0.05,
      'rgba(96, 165, 250, 0.45)',
      0.1,
      'rgba(37, 99, 235, 0.55)',
      0.25,
      'rgba(30, 64, 175, 0.65)',
      0.5,
      'rgba(30, 27, 75, 0.75)',
    ],
    'fill-opacity': 1,
  },
}

const EMPTY_FEATURE_COLLECTION: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [],
}

function getLandslideRiskSummary(metrics: RegionInsightResponse['metrics']) {
  const slopeAngle = metrics.feasibleSlopeAngleDeg
  const nearbyStormCount = metrics.nearbyStormCount ?? 0

  if (slopeAngle === undefined) {
    return {
      band: 'Unavailable',
      bandClass: 'bg-slate-600/20 text-slate-300 border border-slate-500/30',
      explanation:
        'Landslide signal is unavailable because slope context could not be derived for this area.',
    }
  }

  if (slopeAngle >= 22) {
    return {
      band: 'Elevated',
      bandClass: 'bg-red-500/20 text-red-300 border border-red-500/30',
      explanation:
        nearbyStormCount > 0
          ? 'Steeper terrain plus repeated nearby storms can increase saturation-driven slope failure pressure.'
          : 'Steeper terrain suggests stronger slope-failure potential when soils become saturated.',
    }
  }

  if (slopeAngle >= 14) {
    return {
      band: 'Moderate',
      bandClass: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
      explanation:
        nearbyStormCount > 0
          ? 'Moderate slope combined with nearby storm exposure suggests some rain-triggered landslide susceptibility.'
          : 'Moderate slope suggests some landslide susceptibility during prolonged heavy rain.',
    }
  }

  return {
    band: 'Lower',
    bandClass: 'bg-green-500/20 text-green-300 border border-green-500/30',
    explanation:
      nearbyStormCount > 0
        ? 'Slope geometry is gentler here, though repeated storms can still trigger isolated failures in weaker soils.'
        : 'Slope geometry is relatively gentle here compared with steeper nearby terrain.',
  }
}

export default function MapPage() {
  const [gridCenter, setGridCenter] = useState<LngLatTuple>(DEFAULT_MAP_CENTER)
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null)
  const [clearSelectionVersion, setClearSelectionVersion] = useState(0)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [terrainView, setTerrainView] = useState<TerrainView | null>(null)
  const [mapMode, setMapMode] = useState<MapMode>('map')
  const [selectedAnalysis, setSelectedAnalysis] =
    useState<RegionInsightInput | null>(null)
  const [panelOverride, setPanelOverride] = useState<PanelState | null>(null)
  const [terrainStatusMessage, setTerrainStatusMessage] = useState<
    string | null
  >(null)
  const selectedCellBounds = terrainView?.bounds ?? null
  const rainSimulation = useRainSimulation(selectedCellBounds)
  const regionInsightsQuery = useQuery({
    queryKey: ['region-insights', selectedAnalysis],
    queryFn: async () => {
      if (!selectedAnalysis) {
        throw new Error('No region selected for insights.')
      }

      return getRegionInsights({ data: selectedAnalysis })
    },
    enabled: selectedAnalysis !== null,
    staleTime: REGION_INSIGHTS_STALE_TIME_MS,
    gcTime: REGION_INSIGHTS_GC_TIME_MS,
    retry: false,
  })
  const panelState: PanelState =
    panelOverride ??
    (selectedAnalysis === null
      ? { status: 'empty' }
      : regionInsightsQuery.isError
        ? {
            status: 'error',
            title: 'Region insight unavailable',
            message:
              'Hazard signals could not be calculated for this location. Check the server data sources and try again.',
          }
        : regionInsightsQuery.data
          ? {
              status: 'ready',
              label: selectedAnalysis.label,
              kind: selectedAnalysis.kind,
              insight: regionInsightsQuery.data,
            }
          : { status: 'loading', label: selectedAnalysis.label })

  const handleResultSelect = useEffectEvent((result: SearchResult) => {
    setGridCenter(result.center)
    setFocusTarget({
      id: `${result.label}:${Date.now()}`,
      result: result,
    })
    setTerrainView(null)
    setClearSelectionVersion((version) => version + 1)
    setPanelOverride(null)
    setSelectedAnalysis({
      kind: 'search',
      label: result.label,
      center: result.center,
      bounds: result.bounds,
      gridCellId: null,
    })
  })

  const placeSearch = usePlaceSearch({
    onSelect: handleResultSelect,
    onNoResults: () => {
      setSelectedAnalysis(null)
      setPanelOverride({
        status: 'error',
        title: 'No results found',
        message: 'Try a broader city, parish, or landmark name.',
      })
    },
    onSearchError: () => {
      setSelectedAnalysis(null)
      setPanelOverride({
        status: 'error',
        title: 'Search unavailable',
        message:
          'The location service could not be reached. Try again in a moment.',
      })
    },
  })
  const isSearchDropdownOpen = placeSearch.suggestions.length > 0

  const handleCellSelect = useEffectEvent((feature: GridCellFeature) => {
    placeSearch.clearMessage()
    const centerLng = feature.properties.centerLng
    const centerLat = feature.properties.centerLat
    const halfLatStep = GRID_LAT_STEP / 2
    const halfLngStep = GRID_LNG_STEP / 2
    const bounds: BoundsTuple = [
      [centerLng - halfLngStep, centerLat - halfLatStep],
      [centerLng + halfLngStep, centerLat + halfLatStep],
    ]
    setTerrainView({ bounds })
    setPanelOverride(null)
    setSelectedAnalysis({
      kind: 'cell',
      label: feature.properties.cellLabel,
      center: [centerLng, centerLat],
      bounds,
      gridCellId: feature.properties.cellId,
    })
  })

  const closeSidebar = useEffectEvent(() => {
    setIsSidebarOpen(false)
  })

  return (
    <main className="map-page">
      <MapTopbar />

      <section className="map-page__shell">
        <MapCanvas
          gridCenter={gridCenter}
          focusTarget={focusTarget}
          clearSelectionVersion={clearSelectionVersion}
          onCellSelect={handleCellSelect}
          waterDepths={
            rainSimulation.waterDepths.length > 0
              ? rainSimulation.waterDepths
              : null
          }
          selectedCellBounds={selectedCellBounds}
          mapMode={mapMode}
          onTerrainUnavailable={() => {
            setMapMode('map')
            setTerrainStatusMessage('Terrain unavailable for this area')
          }}
        />

        <MapTypeControl
          mode={mapMode}
          statusMessage={terrainStatusMessage}
          onStatusDismiss={() => setTerrainStatusMessage(null)}
          onModeChange={(mode) => {
            setTerrainStatusMessage(null)
            setMapMode(mode)
          }}
        />

        <InfoCard
          panelState={panelState}
          mmPerHr={rainSimulation.mmPerHr}
          onDetailsClick={() => setIsSidebarOpen(true)}
        />

        <div className="map-page__search">
          <motion.div
            layout
            initial={false}
            animate={{
              width:
                placeSearch.isFocused ||
                placeSearch.query ||
                isSearchDropdownOpen
                  ? '100%'
                  : '280px',
              borderColor: placeSearch.isFocused
                ? 'rgba(56, 189, 248, 0.55)'
                : 'rgba(255, 255, 255, 0.05)',
              boxShadow: placeSearch.isFocused
                ? '0 10px 40px rgba(0, 0, 0, 0.34), 0 0 20px rgba(56, 189, 248, 0.15)'
                : '0 8px 32px rgba(0, 0, 0, 0.15)',
            }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
            className="map-page__search-container"
          >
            <form
              className="map-page__search-box"
              onSubmit={(event) => {
                event.preventDefault()
                void placeSearch.submit()
              }}
            >
              <Search
                aria-hidden="true"
                className="map-page__search-icon"
                size={18}
              />
              <div className="relative flex flex-1 items-center overflow-hidden h-[1.5rem]">
                {!placeSearch.query && (
                  <span className="absolute inset-0 flex items-center pointer-events-none text-[var(--text-secondary)] font-medium text-[0.96rem] whitespace-nowrap overflow-hidden">
                    {placeSearch.placeholder}
                  </span>
                )}
                <input
                  type="text"
                  value={placeSearch.query}
                  onChange={(event) => placeSearch.setQuery(event.target.value)}
                  onFocus={() => placeSearch.setIsFocused(true)}
                  onBlur={() => placeSearch.setIsFocused(false)}
                  aria-label="Search locations"
                  autoComplete="off"
                  className="w-full bg-transparent border-none outline-none text-[var(--text-primary)] text-[0.96rem]"
                />
              </div>
              <button type="submit" disabled={placeSearch.isSearching}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={
                      placeSearch.isSearching || placeSearch.isWaiting
                        ? 'loading'
                        : 'sparkles'
                    }
                    initial={{ opacity: 0, scale: 0.8, rotate: -45 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.8, rotate: 45 }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                    className="flex items-center justify-center"
                  >
                    {placeSearch.isSearching || placeSearch.isWaiting ? (
                      <LoaderCircle
                        aria-hidden="true"
                        size={18}
                        className="is-spinning"
                      />
                    ) : (
                      <Sparkles aria-hidden="true" size={18} />
                    )}
                  </motion.div>
                </AnimatePresence>
                <span className="sr-only">Search the map</span>
              </button>
            </form>

            <AnimatePresence>
              {isSearchDropdownOpen && (
                <motion.ul
                  layout
                  className="map-page__dropdown"
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  variants={{
                    hidden: { opacity: 0, height: 0 },
                    visible: {
                      opacity: 1,
                      height: 'auto',
                      transition: {
                        height: { duration: 0.4, type: 'spring', bounce: 0 },
                        staggerChildren: 0.1,
                        delayChildren: 0.05,
                      },
                    },
                    exit: {
                      opacity: 0,
                      height: 0,
                      transition: { duration: 0.2 },
                    },
                  }}
                >
                  {placeSearch.suggestions.map((result, idx) => (
                    <motion.li
                      key={`${result.label}-${idx}`}
                      variants={{
                        hidden: { opacity: 0, y: -8 },
                        visible: {
                          opacity: 1,
                          y: 0,
                          transition: { duration: 0.4 },
                        },
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => placeSearch.selectResult(result)}
                      >
                        <MapPin size={16} aria-hidden="true" />
                        <span>{result.label}</span>
                      </button>
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.div>

          {placeSearch.message && !isSearchDropdownOpen ? (
            <p className="map-page__search-note">{placeSearch.message}</p>
          ) : null}
        </div>

        <aside
          id="map-page-sidebar"
          className={`map-page__sidebar ${!isSidebarOpen ? 'map-page__sidebar--hidden' : ''}`}
        >
          <div className="map-page__sidebar-header">
            <div>
              <p className="map-page__eyebrow">Region Insights</p>
              <h1>Hydrological view</h1>
            </div>
            <button
              type="button"
              onClick={closeSidebar}
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          </div>

          {/* Rain simulation controls */}
          <RainControls
            mmPerHr={rainSimulation.mmPerHr}
            onChange={rainSimulation.onRainChange}
            isLoading={rainSimulation.elevationLoading}
            hasElevation={rainSimulation.hasElevation}
          />

          <div className="map-page__sidebar-body">
            <AnimatePresence mode="wait">
              {panelState.status === 'empty' && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="map-page__state map-page__state--empty"
                >
                  <MapPinned aria-hidden="true" size={40} />
                  <p>
                    Select a grid cell or search for a place to generate
                    hydrological insight.
                  </p>
                </motion.div>
              )}

              {panelState.status === 'loading' && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="map-page__state map-page__state--loading"
                >
                  <LoaderCircle
                    aria-hidden="true"
                    size={36}
                    className="is-spinning"
                  />
                  <p>Calculating hazard signals for {panelState.label}...</p>
                </motion.div>
              )}

              {panelState.status === 'error' && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="map-page__state map-page__state--error"
                >
                  <p className="map-page__badge">Lookup</p>
                  <h2>{panelState.title}</h2>
                  <p>{panelState.message}</p>
                </motion.div>
              )}

              {panelState.status === 'ready' && (
                <motion.div
                  key="ready"
                  initial="hidden"
                  animate="visible"
                  variants={{
                    hidden: { opacity: 0 },
                    visible: {
                      opacity: 1,
                      transition: { staggerChildren: 0.12 },
                    },
                  }}
                  className="map-page__data flex flex-col gap-6"
                >
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 5 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="flex flex-col gap-1 border-b border-white/10 pb-4"
                  >
                    <p className="map-page__badge">
                      {panelState.kind === 'cell'
                        ? `Grid ${panelState.label}`
                        : 'Search Focus'}
                    </p>
                    <h2 className="text-xl font-bold text-white mb-2">
                      {panelState.label}
                    </h2>

                    {/* 1. High-Risk Quick Metrics Header */}
                    <div className="flex flex-wrap items-center gap-3 mt-2">
                      <div
                        className={`px-3 py-1.5 rounded-md text-sm font-semibold flex items-center gap-2 ${panelState.insight.riskProfile.band === 'Severe' || panelState.insight.riskProfile.band === 'High' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : panelState.insight.riskProfile.band === 'Moderate' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30'}`}
                      >
                        <span>{panelState.insight.riskProfile.band} Risk</span>
                      </div>
                      <div className="px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm font-medium text-slate-300">
                        Score:{' '}
                        <span className="text-white font-bold">
                          {panelState.insight.riskProfile.score}/100
                        </span>
                      </div>
                    </div>
                    {panelState.insight.riskProfile.topDrivers[0] && (
                      <p className="text-sm text-slate-400 mt-2 italic border-l-2 border-slate-600 pl-3">
                        Primary Factor:{' '}
                        {panelState.insight.riskProfile.topDrivers[0]}
                      </p>
                    )}
                  </motion.div>

                  {/* 2. Actionable Advice & Mitigation */}
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="map-page__section bg-blue-900/10 border border-blue-500/20 rounded-lg p-4"
                  >
                    <p className="text-sm font-bold text-blue-400 uppercase tracking-wider mb-3">
                      Actionable Advice
                    </p>
                    <div className="flex flex-col gap-2 text-sm text-slate-200">
                      <p className="font-semibold text-white">
                        {panelState.insight.aiInsight.headline}
                      </p>
                      <p className="leading-relaxed">
                        {panelState.insight.aiInsight.explanation}
                      </p>
                      {panelState.insight.aiInsight.caution && (
                        <div className="mt-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-200 p-3 rounded text-xs leading-relaxed">
                          <strong>Note:</strong>{' '}
                          {panelState.insight.aiInsight.caution}
                        </div>
                      )}
                    </div>
                  </motion.div>

                  {/* 3. The Baseline (Location Overview) */}
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="map-page__section"
                  >
                    <p className="map-page__section-label text-slate-400 font-medium">
                      Ground Level & Context
                    </p>
                    <div className="map-page__metrics grid grid-cols-2 gap-3 mt-3">
                      <article className="map-page__metric bg-slate-800/50 p-3 rounded-md border border-slate-700/50">
                        <span className="text-xs text-slate-400 mb-1 block">
                          Average Elevation
                        </span>
                        <strong className="text-lg font-semibold text-white">
                          {panelState.insight.metrics.elevationMeanM !==
                          undefined
                            ? `${panelState.insight.metrics.elevationMeanM}m`
                            : 'N/A'}
                        </strong>
                      </article>
                      <article className="map-page__metric bg-slate-800/50 p-3 rounded-md border border-slate-700/50">
                        <span className="text-xs text-slate-400 mb-1 block">
                          Land Coverage
                        </span>
                        <strong className="text-lg font-semibold text-white">
                          {panelState.insight.metrics.landCoveragePct !==
                          undefined
                            ? `${panelState.insight.metrics.landCoveragePct}%`
                            : 'N/A'}
                        </strong>
                      </article>
                    </div>
                  </motion.div>

                  {/* 4. Landslide Susceptibility */}
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="map-page__section"
                  >
                    <p className="map-page__section-label text-slate-400 font-medium">
                      Landslide Susceptibility
                    </p>
                    {(() => {
                      const landslideSummary = getLandslideRiskSummary(
                        panelState.insight.metrics,
                      )

                      return (
                        <div className="mt-3 bg-slate-800/50 p-3 rounded-md border border-slate-700/50">
                          <div className="flex items-center justify-between gap-3 mb-3 border-b border-slate-700 pb-3">
                            <span className="text-xs text-slate-400">
                              Estimated Slope-Failure Signal
                            </span>
                            <span
                              className={`px-2.5 py-1 rounded-md text-xs font-semibold ${landslideSummary.bandClass}`}
                            >
                              {landslideSummary.band}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div>
                              <span className="text-xs text-slate-400 block mb-1">
                                Feasible Slope
                              </span>
                              <strong className="text-base text-white">
                                {panelState.insight.metrics
                                  .feasibleSlopeAngleDeg !== undefined
                                  ? `${panelState.insight.metrics.feasibleSlopeAngleDeg}°`
                                  : 'N/A'}
                              </strong>
                            </div>
                            <div>
                              <span className="text-xs text-slate-400 block mb-1">
                                Terrain Relief
                              </span>
                              <strong className="text-base text-white">
                                {panelState.insight.metrics.reliefM !==
                                undefined
                                  ? `${panelState.insight.metrics.reliefM}m`
                                  : 'N/A'}
                              </strong>
                            </div>
                          </div>

                          <p className="text-xs text-slate-300 border-t border-slate-700 pt-2">
                            {landslideSummary.explanation}
                          </p>
                        </div>
                      )
                    })()}
                  </motion.div>

                  {/* 5. The Water Threat (Storm Surge Risk) */}
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="map-page__section"
                  >
                    <p className="map-page__section-label text-slate-400 font-medium">
                      Storm Surge Risk
                    </p>
                    <div className="mt-3 bg-slate-800/50 p-3 rounded-md border border-slate-700/50">
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <span className="text-xs text-slate-400 block mb-1">
                            10-Year Storm
                          </span>
                          <strong className="text-base text-white">
                            {panelState.insight.metrics.surgeRp10M !== undefined
                              ? `${panelState.insight.metrics.surgeRp10M}m`
                              : 'N/A'}
                          </strong>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400 block mb-1">
                            100-Year Storm
                          </span>
                          <strong className="text-base text-white">
                            {panelState.insight.metrics.surgeRp100M !==
                            undefined
                              ? `${panelState.insight.metrics.surgeRp100M}m`
                              : 'N/A'}
                          </strong>
                        </div>
                      </div>
                      {panelState.insight.metrics.surgeRp100M !== undefined &&
                        panelState.insight.metrics.elevationMeanM !==
                          undefined && (
                          <p className="text-xs text-slate-300 border-t border-slate-700 pt-2 mt-2">
                            During a severe (100-year) storm, water could reach{' '}
                            {panelState.insight.metrics.surgeRp100M}m. Compared
                            with average ground around{' '}
                            {panelState.insight.metrics.elevationMeanM}m,{' '}
                            {panelState.insight.metrics.surgeRp100M >
                            panelState.insight.metrics.elevationMeanM
                              ? 'coastal flooding pressure can overtop local terrain and sharply raise flood risk.'
                              : 'terrain still sits above the modeled surge level, so elevation helps moderate direct inundation risk.'}
                          </p>
                        )}
                    </div>
                  </motion.div>

                  {/* 6. The Wind Threat (Historical Hurricane Activity) */}
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="map-page__section"
                  >
                    <p className="map-page__section-label text-slate-400 font-medium">
                      Historical Hurricane Activity
                    </p>
                    <div className="mt-3 bg-slate-800/50 p-3 rounded-md border border-slate-700/50">
                      <div className="grid grid-cols-2 gap-3 mb-3 border-b border-slate-700 pb-3">
                        <div>
                          <span className="text-xs text-slate-400 block mb-1">
                            Storms Nearby
                          </span>
                          <strong className="text-base text-white">
                            {panelState.insight.metrics.nearbyStormCount ?? '0'}
                          </strong>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400 block mb-1">
                            Peak Winds
                          </span>
                          <strong className="text-base text-white">
                            {panelState.insight.metrics
                              .strongestNearbyWindKt !== undefined
                              ? `${panelState.insight.metrics.strongestNearbyWindKt} kt`
                              : 'N/A'}
                          </strong>
                        </div>
                      </div>
                      <div className="text-sm text-slate-300">
                        {panelState.insight.historicalAnalog ? (
                          <p>
                            <strong>Worst Case on Record:</strong>{' '}
                            {panelState.insight.historicalAnalog.label} passed
                            within{' '}
                            {
                              panelState.insight.historicalAnalog
                                .closestApproachKm
                            }{' '}
                            km of this area
                            {panelState.insight.historicalAnalog.peakWindKt !==
                            undefined
                              ? ` with peak winds of ${panelState.insight.historicalAnalog.peakWindKt} kt`
                              : ''}
                            {panelState.insight.historicalAnalog.eventDate
                              ? ` on ${panelState.insight.historicalAnalog.eventDate}`
                              : ''}
                            .
                          </p>
                        ) : (
                          <p>
                            No major historical storm tracks found within the
                            immediate comparison radius.
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.div>

                  {/* 7. Community Context */}
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="map-page__section"
                  >
                    <p className="map-page__section-label text-slate-400 font-medium">
                      Community Context
                    </p>
                    <div className="mt-3 bg-slate-800/50 p-3 rounded-md border border-slate-700/50 text-sm text-slate-300">
                      {panelState.insight.metrics.populationDensityPerSqKm !==
                        undefined ||
                      panelState.insight.metrics.estimatedPopulation !==
                        undefined ? (
                        <div className="flex flex-col gap-2">
                          {panelState.insight.metrics.estimatedPopulation !==
                          undefined ? (
                            <p>
                              <strong>Estimated Population:</strong>{' '}
                              {panelState.insight.metrics.estimatedPopulation.toLocaleString()}{' '}
                              people inside this analysis window.
                            </p>
                          ) : null}
                          {panelState.insight.metrics
                            .populationDensityPerSqKm !== undefined ? (
                            <p>
                              <strong>Population Density:</strong>{' '}
                              {
                                panelState.insight.metrics
                                  .populationDensityPerSqKm
                              }{' '}
                              per sq km. Denser areas can increase exposure and
                              strain evacuation routes during a disaster.
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <p>
                          Local population density data is currently unavailable
                          for this specific grid area.
                        </p>
                      )}
                    </div>
                  </motion.div>

                  {/* 8. Land-Cover Context */}
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="map-page__section"
                  >
                    <p className="map-page__section-label text-slate-400 font-medium">
                      Land-Cover Context
                    </p>
                    <div className="mt-3 bg-slate-800/50 p-3 rounded-md border border-slate-700/50">
                      {panelState.insight.metrics.builtUpPct !== undefined ||
                      panelState.insight.metrics.treeCoverPct !== undefined ||
                      panelState.insight.metrics.waterPct !== undefined ? (
                        <div className="grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <span className="text-xs text-slate-400 block mb-1">
                              Built-up
                            </span>
                            <strong className="text-base text-white">
                              {panelState.insight.metrics.builtUpPct ?? 0}%
                            </strong>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400 block mb-1">
                              Tree Cover
                            </span>
                            <strong className="text-base text-white">
                              {panelState.insight.metrics.treeCoverPct ?? 0}%
                            </strong>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400 block mb-1">
                              Water/Wetland
                            </span>
                            <strong className="text-base text-white">
                              {(
                                (panelState.insight.metrics.waterPct ?? 0) +
                                (panelState.insight.metrics.wetlandPct ?? 0) +
                                (panelState.insight.metrics.mangrovePct ?? 0)
                              ).toFixed(1)}
                              %
                            </strong>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-300">
                          ESA WorldCover data is currently unavailable for this
                          specific analysis window.
                        </p>
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>
      </section>
    </main>
  )
}

function MapTypeControl({
  mode,
  statusMessage,
  onStatusDismiss,
  onModeChange,
}: {
  mode: MapMode
  statusMessage: string | null
  onStatusDismiss: () => void
  onModeChange: (mode: MapMode) => void
}) {
  const options: Array<{ mode: MapMode; label: string }> = [
    { mode: 'map', label: 'Map' },
    { mode: 'terrain', label: 'Terrain' },
  ]

  return (
    <div className="map-type-control" aria-label="Map type">
      <div className="map-type-control__cards">
        {options.map((option) => (
          <button
            key={option.mode}
            type="button"
            className={`map-type-card map-type-card--${option.mode} ${
              mode === option.mode ? 'is-active' : ''
            }`}
            aria-pressed={mode === option.mode}
            onClick={() => onModeChange(option.mode)}
          >
            <span className="map-type-card__preview" aria-hidden="true" />
            <span className="map-type-card__label">{option.label}</span>
          </button>
        ))}
      </div>
      {statusMessage ? (
        <p
          className="map-type-control__status"
          role="status"
          onAnimationEnd={(event) => {
            if (event.animationName === 'terrain-status-dismiss') {
              onStatusDismiss()
            }
          }}
        >
          {statusMessage}
        </p>
      ) : null}
    </div>
  )
}

function MapTopbar() {
  return (
    <nav className="fixed top-0 left-0 z-[100] flex h-[70px] w-full items-center justify-between border-b border-white/5 bg-[#080f1a] px-5 shadow-none sm:px-10">
      <Link
        to="/"
        className="flex items-center gap-3 text-xl font-bold tracking-[-0.3px] no-underline transition-opacity hover:opacity-80"
        style={{ color: '#ffffff' }}
      >
        <CloudLightning
          aria-hidden="true"
          className="h-[1.4rem] w-[1.4rem] text-[var(--accent)]"
        />
        <span>Yaad Guard</span>
      </Link>
    </nav>
  )
}

function MapCanvas({
  gridCenter,
  focusTarget,
  clearSelectionVersion,
  onCellSelect,
  waterDepths,
  selectedCellBounds,
  mapMode,
  onTerrainUnavailable,
}: {
  gridCenter: LngLatTuple
  focusTarget: FocusTarget | null
  clearSelectionVersion: number
  onCellSelect: (feature: GridCellFeature) => void
  waterDepths: number[] | null
  selectedCellBounds: BoundsTuple | null
  mapMode: MapMode
  onTerrainUnavailable: () => void
}) {
  const reactMapRef = useRef<MapRef | null>(null)
  const hoveredFeatureIdRef = useRef<number | null>(null)
  const activeFeatureIdRef = useRef<number | null>(null)
  const isReadyRef = useRef(false)
  const handleCellSelect = useEffectEvent(onCellSelect)
  const handleTerrainUnavailable = useEffectEvent(onTerrainUnavailable)
  const gridData = useMemo(
    () => createGridFeatureCollection({ center: gridCenter }),
    [gridCenter],
  )
  const waterData = useMemo<FeatureCollection<Polygon>>(() => {
    if (!waterDepths || !selectedCellBounds) {
      return EMPTY_FEATURE_COLLECTION
    }

    return {
      type: 'FeatureCollection',
      features: buildWaterDepthFeatures({
        bounds: selectedCellBounds,
        waterDepths,
      }),
    }
  }, [waterDepths, selectedCellBounds])

  const getMap = () => reactMapRef.current?.getMap()

  const clearHoverState = () => {
    const map = getMap()
    if (!map || hoveredFeatureIdRef.current === null) {
      return
    }

    map.setFeatureState(
      { source: GRID_SOURCE_ID, id: hoveredFeatureIdRef.current },
      { hover: false },
    )
    hoveredFeatureIdRef.current = null
  }

  const clearActiveState = () => {
    const map = getMap()
    if (!map || activeFeatureIdRef.current === null) {
      return
    }

    map.setFeatureState(
      { source: GRID_SOURCE_ID, id: activeFeatureIdRef.current },
      { active: false },
    )
    activeFeatureIdRef.current = null
  }

  const handleMapLoad = () => {
    if (!getMap()) {
      return
    }

    isReadyRef.current = true
  }

  const handleMouseMove = (event: MapLayerMouseEvent) => {
    const map = getMap()
    const feature = event.features?.[0]
    if (!map || !isReadyRef.current || !feature || feature.id === undefined) {
      return
    }

    map.getCanvas().style.cursor = 'crosshair'
    clearHoverState()
    hoveredFeatureIdRef.current = Number(feature.id)
    map.setFeatureState(
      { source: GRID_SOURCE_ID, id: hoveredFeatureIdRef.current },
      { hover: true },
    )
  }

  const handleMouseLeave = () => {
    const map = getMap()
    if (!map) {
      return
    }

    map.getCanvas().style.cursor = ''
    clearHoverState()
  }

  const handleClick = (event: MapLayerMouseEvent) => {
    const map = getMap()
    const feature = event.features?.[0]

    if (
      !map ||
      !isReadyRef.current ||
      !feature ||
      feature.id === undefined ||
      feature.geometry.type !== 'Polygon'
    ) {
      return
    }

    const properties = feature.properties

    clearActiveState()
    activeFeatureIdRef.current = Number(feature.id)
    map.setFeatureState(
      { source: GRID_SOURCE_ID, id: activeFeatureIdRef.current },
      { active: true },
    )

    handleCellSelect({
      type: 'Feature',
      id: Number(feature.id),
      properties: {
        cellId: String(properties.cellId ?? properties.cellKey ?? 'Unknown'),
        cellKey: String(properties.cellKey ?? 'Unknown'),
        cellLabel: String(properties.cellLabel ?? 'Unknown'),
        centerLng: Number(properties.centerLng ?? DEFAULT_MAP_CENTER[0]),
        centerLat: Number(properties.centerLat ?? DEFAULT_MAP_CENTER[1]),
        latIndex: Number(properties.latIndex ?? 0),
        lngIndex: Number(properties.lngIndex ?? 0),
      },
      geometry: feature.geometry,
    })
  }

  useEffect(() => {
    return () => {
      isReadyRef.current = false
    }
  }, [])

  useEffect(() => {
    const map = getMap()
    if (!map || !isReadyRef.current || !focusTarget) {
      return
    }

    const { bounds, center } = focusTarget.result

    if (bounds) {
      map.fitBounds(bounds, {
        padding: 80,
        duration: 1600,
      })
      return
    }

    map.flyTo({
      center,
      zoom: 13,
      duration: 1600,
      essential: true,
    })
  }, [focusTarget])

  useEffect(() => {
    const map = getMap()
    if (!map || !isReadyRef.current) {
      return
    }

    if (hoveredFeatureIdRef.current !== null) {
      map.setFeatureState(
        { source: GRID_SOURCE_ID, id: hoveredFeatureIdRef.current },
        { hover: false },
      )
      hoveredFeatureIdRef.current = null
    }

    if (activeFeatureIdRef.current !== null) {
      map.setFeatureState(
        { source: GRID_SOURCE_ID, id: activeFeatureIdRef.current },
        { active: false },
      )
      activeFeatureIdRef.current = null
    }
  }, [clearSelectionVersion])

  useEffect(() => {
    const map = getMap()
    if (!map || !isReadyRef.current) {
      return
    }

    const hideTerrain = () => {
      if (map.getLayer(TERRAIN_HILLSHADE_LAYER_ID)) {
        map.setLayoutProperty(TERRAIN_HILLSHADE_LAYER_ID, 'visibility', 'none')
      }
      map.setTerrain(null)
    }

    const removeFailedTerrain = () => {
      map.setTerrain(null)

      if (map.getLayer(TERRAIN_HILLSHADE_LAYER_ID)) {
        map.removeLayer(TERRAIN_HILLSHADE_LAYER_ID)
      }

      if (map.getSource(TERRAIN_SOURCE_ID)) {
        map.removeSource(TERRAIN_SOURCE_ID)
      }
    }

    if (mapMode === 'map') {
      hideTerrain()
      return
    }

    let terrainErrorHandled = false

    const handleTerrainError = (event: maplibregl.ErrorEvent) => {
      if (terrainErrorHandled) {
        return
      }

      const sourceId =
        'sourceId' in event && typeof event.sourceId === 'string'
          ? event.sourceId
          : undefined

      if (sourceId && sourceId !== TERRAIN_SOURCE_ID) {
        return
      }

      terrainErrorHandled = true
      removeFailedTerrain()
      handleTerrainUnavailable()
    }

    try {
      if (!map.getSource(TERRAIN_SOURCE_ID)) {
        map.addSource(TERRAIN_SOURCE_ID, {
          type: 'raster-dem',
          tiles: [TERRAIN_TILE_URL],
          tileSize: 256,
          encoding: 'custom',
          redFactor: TERRAIN_RED_FACTOR,
          greenFactor: TERRAIN_GREEN_FACTOR,
          blueFactor: TERRAIN_BLUE_FACTOR,
          baseShift: TERRAIN_BASE_SHIFT,
          minzoom: TERRAIN_MIN_ZOOM,
          maxzoom: TERRAIN_MAX_ZOOM,
        } as maplibregl.SourceSpecification)
      }

      if (!map.getLayer(TERRAIN_HILLSHADE_LAYER_ID)) {
        map.addLayer(
          {
            id: TERRAIN_HILLSHADE_LAYER_ID,
            type: 'hillshade',
            source: TERRAIN_SOURCE_ID,
            paint: {
              'hillshade-exaggeration': 0.42,
              'hillshade-shadow-color': '#101827',
              'hillshade-highlight-color': '#9fd8c2',
              'hillshade-accent-color': '#7f5539',
            },
          },
          GRID_FILL_LAYER_ID,
        )
      } else {
        map.setLayoutProperty(
          TERRAIN_HILLSHADE_LAYER_ID,
          'visibility',
          'visible',
        )
      }

      map.setTerrain({
        source: TERRAIN_SOURCE_ID,
        exaggeration: TERRAIN_EXAGGERATION,
      })
      map.on('error', handleTerrainError)
    } catch (error) {
      console.error('[MapPage] Failed to enable terrain:', error)
      removeFailedTerrain()
      handleTerrainUnavailable()
    }

    return () => {
      map.off('error', handleTerrainError)
    }
  }, [mapMode])

  return (
    <div className="map-page__map" aria-label="Interactive map">
      <Map
        ref={reactMapRef}
        initialViewState={{
          longitude: DEFAULT_MAP_CENTER[0],
          latitude: DEFAULT_MAP_CENTER[1],
          zoom: DEFAULT_MAP_ZOOM,
        }}
        mapStyle={MAP_STYLE_URL}
        onLoad={handleMapLoad}
        interactiveLayerIds={[GRID_FILL_LAYER_ID]}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <NavigationControl position="bottom-right" showCompass={false} />
        <Source id={GRID_SOURCE_ID} type="geojson" data={gridData}>
          <Layer {...GRID_FILL_LAYER} />
          <Layer {...GRID_OUTLINE_LAYER} />
        </Source>
        <Source id={WATER_SOURCE_ID} type="geojson" data={waterData}>
          <Layer {...WATER_FILL_LAYER} />
        </Source>
      </Map>
    </div>
  )
}
