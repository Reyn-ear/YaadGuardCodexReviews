import { Link } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  CloudLightning,
  LoaderCircle,
  MapPin,
  MapPinned,
  Mountain,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import maplibregl from 'maplibre-gl'
import type { MapLayerMouseEvent } from 'maplibre-gl'
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
  WATER_FILL_LAYER_ID,
  WATER_SOURCE_ID,
} from './config'
import { createGridFeatureCollection } from './grid'
import { getRegionInsights } from './insights'
import { searchPlaces } from './search'
import { useDebounce } from '../../hooks/useDebounce'
import { computeWaterDepths } from './rain-sim'
import { fetchSubGridElevations } from './elevation'
import { RainControls } from './RainControls'
import './rain-controls.css'
import type {
  BoundsTuple,
  GridCellFeature,
  LngLatTuple,
  RegionInsightInput,
  RegionInsightResponse,
  SearchResult,
} from './types'
import { TerrainPopup } from './TerrainPopup'

type PanelState =
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
  cellId: string
  label: string
  center: LngLatTuple
  bounds: BoundsTuple
}

type MapSource = NonNullable<ReturnType<maplibregl.Map['getSource']>>
type GeoJSONDataSource = MapSource & {
  type: 'geojson'
  setData: (data: ReturnType<typeof createGridFeatureCollection>) => void
}

function isGeoJSONSource(
  source: ReturnType<maplibregl.Map['getSource']>,
): source is GeoJSONDataSource {
  return source?.type === 'geojson' && 'setData' in source
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
  const [panelState, setPanelState] = useState<PanelState>({ status: 'empty' })
  const [gridCenter, setGridCenter] = useState<LngLatTuple>(DEFAULT_MAP_CENTER)
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMessage, setSearchMessage] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [clearSelectionVersion, setClearSelectionVersion] = useState(0)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<SearchResult[]>([])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const debouncedQuery = useDebounce(searchQuery, 600)
  const isWaiting =
    !isTyping && searchQuery.trim() !== '' && searchQuery !== debouncedQuery
  const [terrainView, setTerrainView] = useState<TerrainView | null>(null)
  const [showTerrainPopup, setShowTerrainPopup] = useState(false)
  const typingTimeoutRef = useRef<number | null>(null)
  const analysisRequestIdRef = useRef(0)

  // Rain simulation state
  const [subGridElevations, setSubGridElevations] = useState<number[] | null>(
    null,
  )
  const [elevationLoading, setElevationLoading] = useState(false)
  const [mmPerHr, setMmPerHr] = useState(0)
  const [waterDepths, setWaterDepths] = useState<number[]>([])
  const selectedCellBoundsRef = useRef<BoundsTuple | null>(null)

  const placeholders = [
    'Search regions...',
    'Try "Kingston"...',
    'Try "Montego Bay"...',
    'Find locations...',
  ]

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isFocused && !searchQuery) {
        setPlaceholderIndex((prev) => (prev + 1) % placeholders.length)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [isFocused, searchQuery, placeholders.length])

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current !== null) {
        window.clearTimeout(typingTimeoutRef.current)
      }
    }
  }, [])

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    setIsTyping(true)

    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current)
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      setIsTyping(false)
    }, 300)
  }

  useEffect(() => {
    const trimmedQuery = debouncedQuery.trim()
    if (!trimmedQuery) {
      setSuggestions([])
      setIsDropdownOpen(false)
      return
    }

    let isMounted = true
    setIsSearching(true)

    searchPlaces(trimmedQuery)
      .then((results) => {
        if (!isMounted) return
        setSuggestions(results)
        setIsDropdownOpen(results.length > 0)
        if (results.length > 0) {
          setSearchMessage(null)
        }
      })
      .catch(() => {
        if (!isMounted) return
        setSuggestions([])
        setIsDropdownOpen(false)
      })
      .finally(() => {
        if (!isMounted) return
        setIsSearching(false)
      })

    return () => {
      isMounted = false
    }
  }, [debouncedQuery])

  const queueAnalysis = useEffectEvent(async (payload: RegionInsightInput) => {
    const requestId = analysisRequestIdRef.current + 1
    analysisRequestIdRef.current = requestId

    setPanelState({ status: 'loading', label: payload.label })
    setIsSidebarOpen(true)

    try {
      const insight = await getRegionInsights({ data: payload })

      if (requestId !== analysisRequestIdRef.current) {
        return
      }

      setPanelState({
        status: 'ready',
        label: payload.label,
        kind: payload.kind,
        insight,
      })
    } catch {
      if (requestId !== analysisRequestIdRef.current) {
        return
      }

      setPanelState({
        status: 'error',
        title: 'Region insight unavailable',
        message:
          'Hazard signals could not be calculated for this location. Check the server data sources and try again.',
      })
      setIsSidebarOpen(true)
    }
  })

  const handleCellSelect = useEffectEvent((feature: GridCellFeature) => {
    setSearchMessage(null)
    setShowTerrainPopup(false)
    const centerLng = feature.properties.centerLng
    const centerLat = feature.properties.centerLat
    const halfLatStep = GRID_LAT_STEP / 2
    const halfLngStep = GRID_LNG_STEP / 2
    const bounds: BoundsTuple = [
      [centerLng - halfLngStep, centerLat - halfLatStep],
      [centerLng + halfLngStep, centerLat + halfLatStep],
    ]
    setTerrainView({
      cellId: feature.properties.cellId,
      label: feature.properties.cellLabel,
      center: [centerLng, centerLat],
      bounds,
    })
    queueAnalysis({
      kind: 'cell',
      label: feature.properties.cellLabel,
      center: [centerLng, centerLat],
      bounds,
      gridCellId: feature.properties.cellId,
    })
  })

  const handleResultSelect = useEffectEvent((result: SearchResult) => {
    setGridCenter(result.center)
    setFocusTarget({
      id: `${result.label}:${Date.now()}`,
      result: result,
    })
    setTerrainView(null)
    setShowTerrainPopup(false)
    setSearchQuery('')
    setSuggestions([])
    setIsDropdownOpen(false)
    setSearchMessage(null)
    setClearSelectionVersion((version) => version + 1)
    queueAnalysis({
      kind: 'search',
      label: result.label,
      center: result.center,
      bounds: result.bounds,
      gridCellId: null,
    })
  })

  const handleSearchSubmit = useEffectEvent(async () => {
    const topSuggestion = suggestions.at(0)
    if (topSuggestion) {
      handleResultSelect(topSuggestion)
      return
    }

    const trimmedQuery = searchQuery.trim()
    if (!trimmedQuery) {
      setSearchMessage('Enter a place or landmark to reposition the map.')
      return
    }

    setIsSearching(true)
    setSearchMessage(null)

    try {
      const results = await searchPlaces(trimmedQuery)
      const selectedResult = results.at(0)

      if (!selectedResult) {
        setPanelState({
          status: 'error',
          title: 'No results found',
          message: 'Try a broader city, parish, or landmark name.',
        })
        setSearchMessage('No results matched that search.')
        setIsSidebarOpen(true)
        return
      }

      handleResultSelect(selectedResult)
    } catch {
      setPanelState({
        status: 'error',
        title: 'Search unavailable',
        message:
          'The location service could not be reached. Try again in a moment.',
      })
      setSearchMessage('Search request failed. Please retry.')
      setIsSidebarOpen(true)
    } finally {
      setIsSearching(false)
    }
  })

  const closeSidebar = useEffectEvent(() => {
    analysisRequestIdRef.current += 1
    setIsSidebarOpen(false)
    setShowTerrainPopup(false)
  })

  // Fetch sub-grid elevations when cell is selected
  useEffect(() => {
    if (!terrainView) {
      setSubGridElevations(null)
      setWaterDepths([])
      selectedCellBoundsRef.current = null
      return
    }

    let cancelled = false
    setElevationLoading(true)
    setSubGridElevations(null)
    selectedCellBoundsRef.current = terrainView.bounds

    fetchSubGridElevations({
      data: { bounds: terrainView.bounds, subGridSize: 20 },
    })
      .then((result) => {
        if (cancelled) return
        if (result.success && result.elevations) {
          setSubGridElevations(result.elevations)
          setWaterDepths(computeWaterDepths(result.elevations, mmPerHr))
        }
      })
      .catch((err) => {
        console.error('[MapPage] Failed to fetch elevations:', err)
      })
      .finally(() => {
        if (!cancelled) setElevationLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainView])

  // Handle rain slider change
  const handleRainChange = useEffectEvent((newMm: number) => {
    setMmPerHr(newMm)
    if (subGridElevations) {
      setWaterDepths(computeWaterDepths(subGridElevations, newMm))
    }
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
          waterDepths={waterDepths.length > 0 ? waterDepths : null}
          selectedCellBounds={selectedCellBoundsRef.current}
        />

        <div className="map-page__search">
          <motion.div
            layout
            initial={false}
            animate={{
              width:
                isFocused || searchQuery || isDropdownOpen ? '100%' : '280px',
              borderColor: isFocused
                ? 'rgba(56, 189, 248, 0.55)'
                : 'rgba(255, 255, 255, 0.05)',
              boxShadow: isFocused
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
                void handleSearchSubmit()
              }}
            >
              <Search
                aria-hidden="true"
                className="map-page__search-icon"
                size={18}
              />
              <div className="relative flex flex-1 items-center overflow-hidden h-[1.5rem]">
                <AnimatePresence mode="popLayout">
                  {!searchQuery && (
                    <motion.div
                      key={placeholderIndex}
                      initial={{ y: 15, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -15, opacity: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="absolute inset-0 flex items-center pointer-events-none text-[var(--text-secondary)] font-medium text-[0.96rem] whitespace-nowrap overflow-hidden"
                    >
                      {placeholders[placeholderIndex]}
                    </motion.div>
                  )}
                </AnimatePresence>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  aria-label="Search locations"
                  autoComplete="off"
                  className="w-full bg-transparent border-none outline-none text-[var(--text-primary)] text-[0.96rem]"
                />
              </div>
              <button type="submit" disabled={isSearching}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={isSearching || isWaiting ? 'loading' : 'sparkles'}
                    initial={{ opacity: 0, scale: 0.8, rotate: -45 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.8, rotate: 45 }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                    className="flex items-center justify-center"
                  >
                    {isSearching || isWaiting ? (
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
              {isDropdownOpen && suggestions.length > 0 && (
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
                  {suggestions.map((result, idx) => (
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
                        onClick={() => handleResultSelect(result)}
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

          {searchMessage && !isDropdownOpen ? (
            <p className="map-page__search-note">{searchMessage}</p>
          ) : null}
        </div>

        {!isSidebarOpen && panelState.status !== 'empty' && (
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="fixed right-5 bottom-5 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(15,23,42,0.8)] text-[var(--landing-accent)] shadow-lg backdrop-blur-md transition-transform hover:scale-110 sm:right-8 sm:bottom-8"
            aria-label="Open analysis sidebar"
          >
            <MapPinned size={24} />
          </button>
        )}

        <aside
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
            mmPerHr={mmPerHr}
            onChange={handleRainChange}
            isLoading={elevationLoading}
            hasElevation={subGridElevations !== null}
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

                  {terrainView && (
                    <motion.button
                      type="button"
                      variants={{
                        hidden: { opacity: 0, y: 10 },
                        visible: { opacity: 1, y: 0 },
                      }}
                      className="map-page__terrain-button mt-4 bg-white/10 hover:bg-white/20 text-white w-full py-3 rounded-md flex items-center justify-center gap-2 transition-colors border border-white/10"
                      onClick={() => setShowTerrainPopup(true)}
                    >
                      <Mountain aria-hidden="true" size={18} />
                      <span className="font-semibold">
                        View Terrain Details
                      </span>
                    </motion.button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>
      </section>

      {showTerrainPopup && terrainView && (
        <TerrainPopup
          cellId={terrainView.cellId}
          center={terrainView.center}
          bounds={terrainView.bounds}
          onClose={() => setShowTerrainPopup(false)}
        />
      )}
    </main>
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
          className="h-[1.4rem] w-[1.4rem] text-[var(--landing-accent)]"
        />
        <span>Yaad Guard</span>
      </Link>

      <div className="flex items-center gap-2 sm:gap-6">
        <Link
          to="/"
          className="hidden rounded-full px-4 py-2 text-[0.9rem] font-medium tracking-[0.3px] text-[var(--landing-text-secondary)] no-underline transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-white/5 hover:text-[var(--landing-text-primary)] md:inline"
        >
          Home
        </Link>
        <Link
          to="/about"
          className="hidden rounded-full px-4 py-2 text-[0.9rem] font-medium tracking-[0.3px] text-[var(--landing-text-secondary)] no-underline transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-white/5 hover:text-[var(--landing-text-primary)] md:inline"
        >
          About
        </Link>
        <a
          href="/#technology"
          className="hidden rounded-full px-4 py-2 text-[0.9rem] font-medium tracking-[0.3px] text-[var(--landing-text-secondary)] no-underline transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-white/5 hover:text-[var(--landing-text-primary)] md:inline"
        >
          Technology
        </a>
      </div>
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
}: {
  gridCenter: LngLatTuple
  focusTarget: FocusTarget | null
  clearSelectionVersion: number
  onCellSelect: (feature: GridCellFeature) => void
  waterDepths: number[] | null
  selectedCellBounds: BoundsTuple | null
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hoveredFeatureIdRef = useRef<number | null>(null)
  const activeFeatureIdRef = useRef<number | null>(null)
  const isReadyRef = useRef(false)
  const latestGridCenterRef = useRef(gridCenter)

  latestGridCenterRef.current = gridCenter

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
    })

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'bottom-right',
    )

    const setGridData = (center: LngLatTuple) => {
      const source = map.getSource(GRID_SOURCE_ID)
      const data = createGridFeatureCollection({ center })

      if (isGeoJSONSource(source)) {
        source.setData(data)
        return
      }

      map.addSource(GRID_SOURCE_ID, {
        type: 'geojson',
        data,
      })
    }

    const clearHoverState = () => {
      if (hoveredFeatureIdRef.current !== null) {
        map.setFeatureState(
          { source: GRID_SOURCE_ID, id: hoveredFeatureIdRef.current },
          { hover: false },
        )
      }

      hoveredFeatureIdRef.current = null
    }

    const clearActiveState = () => {
      if (activeFeatureIdRef.current !== null) {
        map.setFeatureState(
          { source: GRID_SOURCE_ID, id: activeFeatureIdRef.current },
          { active: false },
        )
      }

      activeFeatureIdRef.current = null
    }

    const handleMouseMove = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0]
      if (!feature || feature.id === undefined) {
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
      map.getCanvas().style.cursor = ''
      clearHoverState()
    }

    const handleClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0]

      if (
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

      onCellSelect({
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

    map.on('load', () => {
      setGridData(latestGridCenterRef.current)

      map.addLayer({
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
      })

      map.addLayer({
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
      })

      map.on('mousemove', GRID_FILL_LAYER_ID, handleMouseMove)
      map.on('mouseleave', GRID_FILL_LAYER_ID, handleMouseLeave)
      map.on('click', GRID_FILL_LAYER_ID, handleClick)
      isReadyRef.current = true
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      isReadyRef.current = false
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isReadyRef.current) {
      return
    }

    const source = map.getSource(GRID_SOURCE_ID)
    if (!isGeoJSONSource(source)) {
      return
    }

    source.setData(createGridFeatureCollection({ center: gridCenter }))
  }, [gridCenter])

  useEffect(() => {
    const map = mapRef.current
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
    const map = mapRef.current
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

  // Water depth overlay
  useEffect(() => {
    const map = mapRef.current
    if (!map || !isReadyRef.current) {
      return
    }

    // Remove existing water layer and source
    if (map.getLayer(WATER_FILL_LAYER_ID)) {
      map.removeLayer(WATER_FILL_LAYER_ID)
    }
    if (map.getSource(WATER_SOURCE_ID)) {
      map.removeSource(WATER_SOURCE_ID)
    }

    // Exit if no depths or no bounds
    if (!waterDepths || !selectedCellBounds) {
      return
    }

    const SUB_GRID_SIZE = 20
    const [[west, south], [east, north]] = selectedCellBounds
    const latStep = (north - south) / SUB_GRID_SIZE
    const lngStep = (east - west) / SUB_GRID_SIZE

    console.log('[WaterOverlay] Bounds:', { west, south, east, north })
    console.log('[WaterOverlay] Steps:', { latStep, lngStep })
    console.log('[WaterOverlay] waterDepths length:', waterDepths.length)
    console.log('[WaterOverlay] waterDepths sample:', waterDepths.slice(0, 25))

    // Create GeoJSON polygons for each sub-grid cell
    // Row 0 is at TOP (north), row (SUB_GRID_SIZE-1) is at BOTTOM (south)
    // Col 0 is at LEFT (west), col (SUB_GRID_SIZE-1) is at RIGHT (east)
    const features: GeoJSON.Feature<GeoJSON.Polygon>[] = []
    const featuresByRow: number[] = new Array(SUB_GRID_SIZE).fill(0)

    for (let row = 0; row < SUB_GRID_SIZE; row++) {
      for (let col = 0; col < SUB_GRID_SIZE; col++) {
        const idx = row * SUB_GRID_SIZE + col
        const depth = waterDepths[idx] ?? 0

        if (depth <= 0) continue

        // Row 0 starts at north, each row moves south by latStep
        const cellNorth = north - row * latStep
        const cellSouth = cellNorth - latStep
        // Col 0 starts at west, each col moves east by lngStep
        const cellWest = west + col * lngStep
        const cellEast = cellWest + lngStep

        featuresByRow[row]++
        features.push({
          type: 'Feature',
          properties: { depth },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [cellWest, cellSouth],
                [cellEast, cellSouth],
                [cellEast, cellNorth],
                [cellWest, cellNorth],
                [cellWest, cellSouth],
              ],
            ],
          },
        })
      }
    }

    console.log('[WaterOverlay] Features by row:', featuresByRow)
    console.log('[WaterOverlay] Total features:', features.length)

    if (features.length === 0) return

    map.addSource(WATER_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    })

    map.addLayer({
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
    })
  }, [waterDepths, selectedCellBounds])

  return (
    <div
      ref={containerRef}
      className="map-page__map"
      aria-label="Interactive map"
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  )
}
