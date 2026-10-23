import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useListbox, type ListboxOptions, type ListboxItems } from './useListbox'

// Presentation stays bounded while the shared listbox navigates every item.
// Keep the tab stop mounted when the user scrolls it out of view, and mount a
// requested keyboard destination before handing it DOM focus.
export function useVirtualListbox<T extends HTMLElement>({
  ids, items: suppliedItems, getLabel, estimateSize, padding = 0, gap = 8, ...options
}: Omit<ListboxOptions, 'onNavigate'> & {
  getLabel?: (index: number) => string
  estimateSize: number
  padding?: number
  gap?: number
} & ({ ids: string[]; items?: never } | { items: ListboxItems; ids?: never })) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [focusRequest, setFocusRequest] = useState<string | null>(null)
  const indices = useMemo(() => new Map((ids ?? []).map((id, index) => [id, index])), [ids])
  const items = useMemo(() => suppliedItems ?? ({
    count: ids?.length ?? 0,
    idAt: (index: number) => ids![index],
    indexOf: (id: string) => indices.get(id) ?? -1,
    findPrefix: getLabel ? (prefix: string, after: number): number => {
      for (let distance = 1; distance <= ids!.length; distance++) {
        const index = (after + distance) % ids!.length
        if (getLabel(index).trim().toLowerCase().startsWith(prefix)) return index
      }
      return -1
    } : undefined,
  }), [suppliedItems, ids, indices, getLabel])
  const requestFocus = useCallback((id: string): void => { setFocusRequest(id) }, [])
  const listbox = useListbox<T>({ ...options, items, onNavigate: requestFocus })
  const getItemKey = useCallback((index: number) => items.idAt(index), [items])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: items.count,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => estimateSize,
    overscan: 3,
    gap,
    paddingStart: padding,
    paddingEnd: padding,
    measureElement: (element) => element.offsetHeight,
    rangeExtractor: (range) => {
      const visible = new Set(defaultRangeExtractor(range))
      for (const id of [listbox.activeId, focusRequest]) {
        const index = id === null ? -1 : items.indexOf(id)
        if (index >= 0) visible.add(index)
      }
      return [...visible].sort((a, b) => a - b)
    },
  })
  useLayoutEffect(() => {
    if (!focusRequest) return
    const index = items.indexOf(focusRequest)
    if (index >= 0) {
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
      'aria-setsize': items.count,
      'aria-posinset': items.indexOf(id) + 1,
    }),
    rowStyle: (start: number): CSSProperties => ({
      position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${start}px)`,
    }),
  }
}
