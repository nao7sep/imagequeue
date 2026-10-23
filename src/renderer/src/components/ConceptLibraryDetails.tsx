import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import type { ConceptFacetSummary, ConceptProbeSummary, ConceptRow } from '../../../shared/types'
import type { ConceptLibraryIndex, ConceptLibraryItem, ConceptLibraryPage, ConceptLibraryQuery } from '../../../shared/concept-library'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import { message as msg } from '../../../shared/i18n/translate'
import { useI18n } from '../i18n/I18nContext'
import { useListbox } from '../hooks/useListbox'
import { useImeGuard } from '../utils/imeGuard'
import { conceptLibraryLayout, conceptLocationKey } from '../utils/conceptLibraryLayout'
import { presentFailure } from '../utils/failurePresentation'
import { SelectedActions, openSelectedActions } from './SelectedActions'
import { MenuItem } from './Menu'

type Page = Extract<ConceptLibraryPage, { stale: false }>
interface Props {
  facet: ConceptFacetSummary
  refreshToken: unknown
  onDeleteConcept: (row: ConceptRow) => Promise<void>
  onDeleteProbe: (probe: ConceptProbeSummary) => Promise<void>
  onDeleteFacet: () => Promise<void>
}

export function ConceptLibraryDetails({ facet, refreshToken, onDeleteConcept, onDeleteProbe, onDeleteFacet }: Props): React.JSX.Element {
  const i18n = useI18n()
  const { t } = i18n
  const [filter, setFilter] = useState('')
  const [useFilter, setUseFilter] = useState<ConceptLibraryQuery['useFilter']>('all')
  const query = useMemo(() => ({ facetId: facet.id, filter, useFilter }), [facet.id, filter, useFilter])
  const [index, setIndex] = useState<ConceptLibraryIndex | null>(null)
  const [pages, setPages] = useState<Map<number, Page>>(new Map())
  const pageCache = useRef(new Map<number, Page>())
  const pageReadBusy = useRef(false)
  const [pageReadWake, wakePageRead] = useState(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<MessageKey | null>(null)
  const [revisionRequest, reload] = useState(0)
  const epoch = useRef(0)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const selectedIdentity = useRef<ConceptLibraryItem | null>(null)
  const previousFacet = useRef(facet.id)
  const [pendingFocus, setPendingFocus] = useState<string | null>(null)
  const focusOrigin = useRef<Element | null>(null)
  const actionsRef = useRef<HTMLButtonElement>(null)
  const isComposing = useImeGuard()

  useEffect(() => {
    const request = ++epoch.current
    if (previousFacet.current !== facet.id) selectedIdentity.current = null
    previousFacet.current = facet.id
    setLoading(true); setError(null); setIndex(null); setSelectedKey(null); setPendingFocus(null)
    pageCache.current.clear(); setPages(new Map())
    void (async () => {
      try {
        const result = await window.electronAPI.queryConceptLibrary(query)
        let key: string | null = null
        if (selectedIdentity.current) {
          const found = await window.electronAPI.locateConceptLibraryItem(query, result.revision, selectedIdentity.current)
          if (request !== epoch.current) return
          if (found.stale) { reload((value) => value + 1); return }
          if (found.location) key = conceptLocationKey(found.location)
        }
        if (request !== epoch.current) return
        setIndex(result); setSelectedKey(key)
        if (!key) selectedIdentity.current = null
      } catch (failure) {
        if (request === epoch.current) setError(presentFailure('concept-details-load', failure))
      } finally {
        if (request === epoch.current) setLoading(false)
      }
    })()
    return () => { ++epoch.current }
  }, [query, facet.id, refreshToken, revisionRequest])

  const layout = useMemo(() => conceptLibraryLayout(index?.groups ?? []), [index])
  const activeKey = selectedKey && layout.indexOf(selectedKey) >= 0 ? selectedKey : layout.count ? layout.idAt(0) : null
  const activeBlock = activeKey ? layout.blockForLocation(layout.locationForKey(activeKey)) : -1
  const select = useCallback((key: string): void => { setSelectedKey(key) }, [])
  const navigate = useCallback((key: string): void => {
    focusOrigin.current = document.activeElement
    setPendingFocus(key)
  }, [])
  const items = useMemo(() => ({
    count: error || loading ? 0 : layout.count,
    idAt: layout.idAt,
    indexOf: layout.indexOf,
    findPrefix: async (prefix: string, afterIndex: number): Promise<number> => {
      if (!index) return -1
      const request = epoch.current
      try {
        const result = await window.electronAPI.searchConceptLibraryPrefix(query, index.revision, prefix,
          afterIndex < 0 ? null : layout.locationAt(afterIndex))
        if (request !== epoch.current) return -1
        if (result.stale) { reload((value) => value + 1); return -1 }
        return result.location ? layout.indexOfLocation(result.location) : -1
      } catch (failure) {
        if (request === epoch.current) setError(presentFailure('concept-details-load', failure))
        return -1
      }
    },
  }), [layout, error, loading, query, index])
  const { listboxProps, getOptionProps } = useListbox<HTMLDivElement>({
    items, selectedId: selectedKey, onSelect: select, onNavigate: navigate,
    activation: 'follows-focus', isComposing,
  })
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: layout.blocks.length,
    overscan: 1,
    getScrollElement: () => listboxProps.ref.current,
    getItemKey: (block) => `${layout.blocks[block].probeId}:${layout.blocks[block].offset}`,
    estimateSize: (block) => {
      const width = listboxProps.ref.current?.clientWidth ?? 600
      const rows = Math.ceil(layout.blocks[block].count / Math.max(1, Math.floor(width / 240)))
      return rows * 48 + (layout.blocks[block].first ? 56 : 0) + (layout.blocks[block].last ? 12 : 0)
    },
    measureElement: (element) => element.offsetHeight,
    rangeExtractor: (range) => {
      const result = new Set(defaultRangeExtractor(range))
      if (activeBlock >= 0) result.add(activeBlock)
      return [...result].sort((a, b) => a - b)
    },
  })
  const visible = virtualizer.getVirtualItems()
  const wanted = visible.map((block) => block.index).join(',')
  const wantedRef = useRef(new Set<number>())
  wantedRef.current = new Set(visible.map((block) => block.index))
  useEffect(() => {
    if (!index || error) return
    const request = epoch.current
    const wantedBlocks = wanted === '' ? [] : wanted.split(',').map(Number)
    for (const key of pageCache.current.keys()) if (!wantedRef.current.has(key)) pageCache.current.delete(key)
    setPages(new Map(pageCache.current))
    if (pageReadBusy.current) return
    const missing = wantedBlocks.filter((block) => !pageCache.current.has(block))
    if (missing.length === 0) return
    // At most one viewport batch is admitted. A rapid scroll replaces demand
    // while the existing reads settle instead of building an IPC request queue.
    pageReadBusy.current = true
    void Promise.all(missing.map(async (blockIndex) => {
      const block = layout.blocks[blockIndex]
      try {
        const result = await window.electronAPI.readConceptLibraryPage(query, index.revision, block.probeId, block.offset)
        if (request !== epoch.current) return
        if (result.stale) { reload((value) => value + 1); return }
        if (!wantedRef.current.has(blockIndex)) return
        pageCache.current.set(blockIndex, result)
        setPages(new Map(pageCache.current))
      } catch (failure) {
        if (request === epoch.current) setError(presentFailure('concept-details-load', failure))
      }
    })).finally(() => {
      pageReadBusy.current = false
      if (mounted.current) wakePageRead((value) => value + 1)
    })
  }, [wanted, index, layout, query, error, pageReadWake])

  const activeLocation = activeKey ? layout.locationForKey(activeKey) : null
  const activePage = pages.get(activeBlock)
  const activeConcept = activeLocation && activeLocation.offset >= 0 && activePage
    ? activePage.rows[activeLocation.offset - layout.blocks[activeBlock].offset] : undefined
  const activeProbe = activeLocation?.offset === -1 ? activePage?.probe : undefined
  const actionsDisabled = loading || error !== null || (!activeConcept && !activeProbe)
  useEffect(() => {
    if (selectedKey && activeConcept) selectedIdentity.current = { kind: 'concept', id: activeConcept.id }
    else if (selectedKey && activeProbe) selectedIdentity.current = { kind: 'probe', id: activeProbe.id }
  }, [selectedKey, activeConcept, activeProbe])

  useLayoutEffect(() => {
    if (!pendingFocus) return
    const block = layout.blockForLocation(layout.locationForKey(pendingFocus))
    if (block < 0 || !pages.has(block)) return
    const option = listboxProps.ref.current?.querySelector<HTMLElement>(`[data-listbox-option="${CSS.escape(pendingFocus)}"]`)
    if (!option) return
    virtualizer.scrollToIndex(block, { align: 'auto' })
    // A page may arrive after the user left the list. Never reclaim that focus.
    if (document.activeElement === focusOrigin.current || document.activeElement === document.body) {
      option.focus({ preventScroll: true })
      option.scrollIntoView({ block: 'nearest' })
    }
    setPendingFocus(null)
  }, [pendingFocus, pages, layout, virtualizer, listboxProps.ref])

  const optionProps = (key: string) => {
    const props = getOptionProps(key)
    return { ...props, onFocus: () => { props.onFocus(); select(key) } }
  }
  return <div className="concept-library-detail">
    <div className="concept-library-toolbar">
      <input type="search" placeholder={t('conceptLibrary.filterPlaceholder')} value={filter}
        onChange={(event) => setFilter(event.target.value)} aria-label={t('conceptLibrary.filterLabel')} />
      <select value={useFilter} onChange={(event) => setUseFilter(event.target.value as ConceptLibraryQuery['useFilter'])} aria-label={t('conceptLibrary.show')}>
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
    <div className="concept-library-sections concept-library-virtual" aria-label={facet.display} aria-busy={loading || (!error && layout.count > 0 && !activePage)} {...listboxProps} role="listbox" tabIndex={activePage && !error ? -1 : 0}
      onKeyDown={(event) => {
        if (!isComposing(event.nativeEvent) && openSelectedActions(event, actionsRef)) return
        listboxProps.onKeyDown(event)
      }}>
      {loading ? <div className="concept-library-empty">{t('conceptLibrary.loadingFacet')}</div>
        : error ? <div className="concept-library-empty" role="alert">{t('conceptLibrary.facetFailed', { reason: t(error) })}</div>
        : layout.count === 0 ? <div className="concept-library-empty">{t(index?.totalConceptCount === 0 ? 'conceptLibrary.facetEmpty' : 'conceptLibrary.noMatch')}</div>
        : <div className="concept-library-space" style={{ height: virtualizer.getTotalSize() }}>
          {visible.map((virtual) => {
            const block = layout.blocks[virtual.index]
            const page = pages.get(virtual.index)
            return <div key={virtual.key} className={`concept-library-block${block.last ? ' last' : ''}`}
              data-index={virtual.index} ref={page ? virtualizer.measureElement : undefined} style={{ transform: `translateY(${virtual.start}px)` }}>
              <section className={`concept-library-section concept-library-page${block.first ? ' first' : ''}${block.last ? ' last' : ''}`} role="presentation">
                {!page ? <div className="concept-library-empty" style={{ height: virtual.size }}>{t('conceptLibrary.loadingFacet')}</div> : <>
                  {block.first && <div className={`concept-library-section-header${selectedKey === `p:${block.probeId}` ? ' selected' : ''}`} {...optionProps(`p:${block.probeId}`)}>
                    <div className="concept-library-section-title">{page.probe.display}</div>
                    <div className="concept-library-section-meta">{page.probe.expanded ? t('conceptLibrary.pair', {
                      first: msg('conceptLibrary.conceptCount', { count: page.probe.conceptCount }), second: msg('conceptLibrary.unusedCount', { count: page.probe.unusedCount }),
                    }) : t('conceptLibrary.notExpanded')}</div>
                    <button tabIndex={-1} className="modal-btn modal-btn-danger" onClick={() => void onDeleteProbe(page.probe)}>{t('task.delete')}</button>
                  </div>}
                  {page.rows.length > 0 && <div className="concept-library-rows" role="presentation">{page.rows.map((row, offset) => {
                    const key = conceptLocationKey({ probeId: block.probeId, offset: block.offset + offset })
                    return <div key={row.id} className={`concept-library-row${selectedKey === key ? ' selected' : ''}`} {...optionProps(key)}
                      aria-posinset={layout.indexOf(key) + 1} aria-setsize={layout.count}
                      title={row.useCount === 0 ? t('conceptLibrary.neverUsedTitle', { added: i18n.dateTime(row.createdAt) }) : t('conceptLibrary.usedTitle', {
                        count: row.useCount, last: i18n.dateTime(row.lastUsedAt ?? row.createdAt), added: i18n.dateTime(row.createdAt),
                      })}>
                      <div className="concept-library-row-name">{row.display}</div>
                      <div className="concept-library-row-stats">{row.useCount === 0 ? t('conceptLibrary.unused') : t('conceptLibrary.timesUsed', { count: row.useCount })}</div>
                      <button tabIndex={-1} className="modal-btn modal-btn-danger" onClick={() => void onDeleteConcept(row)}>{t('task.delete')}</button>
                    </div>
                  })}</div>}
                </>}
              </section>
            </div>
          })}
        </div>}
    </div>
  </div>
}
