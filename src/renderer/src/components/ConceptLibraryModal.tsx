import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { ConceptLibraryDetails } from './ConceptLibraryDetails'
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
  const [facets, setFacets] = useState<ConceptFacetSummary[]>([])
  const [facetsLoading, setFacetsLoading] = useState(true)
  const [facetsError, setFacetsError] = useState<MessageKey | null>(null)
  const [selectedFacetId, setSelectedFacetId] = useState<number | null>(null)
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

  const { listboxProps, getOptionProps } = useListbox<HTMLDivElement>({
    ids: facets.map((f) => String(f.id)),
    selectedId: selectedFacetId !== null ? String(selectedFacetId) : null,
    onSelect: (id) => setSelectedFacetId(Number(id)),
    activation: 'follows-focus',
  })

  const selectedFacet = facets.find((f) => f.id === selectedFacetId) ?? null

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
                          second: msg('conceptLibrary.lastUsed', { date: i18n.dateTime(facet.lastUsedAt) }),
                        })
                      : t('conceptLibrary.domainCount', { count: facet.probeCount })}
                  </div>
                </div>
              ))}
            </div>

            {selectedFacet && <ConceptLibraryDetails
              facet={selectedFacet}
              refreshToken={facets}
              onDeleteConcept={handleDeleteConcept}
              onDeleteProbe={handleDeleteProbe}
              onDeleteFacet={handleDeleteFacet}
            />}

          </div>
      </div>
    </Modal>
  )
}
