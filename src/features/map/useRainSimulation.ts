import { useEffectEvent, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchSubGridElevations } from './elevation'
import { computeWaterDepths } from './rain-sim'
import type { BoundsTuple } from './types'

const SUB_GRID_SIZE = 20
const ELEVATION_STALE_TIME_MS = 10 * 60 * 1000
const ELEVATION_GC_TIME_MS = 30 * 60 * 1000

export function useRainSimulation(selectedCellBounds: BoundsTuple | null) {
  const [mmPerHr, setMmPerHr] = useState(0)
  const elevationQuery = useQuery({
    queryKey: ['sub-grid-elevations', selectedCellBounds, SUB_GRID_SIZE],
    queryFn: async () => {
      if (!selectedCellBounds) {
        return null
      }

      const result = await fetchSubGridElevations({
        data: { bounds: selectedCellBounds, subGridSize: SUB_GRID_SIZE },
      })

      return result.success ? result.elevations : null
    },
    enabled: selectedCellBounds !== null,
    staleTime: ELEVATION_STALE_TIME_MS,
    gcTime: ELEVATION_GC_TIME_MS,
    retry: false,
  })
  const subGridElevations = elevationQuery.data ?? null
  const waterDepths = subGridElevations
    ? computeWaterDepths(subGridElevations, mmPerHr)
    : []

  const handleRainChange = useEffectEvent((newMm: number) => {
    setMmPerHr(newMm)
  })

  return {
    elevationLoading: elevationQuery.isFetching,
    hasElevation: subGridElevations !== null,
    mmPerHr,
    onRainChange: handleRainChange,
    waterDepths,
  }
}
