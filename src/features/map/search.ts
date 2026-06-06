import {
  constrainSearchResult,
  serializeBoundsForGeocoder,
} from './cameraBounds'
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

function isPhotonResponse(value: unknown): value is PhotonResponse {
  return typeof value === 'object' && value !== null
}

export async function searchPlaces(query: string): Promise<SearchResult[]> {
  const trimmedQuery = query.trim()

  if (!trimmedQuery) {
    return []
  }

  const url = new URL(GEOCODER_ENDPOINT)
  url.searchParams.set('q', trimmedQuery)
  url.searchParams.set('limit', '5')
  url.searchParams.set('bbox', serializeBoundsForGeocoder())

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

    return constrainSearchResult({
      label: formatLabel(feature),
      center,
      ...(bounds ? { bounds } : {}),
    })
  })

  return results.filter((result): result is SearchResult => result !== null)
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
