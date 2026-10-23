import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useListbox, type ListboxOptions } from './useListbox'

// Presentation stays bounded while the shared listbox navigates every item.
// Keep the tab stop mounted when the user scrolls it out of view, and mount a
// requested keyboard destination before handing it DOM focus.
export function useVirtualListbox<T extends HTMLElement>({
  ids, getLabel, estimateSize, padding = 0, ...options
}: Omit<ListboxOptions, 'onNavigate'> & {
  ids: string[]
  getLabel?: (index: number) => string
  estimateSize: number
  padding?: number
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [focusRequest, setFocusRequest] = useState<string | null>(null)
  const indices = useMemo(() => new Map(ids.map((id, index) => [id, index])), [ids])
  const items = useMemo(() => ({
    count: ids.length,
    idAt: (index: number) => ids[index],
    indexOf: (id: string) => indices.get(id) ?? -1,
    findPrefix: getLabel ? (prefix: string, after: number): number => {
      for (let distance = 1; distance <= ids.length; distance++) {
        const index = (after + distance) % ids.length
        if (getLabel(index).trim().toLowerCase().startsWith(prefix)) return index
      }
      return -1
    } : undefined,
  }), [ids, indices, getLabel])
  const requestFocus = useCallback((id: string): void => { setFocusRequest(id) }, [])
  const listbox = useListbox<T>({ ...options, items, onNavigate: requestFocus })
  const getItemKey = useCallback((index: number) => ids[index], [ids])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: ids.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => estimateSize,
    overscan: 3,
    gap: 8,
    paddingStart: padding,
    paddingEnd: padding,
    measureElement: (element) => element.offsetHeight,
    rangeExtractor: (range) => {
      const visible = new Set(defaultRangeExtractor(range))
      for (const id of [listbox.activeId, focusRequest]) {
        const index = id === null ? undefined : indices.get(id)
        if (index !== undefined) visible.add(index)
      }
      return [...visible].sort((a, b) => a - b)
    },
  })
  useLayoutEffect(() => {
    if (!focusRequest) return
    const index = indices.get(focusRequest)
    if (index !== undefined) {
      virtualizer.scrollToIndex(index, { align: 'auto' })
      const target = listbox.listboxProps.ref.current
        ?.querySelector<HTMLElement>(`[data-listbox-option="${CSS.escape(focusRequest)}"]`)
      if (!target) return
      target.focus({ preventScroll: true })
    }
    setFocusRequest(null)
  })

  return {
    ...listbox,
    scrollRef,
    virtualizer,
    requestFocus,
    getOptionProps: (id: string) => ({
      ...listbox.getOptionProps(id),
      'aria-setsize': ids.length,
      'aria-posinset': (indices.get(id) ?? -1) + 1,
    }),
    rowStyle: (start: number): CSSProperties => ({
      position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${start}px)`,
    }),
  }
}
