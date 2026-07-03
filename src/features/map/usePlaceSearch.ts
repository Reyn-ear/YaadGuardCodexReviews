import { useCallback, useState } from 'react'
import { useDebouncedValue } from '@tanstack/react-pacer'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { searchPlaces } from './search'
import type { SearchResult } from './types'

const SEARCH_PLACEHOLDER = 'Search regions...'
const SEARCH_DEBOUNCE_MS = 600
const SEARCH_STALE_TIME_MS = 5 * 60 * 1000
const SEARCH_GC_TIME_MS = 30 * 60 * 1000
const SEARCH_QUERY_KEY = 'place-search'
const EMPTY_SEARCH_RESULTS: SearchResult[] = []

interface UsePlaceSearchOptions {
  onSelect: (result: SearchResult) => void
  onNoResults: () => void
  onSearchError: () => void
}

export function usePlaceSearch({
  onSelect,
  onNoResults,
  onSearchError,
}: UsePlaceSearchOptions) {
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const queryClient = useQueryClient()
  const [debouncedQuery, searchDebouncer] = useDebouncedValue(
    query.trim(),
    { wait: SEARCH_DEBOUNCE_MS },
    (state) => ({ isPending: state.isPending }),
  )
  const isWaiting = query.trim() !== '' && searchDebouncer.state.isPending

  const handleSelect = useCallback(
    (result: SearchResult) => onSelect(result),
    [onSelect],
  )
  const handleNoResults = useCallback(() => onNoResults(), [onNoResults])
  const handleSearchError = useCallback(() => onSearchError(), [onSearchError])
  const searchQueryOptions = {
    queryKey: [SEARCH_QUERY_KEY, debouncedQuery],
    queryFn: () => searchPlaces(debouncedQuery),
    enabled: debouncedQuery.length >= 3,
    staleTime: SEARCH_STALE_TIME_MS,
    gcTime: SEARCH_GC_TIME_MS,
    retry: false,
  } as const
  const { data: searchResults } = useQuery(searchQueryOptions)
  const activeSearchCount = useIsFetching({ queryKey: [SEARCH_QUERY_KEY] })
  const suggestions = searchResults ?? EMPTY_SEARCH_RESULTS

  const updateQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery)
    setMessage(null)
  }, [])

  const selectResult = useCallback(
    (result: SearchResult) => {
      setQuery('')
      setMessage(null)
      handleSelect(result)
    },
    [handleSelect],
  )

  const submit = useCallback(async () => {
    const topSuggestion = suggestions.at(0)
    if (topSuggestion) {
      selectResult(topSuggestion)
      return
    }

    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      setMessage('Enter a place or landmark to reposition the map.')
      return
    }

    setMessage(null)

    try {
      const results = await queryClient.fetchQuery({
        queryKey: [SEARCH_QUERY_KEY, trimmedQuery],
        queryFn: () => searchPlaces(trimmedQuery),
        staleTime: SEARCH_STALE_TIME_MS,
        gcTime: SEARCH_GC_TIME_MS,
        retry: false,
      })
      const selectedResult = results.at(0)

      if (!selectedResult) {
        handleNoResults()
        setMessage('No results matched that search.')
        return
      }

      selectResult(selectedResult)
    } catch {
      handleSearchError()
      setMessage('Search request failed. Please retry.')
    }
  }, [
    handleNoResults,
    handleSearchError,
    query,
    queryClient,
    selectResult,
    suggestions,
  ])

  const clearMessage = useCallback(() => setMessage(null), [])

  return {
    query,
    setQuery: updateQuery,
    message,
    isSearching: activeSearchCount > 0,
    isWaiting,
    suggestions,
    isFocused,
    setIsFocused,
    placeholder: SEARCH_PLACEHOLDER,
    clearMessage,
    selectResult,
    submit,
  }
}
