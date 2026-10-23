import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecordOutputStream, RecordsOutputPage } from '../../../shared/records'
import { useI18n } from '../i18n/I18nContext'
import { recordOperationalDiagnostic } from '../utils/operationalFailure'

// A record stream can be much larger than its detail metadata. Hold one page
// of text and only the opaque offsets needed to return to previous pages.
export function CliOutputBlock({ recordId, stream, label }: {
  recordId: number
  stream: RecordOutputStream
  label: string
}): React.JSX.Element {
  const { t } = useI18n()
  const [page, setPage] = useState<RecordsOutputPage | null>(null)
  const [history, setHistory] = useState([0])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(false)
  const busy = useRef(false)
  const generation = useRef(0)
  const requested = useRef({ offset: 0, index: 0 })

  const read = useCallback((offset: number, pageIndex: number): void => {
    if (busy.current) return
    busy.current = true
    const request = ++generation.current
    requested.current = { offset, index: pageIndex }
    setLoading(true)
    setFailed(false)
    void window.electronAPI.readRecordOutput(recordId, stream, offset).then(
      (next) => {
        if (!mounted.current || request !== generation.current) return
        setPage(next)
        setIndex(pageIndex)
        setHistory((previous) => [...previous.slice(0, pageIndex), offset])
      },
      (error: unknown) => {
        if (!mounted.current || request !== generation.current) return
        setFailed(true)
        recordOperationalDiagnostic('Record output read failed', error)
      },
    ).finally(() => {
      if (!mounted.current || request !== generation.current) return
      busy.current = false
      setLoading(false)
    })
  }, [recordId, stream])

  useEffect(() => {
    mounted.current = true
    read(0, 0)
    return () => {
      mounted.current = false
      busy.current = false
      generation.current++
    }
  }, [read])

  return (
    <section className="records-block" aria-busy={loading}>
      <h3 className="records-block-label">{label}</h3>
      {page !== null && <pre className="records-block-text">{page.text}</pre>}
      {loading && <p className="records-note">{t('records.loading')}</p>}
      {failed && <div>
        <p className="records-note records-note--error" role="alert">{t('records.detailFailed')}</p>
        <button onClick={() => read(requested.current.offset, requested.current.index)}>{t('common.retry')}</button>
      </div>}
      <div>
        <button disabled={loading || index === 0} onClick={() => read(history[index - 1], index - 1)}>
          {t('records.previousOutputPage')}
        </button>
        <button disabled={loading || page?.nextOffset == null} onClick={() => {
          if (page?.nextOffset != null) read(page.nextOffset, index + 1)
        }}>
          {t('records.nextOutputPage')}
        </button>
      </div>
    </section>
  )
}
