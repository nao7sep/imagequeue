import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import type { ConceptFacetSummary, ConceptProbeSummary, ConceptRow } from '../../../shared/types'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import { message as msg } from '../../../shared/i18n/translate'
import { useI18n } from '../i18n/I18nContext'
import { useListbox, type ListboxItems } from '../hooks/useListbox'
import { useImeGuard } from '../utils/imeGuard'
import { presentFailure } from '../utils/failurePresentation'
import { SelectedActions, openSelectedActions } from './SelectedActions'
import { MenuItem } from './Menu'

type UseFilter = 'all' | 'unused' | 'used'
// Chips render in blocks so a long domain wraps across several virtual rows
// instead of mounting as one tall section.
const BLOCK_SIZE = 32

interface Block {
  probe: ConceptProbeSummary
  rows: ConceptRow[]
  first: boolean
  last: boolean
}

interface Props {
  facet: ConceptFacetSummary
  refreshToken: unknown
  onDeleteConcept: (row: ConceptRow) => Promise<void>
  onDeleteProbe: (probe: ConceptProbeSummary) => Promise<void>
  onDeleteFacet: () => Promise<void>
}

// The facet's domains and concepts load whole; the list mounts only the blocks
// near the viewport while keyboard navigation and type-ahead cover every row.
export function ConceptLibraryDetails({ facet, refreshToken, onDeleteConcept, onDeleteProbe, onDeleteFacet }: Props): React.JSX.Element {
  const i18n = useI18n()
  const { t } = i18n
  const [filter, setFilter] = useState('')
  const [useFilter, setUseFilter] = useState<UseFilter>('all')
  const [probes, setProbes] = useState<ConceptProbeSummary[]>([])
  const [rows, setRows] = useState<ConceptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<MessageKey | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [pendingFocus, setPendingFocus] = useState<string | null>(null)
  const actionsRef = useRef<HTMLButtonElement>(null)
  const isComposing = useImeGuard()

  useEffect(() => { setSelectedKey(null) }, [facet.id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      window.electronAPI.listConceptProbes(facet.id),
      window.electronAPI.listConceptRows(facet.id),
    ]).then(([probeList, conceptList]) => {
      if (cancelled) return
      setProbes(probeList)
      setRows(conceptList)
    }).catch((failure) => {
      if (!cancelled) setError(presentFailure('concept-details-load', failure))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [facet.id, refreshToken])

  // Domain sections, filtered: the search needle matches a concept's value or
  // its domain text; the use filter narrows rows; a section with no surviving
  // rows disappears (unless the domain itself matched the search).
  const sections = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const byProbe = new Map<number, ConceptRow[]>()
    for (const row of rows) {
      if (useFilter === 'unused' && row.useCount > 0) continue
      if (useFilter === 'used' && row.useCount === 0) continue
      const list = byProbe.get(row.probeId) ?? []
      list.push(row)
      byProbe.set(row.probeId, list)
    }
    return probes
      .map((probe) => {
        const domainMatches = needle.length > 0 && probe.display.toLowerCase().includes(needle)
        let sectionRows = byProbe.get(probe.id) ?? []
        if (needle && !domainMatches) sectionRows = sectionRows.filter((row) => row.display.toLowerCase().includes(needle))
        return { probe, rows: sectionRows, domainMatches }
      })
      .filter((section) => needle ? section.domainMatches || section.rows.length > 0 : useFilter === 'all' || section.rows.length > 0)
  }, [probes, rows, filter, useFilter])

  const layout = useMemo(() => {
    const blocks: Block[] = []
    const ids: string[] = []
    const labels: string[] = []
    const blockOf = new Map<string, number>()
    const probeOf = new Map<string, ConceptProbeSummary>()
    const conceptOf = new Map<string, ConceptRow>()
    for (const { probe, rows: sectionRows } of sections) {
      const key = `p:${probe.id}`
      ids.push(key); labels.push(probe.display); blockOf.set(key, blocks.length); probeOf.set(key, probe)
      const count = Math.max(1, Math.ceil(sectionRows.length / BLOCK_SIZE))
      for (let page = 0; page < count; page++) {
        const blockRows = sectionRows.slice(page * BLOCK_SIZE, (page + 1) * BLOCK_SIZE)
        for (const row of blockRows) {
          const rowKey = `c:${row.id}`
          ids.push(rowKey); labels.push(row.display); blockOf.set(rowKey, blocks.length); conceptOf.set(rowKey, row)
        }
        blocks.push({ probe, rows: blockRows, first: page === 0, last: page === count - 1 })
      }
    }
    return { blocks, ids, labels, blockOf, probeOf, conceptOf, indices: new Map(ids.map((id, index) => [id, index])) }
  }, [sections])

  const items = useMemo<ListboxItems>(() => ({
    count: loading || error ? 0 : layout.ids.length,
    idAt: (index) => layout.ids[index],
    indexOf: (id) => loading || error ? -1 : layout.indices.get(id) ?? -1,
    findPrefix: (prefix, after) => {
      for (let distance = 1; distance <= layout.ids.length; distance++) {
        const index = (after + distance) % layout.ids.length
        if (layout.labels[index].trim().toLowerCase().startsWith(prefix)) return index
      }
      return -1
    },
  }), [layout, loading, error])
  const select = useCallback((key: string): void => { setSelectedKey(key) }, [])
  const { activeId, listboxProps, getOptionProps } = useListbox<HTMLDivElement>({
    items, selectedId: selectedKey, onSelect: select, onNavigate: setPendingFocus,
    activation: 'follows-focus', isComposing,
  })
  const activeBlock = activeId ? layout.blockOf.get(activeId) ?? -1 : -1
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: layout.blocks.length,
    overscan: 1,
    getScrollElement: () => listboxProps.ref.current,
    getItemKey: (block) => `${layout.blocks[block].probe.id}:${block}`,
    estimateSize: (block) => {
      const width = listboxProps.ref.current?.clientWidth ?? 600
      const chipRows = Math.ceil(layout.blocks[block].rows.length / Math.max(1, Math.floor(width / 240)))
      return chipRows * 48 + (layout.blocks[block].first ? 56 : 0) + (layout.blocks[block].last ? 12 : 0)
    },
    measureElement: (element) => element.offsetHeight,
    rangeExtractor: (range) => {
      const result = new Set(defaultRangeExtractor(range))
      for (const block of [activeBlock, pendingFocus ? layout.blockOf.get(pendingFocus) ?? -1 : -1]) {
        if (block >= 0) result.add(block)
      }
      return [...result].sort((a, b) => a - b)
    },
  })

  useLayoutEffect(() => {
    if (!pendingFocus) return
    const block = layout.blockOf.get(pendingFocus)
    if (block !== undefined) {
      virtualizer.scrollToIndex(block, { align: 'auto' })
      const option = listboxProps.ref.current?.querySelector<HTMLElement>(`[data-listbox-option="${CSS.escape(pendingFocus)}"]`)
      if (!option) return
      option.focus({ preventScroll: true })
      option.scrollIntoView({ block: 'nearest' })
    }
    setPendingFocus(null)
  })

  const activeConcept = activeId ? layout.conceptOf.get(activeId) : undefined
  const activeProbe = activeId ? layout.probeOf.get(activeId) : undefined
  const actionsDisabled = loading || error !== null || (!activeConcept && !activeProbe)
  const optionProps = (key: string) => {
    const props = getOptionProps(key)
    return { ...props, onFocus: () => { props.onFocus(); select(key) } }
  }
  return <div className="concept-library-detail">
    <div className="concept-library-toolbar">
      <input type="search" placeholder={t('conceptLibrary.filterPlaceholder')} value={filter}
        onChange={(event) => setFilter(event.target.value)} aria-label={t('conceptLibrary.filterLabel')} />
      <select value={useFilter} onChange={(event) => setUseFilter(event.target.value as UseFilter)} aria-label={t('conceptLibrary.show')}>
        <option value="all">{t('conceptLibrary.showAll')}</option><option value="unused">{t('conceptLibrary.showUnused')}</option><option value="used">{t('conceptLibrary.showUsed')}</option>
      </select>
      <SelectedActions triggerRef={actionsRef} disabled={actionsDisabled}>
        <MenuItem disabled={actionsDisabled} onSelect={() => {
          if (actionsDisabled) return
          if (activeProbe) void onDeleteProbe(activeProbe)
          else if (activeConcept) void onDeleteConcept(activeConcept)
        }}>{t('task.delete')}</MenuItem>
      </SelectedActions>
      <button className="modal-btn modal-btn-danger" onClick={() => void onDeleteFacet()}>{t('conceptLibrary.deleteFacetTitle')}</button>
    </div>
    <div className="concept-library-sections concept-library-virtual" aria-label={facet.display} aria-busy={loading} {...listboxProps}
      onKeyDown={(event) => {
        if (!isComposing(event.nativeEvent) && openSelectedActions(event, actionsRef)) return
        listboxProps.onKeyDown(event)
      }}>
      {loading ? <div className="concept-library-empty">{t('conceptLibrary.loadingFacet')}</div>
        : error ? <div className="concept-library-empty" role="alert">{t('conceptLibrary.facetFailed', { reason: t(error) })}</div>
        : layout.ids.length === 0 ? <div className="concept-library-empty">{t(rows.length === 0 ? 'conceptLibrary.facetEmpty' : 'conceptLibrary.noMatch')}</div>
        : <div className="concept-library-space" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtual) => {
            const block = layout.blocks[virtual.index]
            const probeKey = `p:${block.probe.id}`
            return <div key={virtual.key} className={`concept-library-block${block.last ? ' last' : ''}`}
              data-index={virtual.index} ref={virtualizer.measureElement} style={{ transform: `translateY(${virtual.start}px)` }}>
              <section className={`concept-library-section concept-library-page${block.first ? ' first' : ''}${block.last ? ' last' : ''}`} role="presentation">
                {block.first && <div className={`concept-library-section-header${selectedKey === probeKey ? ' selected' : ''}`} {...optionProps(probeKey)}
                  aria-posinset={items.indexOf(probeKey) + 1} aria-setsize={items.count}>
                  <div className="concept-library-section-title">{block.probe.display}</div>
                  <div className="concept-library-section-meta">{block.probe.expanded ? t('conceptLibrary.pair', {
                    first: msg('conceptLibrary.conceptCount', { count: block.probe.conceptCount }), second: msg('conceptLibrary.unusedCount', { count: block.probe.unusedCount }),
                  }) : t('conceptLibrary.notExpanded')}</div>
                  <button tabIndex={-1} className="modal-btn modal-btn-danger" onClick={() => void onDeleteProbe(block.probe)}>{t('task.delete')}</button>
                </div>}
                {block.rows.length > 0 && <div className="concept-library-rows" role="presentation">{block.rows.map((row) => {
                  const key = `c:${row.id}`
                  return <div key={row.id} className={`concept-library-row${selectedKey === key ? ' selected' : ''}`} {...optionProps(key)}
                    aria-posinset={items.indexOf(key) + 1} aria-setsize={items.count}
                    title={row.useCount === 0 ? t('conceptLibrary.neverUsedTitle', { added: i18n.dateTime(row.createdAt) }) : t('conceptLibrary.usedTitle', {
                      count: row.useCount, last: i18n.dateTime(row.lastUsedAt ?? row.createdAt), added: i18n.dateTime(row.createdAt),
                    })}>
                    <div className="concept-library-row-name">{row.display}</div>
                    <div className="concept-library-row-stats">{row.useCount === 0 ? t('conceptLibrary.unused') : t('conceptLibrary.timesUsed', { count: row.useCount })}</div>
                    <button tabIndex={-1} className="modal-btn modal-btn-danger" onClick={() => void onDeleteConcept(row)}>{t('task.delete')}</button>
                  </div>
                })}</div>}
              </section>
            </div>
          })}
        </div>}
    </div>
  </div>
}
