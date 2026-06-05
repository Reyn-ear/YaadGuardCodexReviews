import { useEffect, useRef, useState } from 'react'
import { X, RotateCcw } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import {
  TERRAIN_BASE_SHIFT,
  TERRAIN_BLUE_FACTOR,
  DEFAULT_MAP_ZOOM,
  TERRAIN_EXAGGERATION,
  TERRAIN_GREEN_FACTOR,
  TERRAIN_HILLSHADE_SOURCE_ID,
  TERRAIN_MAX_ZOOM,
  TERRAIN_MIN_ZOOM,
  TERRAIN_RED_FACTOR,
  TERRAIN_SOURCE_ID,
  TERRAIN_TILE_URL,
} from './config'
import type { BoundsTuple, LngLatTuple } from './types'

interface TerrainPopupProps {
  cellId: string
  center: LngLatTuple
  bounds: BoundsTuple
  onClose: () => void
}

export function TerrainPopup({
  cellId,
  center,
  bounds,
  onClose,
}: TerrainPopupProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const tileErrorCountRef = useRef(0)
  const totalTilesRef = useRef(0)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }

    setIsLoading(true)
    setError(null)
    tileErrorCountRef.current = 0
    totalTilesRef.current = 0

    const [sw, ne] = bounds
    const lngPadding = Math.max((ne[0] - sw[0]) * 3, 0.035)
    const latPadding = Math.max((ne[1] - sw[1]) * 3, 0.03)
    const expandedBounds: BoundsTuple = [
      [center[0] - lngPadding, center[1] - latPadding],
      [center[0] + lngPadding, center[1] + latPadding],
    ]

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          [TERRAIN_SOURCE_ID]: {
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
          },
          [TERRAIN_HILLSHADE_SOURCE_ID]: {
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
          },
          'terrain-focus': {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: {},
                  geometry: {
                    type: 'Polygon',
                    coordinates: [
                      [
                        [sw[0], sw[1]],
                        [ne[0], sw[1]],
                        [ne[0], ne[1]],
                        [sw[0], ne[1]],
                        [sw[0], sw[1]],
                      ],
                    ],
                  },
                },
                {
                  type: 'Feature',
                  properties: { cellId },
                  geometry: {
                    type: 'Point',
                    coordinates: center,
                  },
                },
              ],
            },
          },
        },
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: {
              'background-color': '#0a0a1a',
            },
          },
          {
            id: 'terrain-hillshade',
            type: 'hillshade',
            source: TERRAIN_HILLSHADE_SOURCE_ID,
            paint: {
              'hillshade-exaggeration': 0.5,
              'hillshade-shadow-color': '#1a1a2e',
              'hillshade-highlight-color': '#60d4ff',
              'hillshade-accent-color': '#38bdf8',
            },
          },
          {
            id: 'terrain-focus-fill',
            type: 'fill',
            source: 'terrain-focus',
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {
              'fill-color': '#38bdf8',
              'fill-opacity': 0.14,
            },
          },
          {
            id: 'terrain-focus-outline',
            type: 'line',
            source: 'terrain-focus',
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {
              'line-color': '#b7f0ff',
              'line-width': 3,
              'line-opacity': 0.95,
            },
          },
          {
            id: 'terrain-focus-point',
            type: 'circle',
            source: 'terrain-focus',
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
              'circle-radius': 7,
              'circle-color': '#e0f2fe',
              'circle-stroke-color': '#38bdf8',
              'circle-stroke-width': 3,
            },
          },
          {
            id: 'terrain-focus-label',
            type: 'symbol',
            source: 'terrain-focus',
            filter: ['==', ['geometry-type'], 'Point'],
            layout: {
              'text-field': ['get', 'cellId'],
              'text-size': 13,
              'text-letter-spacing': 0.08,
              'text-font': ['Open Sans Semibold'],
              'text-offset': [0, -1.5],
              'text-anchor': 'bottom',
            },
            paint: {
              'text-color': '#f8fdff',
              'text-halo-color': 'rgba(7, 17, 27, 0.92)',
              'text-halo-width': 1.5,
            },
          },
        ],
        terrain: {
          source: TERRAIN_SOURCE_ID,
          exaggeration: TERRAIN_EXAGGERATION,
        },
      },
      center: center,
      zoom: DEFAULT_MAP_ZOOM,
      pitch: 45,
      bearing: -20,
      maxZoom: TERRAIN_MAX_ZOOM,
      minZoom: TERRAIN_MIN_ZOOM,
    })
    let resizeFrame: number | null = null
    let loadingTimer: number | null = null

    const handleTileError = () => {
      tileErrorCountRef.current++
      if (
        totalTilesRef.current > 0 &&
        tileErrorCountRef.current >= totalTilesRef.current
      ) {
        setError('Failed to load terrain tiles. Click retry to try again.')
        setIsLoading(false)
      }
    }

    map.on('error', handleTileError)

    map.on('load', () => {
      map.fitBounds(
        [
          [expandedBounds[0][0], expandedBounds[0][1]],
          [expandedBounds[1][0], expandedBounds[1][1]],
        ],
        {
          padding: 60,
          duration: 1000,
          pitch: 45,
          bearing: -20,
          maxZoom: DEFAULT_MAP_ZOOM,
        },
      )

      resizeFrame = window.requestAnimationFrame(() => {
        map.resize()
      })

      loadingTimer = window.setTimeout(() => {
        map.resize()
        setIsLoading(false)
      }, 0)
    })

    mapRef.current = map

    return () => {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame)
      }

      if (loadingTimer !== null) {
        window.clearTimeout(loadingTimer)
      }

      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [cellId, center, bounds, retryCount])

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1)
  }

  return (
    <div className="terrain-popup__overlay" onClick={onClose}>
      <div
        className="terrain-popup__content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="terrain-popup__header">
          <div>
            <p className="terrain-popup__eyebrow">Terrain View</p>
            <h2 className="terrain-popup__heading">Region {cellId}</h2>
          </div>
          <button
            className="terrain-popup__close"
            onClick={onClose}
            aria-label="Close terrain view"
          >
            <X size={20} />
          </button>
        </div>
        <div className="terrain-popup__body">
          <div className="terrain-popup__focus-badge">
            <span className="terrain-popup__focus-label">Focused cell</span>
            <strong>{cellId}</strong>
          </div>
          {isLoading && (
            <div className="terrain-popup__loading">
              <div className="terrain-popup__spinner" />
              <span>Loading terrain...</span>
            </div>
          )}
          {error && (
            <div className="terrain-popup__error">
              <span>{error}</span>
              <button
                className="terrain-popup__retry"
                onClick={handleRetry}
                aria-label="Retry loading terrain"
              >
                <RotateCcw size={16} />
                Retry
              </button>
            </div>
          )}
          <div
            ref={containerRef}
            className="terrain-popup__map"
            style={{ opacity: isLoading || error ? 0 : 1 }}
          />
        </div>
        <div className="terrain-popup__footer">
          <p>
            Drag to pan, scroll to zoom. Pitch and bearing can be adjusted by
            right-click dragging.
          </p>
        </div>
      </div>
    </div>
  )
}
