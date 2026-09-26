import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { useConfirm } from '../context/ConfirmContext'
import { useListbox } from '../hooks/useListbox'
import { useI18n } from '../i18n/I18nContext'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import { message as msg } from '../../../shared/i18n/translate'
import { presentFailure } from '../utils/failurePresentation'
import type { ConceptFacetSummary, ConceptProbeSummary, ConceptRow } from '../../../shared/types'
import './ConceptLibraryModal.css'

interface Props {
  onClose: () => void
}

type UseFilter = 'all' | 'unused' | 'used'

// Browses and manages the concept ledger (concepts.sqlite3) at its real
// hierarchy: facet → domain (the narrow ask a cluster was mined from) →
// concept. Deletion exists at every level and always cascades downward;
// deleting drops rows, it does not blocklist — a future planning ask may
// re-discover anything removed here. The ledger is written only by brainstorm
// runs, so this modal never creates or edits rows.
export function ConceptLibraryModal({ onClose }: Props): React.JSX.Element {
  const confirm = useConfirm()
  const i18n = useI18n()
  const { t } = i18n
  const date = (iso: string): string => i18n.dateTime(iso)
  const [facets, setFacets] = useState<ConceptFacetSummary[]>([])
  const [facetsLoading, setFacetsLoading] = useState(true)
  const [facetsError, setFacetsError] = useState<MessageKey | null>(null)
  const [selectedFacetId, setSelectedFacetId] = useState<number | null>(null)
  const [probes, setProbes] = useState<ConceptProbeSummary[]>([])
  const [rows, setRows] = useState<ConceptRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<MessageKey | null>(null)
  const [filter, setFilter] = useState('')
  const [useFilter, setUseFilter] = useState<UseFilter>('all')
  const [message, setMessage] = useState<MessageKey | null>(null)

  const refreshFacets = useCallback(async (): Promise<void> => {
    setFacetsLoading(true)
    setFacetsError(null)
    try {
      const list = await window.electronAPI.listConceptFacets()
      setFacets(list)
      setSelectedFacetId((prev) =>
        prev !== null && list.some((f) => f.id === prev) ? prev : list[0]?.id ?? null
      )
    } catch (error) {
      setFacetsError(presentFailure('concepts-load', error))
    } finally {
      setFacetsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshFacets()
  }, [refreshFacets])

  useEffect(() => {
    if (selectedFacetId === null) {
      setProbes([])
      setRows([])
      setDetailLoading(false)
      setDetailError(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    setProbes([])
    setRows([])
    Promise.all([
      window.electronAPI.listConceptProbes(selectedFacetId),
      window.electronAPI.listConceptRows(selectedFacetId),
    ])
      .then(([probeList, conceptList]) => {
        if (cancelled) return
        setProbes(probeList)
        setRows(conceptList)
      })
      .catch((error) => {
        if (!cancelled) setDetailError(presentFailure('concept-details-load', error))
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedFacetId, facets])

  const { listboxProps, getOptionProps } = useListbox<HTMLDivElement>({
    ids: facets.map((f) => String(f.id)),
    selectedId: selectedFacetId !== null ? String(selectedFacetId) : null,
    onSelect: (id) => setSelectedFacetId(Number(id)),
    activation: 'follows-focus',
  })

  const selectedFacet = facets.find((f) => f.id === selectedFacetId) ?? null

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
        if (needle && !domainMatches) {
          sectionRows = sectionRows.filter((r) => r.display.toLowerCase().includes(needle))
        }
        return { probe, rows: sectionRows, domainMatches }
      })
      .filter((section) =>
        needle
          ? section.domainMatches || section.rows.length > 0
          : useFilter === 'all' || section.rows.length > 0
      )
  }, [probes, rows, filter, useFilter])

  const withRefresh = useCallback(
    async (action: () => Promise<void>): Promise<void> => {
      setMessage(null)
      try {
        await action()
        await refreshFacets()
      } catch (error) {
        setMessage(presentFailure('concepts-change', error))
      }
    },
    [refreshFacets]
  )

  const handleDeleteConcept = useCallback(async (row: ConceptRow): Promise<void> => {
    const ok = await confirm({
      title: t('conceptLibrary.deleteConceptTitle'),
      message: t('conceptLibrary.deleteConceptMessage', { name: row.display }),
      confirmLabel: t('task.delete'),
      danger: true,
    })
    if (ok) await withRefresh(() => window.electronAPI.deleteConceptRow(row.id))
  }, [confirm, withRefresh, t])

  const handleDeleteProbe = useCallback(async (probe: ConceptProbeSummary): Promise<void> => {
    const ok = await confirm({
      title: t('conceptLibrary.deleteDomainTitle'),
      message: t('conceptLibrary.deleteDomainMessage', { name: probe.display, count: probe.conceptCount }),
      confirmLabel: t('task.delete'),
      danger: true,
    })
    if (ok) await withRefresh(() => window.electronAPI.deleteConceptProbe(probe.id))
  }, [confirm, withRefresh, t])

  const handleDeleteFacet = useCallback(async (): Promise<void> => {
    if (!selectedFacet) return
    const ok = await confirm({
      title: t('conceptLibrary.deleteFacetTitle'),
      message: t('conceptLibrary.deleteFacetMessage', {
        name: selectedFacet.display,
        domains: msg('conceptLibrary.domainCount', { count: selectedFacet.probeCount }),
        concepts: msg('conceptLibrary.conceptCount', { count: selectedFacet.conceptCount }),
      }),
      confirmLabel: t('task.delete'),
      danger: true,
    })
    if (ok) await withRefresh(() => window.electronAPI.deleteConceptFacet(selectedFacet.id))
  }, [confirm, selectedFacet, withRefresh, t])

  const totals = useMemo(() => {
    if (facets.length === 0) return null
    return {
      facets: facets.length,
      domains: facets.reduce((n, f) => n + f.probeCount, 0),
      concepts: facets.reduce((n, f) => n + f.conceptCount, 0),
      unused: facets.reduce((n, f) => n + f.unusedCount, 0),
    }
  }, [facets])

  return (
    <Modal
      title={t('menu.conceptLibrary')}
      className="concept-library-modal-box"
      onClose={onClose}
      footer={
        <>
          {totals && (
            <span className="concept-library-totals modal-footer-lead">
              {t('conceptLibrary.totals', {
                facets: msg('conceptLibrary.facetCount', { count: totals.facets }),
                domains: msg('conceptLibrary.domainCount', { count: totals.domains }),
                concepts: msg('conceptLibrary.conceptCount', { count: totals.concepts }),
                unused: msg('conceptLibrary.unusedCount', { count: totals.unused }),
              })}
            </span>
          )}
          <button className="modal-btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <div className="concept-library-body">
        {message && <div className="concept-library-message" role="alert">{t(message)}</div>}
        {facetsError && (
          <div className="concept-library-message" role="alert">{t(facetsError)}</div>
        )}
        <div className={`concept-library-columns${facets.length === 0 ? ' concept-library-columns-empty' : ''}`}>
            <div className="concept-library-facets" aria-label={t('conceptLibrary.facets')} aria-busy={facetsLoading} {...listboxProps}>
              {facets.length === 0 && (
                <div className="concept-library-empty" role="presentation">
                  {facetsLoading
                    ? t('conceptLibrary.loading')
                    : facetsError
                      ? t('conceptLibrary.unavailable')
                      : t('conceptLibrary.empty')}
                </div>
              )}
              {facets.map((facet) => (
                <div
                  key={facet.id}
                  className={`concept-library-facet${facet.id === selectedFacetId ? ' selected' : ''}`}
                  {...getOptionProps(String(facet.id))}
                >
                  <div className="concept-library-facet-name">{facet.display}</div>
                  <div className="concept-library-facet-meta">
                    {t('conceptLibrary.pair', {
                      first: msg('conceptLibrary.conceptCount', { count: facet.conceptCount }),
                      second: msg('conceptLibrary.unusedCount', { count: facet.unusedCount }),
                    })}
                  </div>
                  <div className="concept-library-facet-meta">
                    {facet.lastUsedAt
                      ? t('conceptLibrary.pair', {
                          first: msg('conceptLibrary.domainCount', { count: facet.probeCount }),
                          second: msg('conceptLibrary.lastUsed', { date: date(facet.lastUsedAt) }),
                        })
                      : t('conceptLibrary.domainCount', { count: facet.probeCount })}
                  </div>
                </div>
              ))}
            </div>

            <div className="concept-library-detail">
              {selectedFacet && (
                <>
                  <div className="concept-library-toolbar">
                    <input
                      type="search"
                      placeholder={t('conceptLibrary.filterPlaceholder')}
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      aria-label={t('conceptLibrary.filterLabel')}
                    />
                    <select
                      value={useFilter}
                      onChange={(e) => setUseFilter(e.target.value as UseFilter)}
                      aria-label={t('conceptLibrary.show')}
                    >
                      <option value="all">{t('conceptLibrary.showAll')}</option>
                      <option value="unused">{t('conceptLibrary.showUnused')}</option>
                      <option value="used">{t('conceptLibrary.showUsed')}</option>
                    </select>
                    <button
                      className="modal-btn modal-btn-danger"
                      onClick={() => void handleDeleteFacet()}
                    >
                      {t('conceptLibrary.deleteFacetTitle')}
                    </button>
                  </div>

                  {detailLoading ? (
                    <div className="concept-library-empty">{t('conceptLibrary.loadingFacet')}</div>
                  ) : detailError ? (
                    <div className="concept-library-empty" role="alert">{t('conceptLibrary.facetFailed', { reason: t(detailError) })}</div>
                  ) : sections.length === 0 ? (
                    <div className="concept-library-empty">
                      {rows.length === 0
                        ? t('conceptLibrary.facetEmpty')
                        : t('conceptLibrary.noMatch')}
                    </div>
                  ) : (
                    <div className="concept-library-sections">
                      {sections.map(({ probe, rows: sectionRows }) => (
                        <section key={probe.id} className="concept-library-section">
                          <div className="concept-library-section-header">
                            <div className="concept-library-section-title" title={probe.display}>
                              {probe.display}
                            </div>
                            <div className="concept-library-section-meta">
                              {probe.expanded
                                ? t('conceptLibrary.pair', {
                                    first: msg('conceptLibrary.conceptCount', { count: probe.conceptCount }),
                                    second: msg('conceptLibrary.unusedCount', { count: probe.unusedCount }),
                                  })
                                : t('conceptLibrary.notExpanded')}
                            </div>
                            <button
                              tabIndex={-1}
                              className="modal-btn modal-btn-danger"
                              onClick={() => void handleDeleteProbe(probe)}
                            >
                              {t('task.delete')}
                            </button>
                          </div>
                          {sectionRows.length > 0 && (
                            <div className="concept-library-rows">
                              {sectionRows.map((row) => (
                                /* The chip shows what gets consulted — the value
                                   and how spent it is; WHEN it was last drawn is
                                   trivia, so it lives in the tooltip with the
                                   added date. */
                                <div
                                  key={row.id}
                                  className="concept-library-row"
                                  title={row.useCount === 0
                                    ? t('conceptLibrary.neverUsedTitle', { added: date(row.createdAt) })
                                    : t('conceptLibrary.usedTitle', {
                                        count: row.useCount,
                                        last: date(row.lastUsedAt ?? row.createdAt),
                                        added: date(row.createdAt),
                                      })}
                                >
                                  <div className="concept-library-row-name">
                                    {row.display}
                                  </div>
                                  <div className="concept-library-row-stats">
                                    {row.useCount === 0 ? t('conceptLibrary.unused') : t('conceptLibrary.timesUsed', { count: row.useCount })}
                                  </div>
                                  {/* Pointer-only affordances (tabIndex -1): the facet
                                      rail is the keyboard surface; this pane is a
                                      read/manage table. */}
                                  <button
                                    tabIndex={-1}
                                    className="modal-btn modal-btn-danger"
                                    onClick={() => void handleDeleteConcept(row)}
                                  >
                                    {t('task.delete')}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
      </div>
    </Modal>
  )
}
