import { GEOCODER_ENDPOINT } from './config'
import type { SearchResult } from './types'

interface PhotonFeature {
  geometry?: {
    coordinates?: number[]
  }
  bbox?: number[]
  properties?: {
    name?: string
    street?: string
    city?: string
    county?: string
    state?: string
    country?: string
  }
}

interface PhotonResponse {
  features?: PhotonFeature[]
}

const KNOWN_CARIBBEAN_PLACES: SearchResult[] = [
  {
    label: 'Kingston, Jamaica',
    center: [-76.7928128, 17.9712148],
    bounds: [
      [-76.88, 17.9],
      [-76.72, 18.06],
    ],
  },
]

function isPhotonResponse(value: unknown): value is PhotonResponse {
  return typeof value === 'object' && value !== null
}

function findKnownCaribbeanPlaces(query: string) {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return []
  }

  return KNOWN_CARIBBEAN_PLACES.filter((place) =>
    place.label.toLowerCase().includes(normalizedQuery),
  )
}

export async function searchPlaces(query: string): Promise<SearchResult[]> {
  const trimmedQuery = query.trim()

  if (!trimmedQuery) {
    return []
  }

  const url = new URL(GEOCODER_ENDPOINT)
  url.searchParams.set('q', trimmedQuery)
  url.searchParams.set('limit', '5')
  // Restrict search to Latin America and the Caribbean region (minLon, minLat, maxLon, maxLat)
  url.searchParams.set('bbox', '-118.0,-56.0,-34.0,33.0')

  const fallbackResults = findKnownCaribbeanPlaces(trimmedQuery)

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error('Location lookup failed.')
    }

    const payload: unknown = await response.json()
    const features = isPhotonResponse(payload) ? (payload.features ?? []) : []

    const results: (SearchResult | null)[] = features.map((feature) => {
      const coordinates = feature.geometry?.coordinates
      if (!coordinates || coordinates.length < 2) {
        return null
      }

      const [lng, lat] = coordinates
      const center: SearchResult['center'] = [lng, lat]
      const bounds: SearchResult['bounds'] | undefined =
        feature.bbox && feature.bbox.length >= 4
          ? [
              [feature.bbox[0], feature.bbox[1]],
              [feature.bbox[2], feature.bbox[3]],
            ]
          : undefined

      return {
        label: formatLabel(feature),
        center,
        ...(bounds ? { bounds } : {}),
      }
    })

    const geocoderResults = results.filter(
      (result): result is SearchResult => result !== null,
    )

    return geocoderResults.length > 0 ? geocoderResults : fallbackResults
  } catch {
    return fallbackResults
  }
}

function formatLabel(feature: PhotonFeature) {
  const properties = feature.properties ?? {}
  const primary = properties.name ?? properties.street ?? 'Pinned location'
  const detail = [
    properties.city,
    properties.county,
    properties.state,
    properties.country,
  ].filter(Boolean)

  return [primary, ...detail].join(', ')
}
