import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  RECORD_KINDS,
  RECORD_LEVEL_FILTERS,
  type RecordDetail,
  type RecordKind,
  type RecordLevel,
  type RecordLevelFilter,
  type RecordSources,
  type RecordsQuery,
  type RecordSummary,
} from '../../../shared/records'
import { RECORDS_LIST_WIDTH, clampRecordsListWidth, displayedRecordsListWidth } from '../../../shared/records-layout'
import { useListbox } from '../hooks/useListbox'
import { useI18n } from '../i18n/I18nContext'
import { recordOperationalDiagnostic } from '../utils/operationalFailure'
import { sessionDisplayName } from '../utils/sessionName'
import {
  KIND_LABELS,
  LEVEL_FILTER_LABELS,
  LEVEL_LABELS,
  cursorAfter,
  mergeNewestPage,
  prettyJson,
  recordKey,
} from './record-format'
import './RecordsWindow.css'

// The Records window opens with its list pane at the saved width, so the first
// frame already has it.
export function RecordsApp(): React.JSX.Element | null {
  const [listWidth, setListWidth] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.getUiState().then(
      (state) => {
        if (!cancelled) setListWidth(clampRecordsListWidth(state.recordsListWidth))
      },
      (error: unknown) => {
        recordOperationalDiagnostic('Records list width read failed', error)
        if (!cancelled) setListWidth(RECORDS_LIST_WIDTH.default)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  if (listWidth === null) return null
  return <RecordsWindow initialListWidth={listWidth} />
}

type Filters = Omit<RecordsQuery, 'after'>

const NO_FILTERS: Filters = { launch: null, session: null, kind: null, level: null, search: '' }
const SEARCH_DELAY_MS = 300
// New records are read at most this often while they keep arriving.
const LIVE_INTERVAL_MS = 1000
// The keys that move the cursor toward the end of the list.
const TOWARD_END = new Set(['ArrowDown', 'PageDown', 'End'])

type ListState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; records: RecordSummary[]; more: boolean; loadingMore: boolean; moreFailed: boolean }

type DetailState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; record: RecordDetail }

type Selection = { kind: RecordKind; id: number }

// Within about one screen of the end of what is loaded.
function nearEnd(scroll: HTMLElement): boolean {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= scroll.clientHeight
}

function atTop(scroll: HTMLElement): boolean {
  return scroll.scrollTop < 1
}

export function RecordsWindow({ initialListWidth }: { initialListWidth: number }): React.JSX.Element {
  const { t, locale } = useI18n()
  const [sources, setSources] = useState<RecordSources | null>(null)
  const [sourceReads, setSourceReads] = useState(0)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [searchText, setSearchText] = useState('')
  const [list, setList] = useState<ListState>({ status: 'loading' })
  const [selected, setSelected] = useState<Selection | null>(null)
  const [detail, setDetail] = useState<DetailState>({ status: 'none' })
  const [listWidth, setListWidth] = useState(initialListWidth)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [available, setAvailable] = useState<number | null>(null)
  const listGeneration = useRef(0)
  // The busy claim for the next page (PLAYBOOK, Own the work in flight).
  const fetchingMore = useRef(false)
  // The filters the current list was read for, for the live reads below.
  const filtersRef = useRef(filters)
  // New records arrived while the list was scrolled away from the top.
  const newestPending = useRef(false)
  // A failed read is itself logged as a record, whose signal would start the
  // next read; live reads stop after a failure and resume after a read succeeds.
  const liveSuspended = useRef(false)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Pane sizing: window-conventions. The displayed width is the intent fitted
  // to the live window; only a finished drag changes the intent.
  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    const measure = (): void => setAvailable(shell.clientWidth)
    const observer = new ResizeObserver(measure)
    observer.observe(shell)
    measure()
    return () => observer.disconnect()
  }, [])
  const intent = dragWidth ?? listWidth
  const shownListWidth = available === null ? clampRecordsListWidth(intent) : displayedRecordsListWidth(intent, available)

  const timeFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }), [locale])

  useEffect(() => {
    document.title = t('records.title')
  }, [t])

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => (current.search === searchText ? current : { ...current, search: searchText }))
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [searchText])

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.readRecordSources().then(
      (next) => {
        if (!cancelled) setSources(next)
      },
      (error: unknown) => {
        liveSuspended.current = true
        recordOperationalDiagnostic('Record sources read failed', error)
      },
    )
    return () => {
      cancelled = true
    }
  }, [sourceReads])

  // A page applies only while the filters it was read for are still the
  // newest ones asked for.
  useEffect(() => {
    filtersRef.current = filters
    const generation = ++listGeneration.current
    fetchingMore.current = false
    newestPending.current = false
    setList({ status: 'loading' })
    void window.electronAPI.readRecordsPage({ ...filters, after: null }).then(
      (page) => {
        if (generation !== listGeneration.current) return
        liveSuspended.current = false
        setList({ status: 'ready', records: page.records, more: page.more, loadingMore: false, moreFailed: false })
      },
      (error: unknown) => {
        if (generation !== listGeneration.current) return
        liveSuspended.current = true
        recordOperationalDiagnostic('Records read failed', error)
        setList({ status: 'failed' })
      },
    )
  }, [filters])

  // The newest page read again for new records. It joins the rows already
  // shown rather than replacing them, so the list never falls back to the
  // loading note and the pages already read stay. It reads only refs, so one
  // copy serves the live subscription below.
  const readNewest = useCallback((): void => {
    const generation = listGeneration.current
    void window.electronAPI.readRecordsPage({ ...filtersRef.current, after: null }).then(
      (page) => {
        if (generation !== listGeneration.current) return
        liveSuspended.current = false
        setList((current) =>
          current.status === 'ready'
            ? { ...current, ...mergeNewestPage(current.records, current.more, page) }
            : { status: 'ready', records: page.records, more: page.more, loadingMore: false, moreFailed: false },
        )
      },
      (error: unknown) => {
        if (generation !== listGeneration.current) return
        liveSuspended.current = true
        recordOperationalDiagnostic('Records read failed', error)
      },
    )
  }, [])

  // A stored record reaches the list at once while it is scrolled to the top;
  // otherwise it waits until the list is back there, so the list never moves
  // under the reader.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = window.electronAPI.onRecordsChanged(() => {
      if (timer !== null || liveSuspended.current) return
      timer = setTimeout(() => {
        timer = null
        setSourceReads((count) => count + 1)
        const scroll = scrollRef.current
        if (scroll === null || atTop(scroll)) readNewest()
        else newestPending.current = true
      }, LIVE_INTERVAL_MS)
    })
    return () => {
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
    }
  }, [readNewest])

  const selectedKey = selected === null ? null : recordKey(selected)

  useEffect(() => {
    if (selected === null) {
      setDetail({ status: 'none' })
      return
    }
    let cancelled = false
    setDetail({ status: 'loading' })
    void window.electronAPI.readRecordDetail(selected.kind, selected.id).then(
      (record) => {
        if (!cancelled) setDetail(record === null ? { status: 'failed' } : { status: 'ready', record })
      },
      (error: unknown) => {
        if (cancelled) return
        recordOperationalDiagnostic('Record read failed', error)
        setDetail({ status: 'failed' })
      },
    )
    return () => {
      cancelled = true
    }
    // The selection is compared by its key, not by the object holding it.
  }, [selectedKey])

  // Loading more: composite-control-conventions, Integration Points. A failed
  // page is read again when the end is reached again.
  const loadMore = (): void => {
    if (list.status !== 'ready' || !list.more || fetchingMore.current) return
    fetchingMore.current = true
    const generation = listGeneration.current
    setList((current) => (current.status === 'ready' ? { ...current, loadingMore: true, moreFailed: false } : current))
    void window.electronAPI.readRecordsPage({ ...filters, after: cursorAfter(list.records) }).then(
      (page) => {
        if (generation !== listGeneration.current) return
        fetchingMore.current = false
        liveSuspended.current = false
        setList((current) =>
          current.status === 'ready'
            ? { ...current, records: [...current.records, ...page.records], more: page.more, loadingMore: false }
            : current,
        )
      },
      (error: unknown) => {
        if (generation !== listGeneration.current) return
        fetchingMore.current = false
        liveSuspended.current = true
        recordOperationalDiagnostic('Records read failed', error)
        setList((current) => (current.status === 'ready' ? { ...current, loadingMore: false, moreFailed: true } : current))
      },
    )
  }

  // A page that leaves the list short of the end reads the next one; a failed
  // page waits for the reader instead.
  useEffect(() => {
    const scroll = scrollRef.current
    if (list.status !== 'ready' || list.loadingMore || list.moreFailed || scroll === null) return
    if (nearEnd(scroll)) loadMore()
    // Only a new list state can change what is loaded.
  }, [list])

  const onListScroll = (): void => {
    const scroll = scrollRef.current
    if (scroll === null) return
    if (newestPending.current && atTop(scroll)) {
      newestPending.current = false
      readNewest()
    }
    if (nearEnd(scroll)) loadMore()
  }

  const records = list.status === 'ready' ? list.records : []
  const keys = records.map(recordKey)

  // The list is one listbox (composite-control-conventions, Listbox) through the
  // app's listbox layer; the selection follows focus.
  const { listboxProps, getOptionProps } = useListbox<HTMLDivElement>({
    ids: keys,
    selectedId: selectedKey,
    onSelect: (key) => {
      const record = records.find((candidate) => recordKey(candidate) === key)
      if (record && key !== selectedKey) setSelected({ kind: record.kind, id: record.id })
    },
    activation: 'follows-focus',
    // Every row starts with its time, so typed letters have nothing to match.
    typeAhead: false,
  })

  const onListKeyDown = (event: KeyboardEvent): void => {
    listboxProps.onKeyDown(event)
    if (!TOWARD_END.has(event.key)) return
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.listboxOption : undefined
    if (focused !== undefined && focused === keys.at(-1)) loadMore()
  }

  // Drag intent: window-conventions, Content-based minimum size. Only the end
  // of a drag saves.
  const commitListWidth = (width: number): void => {
    setListWidth(width)
    setDragWidth(null)
    void window.electronAPI.updateUiState({ recordsListWidth: width }).catch((error: unknown) =>
      recordOperationalDiagnostic('Records list width save failed', error),
    )
  }

  const onSplitterPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = shownListWidth
    let latest = startWidth
    const move = (moveEvent: PointerEvent): void => {
      latest = clampRecordsListWidth(startWidth + (moveEvent.clientX - startX))
      setDragWidth(latest)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      commitListWidth(latest)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    // Keep the resize cursor and suppress text selection everywhere for the drag.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setDragWidth(startWidth)
  }

  const launchLabel = (launch: string): string => {
    const time = timeFormat.format(new Date(launch))
    return launch === sources?.currentLaunch ? t('records.thisLaunch', { time }) : time
  }

  const sessionLabel = (session: string): string => {
    const name = sessionDisplayName(session)
    return session === sources?.currentSession ? t('records.thisSession', { name }) : name
  }

  return (
    <div
      ref={shellRef}
      className="records-shell"
      style={{ '--records-list-width': `${shownListWidth}px` } as CSSProperties}
    >
      <section className="records-list-pane" aria-label={t('records.title')}>
        <div className="records-filters">
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t('records.search')}
            aria-label={t('records.search')}
          />
          <div className="records-filters-row">
            <FilterSelect
              label={t('records.launch')}
              value={filters.launch}
              allLabel={t('records.allLaunches')}
              options={(sources?.launches ?? []).map((launch) => ({ value: launch, label: launchLabel(launch) }))}
              onChange={(launch) => setFilters({ ...filters, launch })}
            />
            <FilterSelect
              label={t('records.session')}
              value={filters.session}
              allLabel={t('records.allSessions')}
              options={(sources?.sessions ?? []).map((session) => ({ value: session, label: sessionLabel(session) }))}
              onChange={(session) => setFilters({ ...filters, session })}
            />
          </div>
          <div className="records-filters-row">
            <FilterSelect
              label={t('records.kind')}
              value={filters.kind}
              allLabel={t('records.allKinds')}
              options={RECORD_KINDS.map((kind) => ({ value: kind, label: t(KIND_LABELS[kind]) }))}
              onChange={(kind) => setFilters({ ...filters, kind: kind as RecordKind | null })}
            />
            <FilterSelect
              label={t('records.level')}
              value={filters.level}
              allLabel={t('records.allLevels')}
              options={RECORD_LEVEL_FILTERS.map((level) => ({ value: level, label: t(LEVEL_FILTER_LABELS[level]) }))}
              onChange={(level) => setFilters({ ...filters, level: level as RecordLevelFilter | null })}
            />
          </div>
        </div>
        <div
          ref={scrollRef}
          className="records-list-scroll"
          aria-busy={list.status === 'loading'}
          onScroll={onListScroll}
        >
          {list.status === 'failed' ? (
            <p className="records-note records-note--error" role="alert">{t('records.loadFailed')}</p>
          ) : list.status === 'loading' ? (
            <p className="records-note">{t('records.loading')}</p>
          ) : records.length === 0 ? (
            <p className="records-note">{t('records.empty')}</p>
          ) : (
            <div {...listboxProps} onKeyDown={onListKeyDown} aria-label={t('records.title')} className="records-list">
              {records.map((record) => {
                const key = recordKey(record)
                return (
                  <div
                    key={key}
                    {...getOptionProps(key)}
                    className={`records-row${key === selectedKey ? ' selected' : ''}`}
                  >
                    <div className="records-row-meta">
                      <span>{timeFormat.format(new Date(record.time))}</span>
                      <LevelPill level={record.level} />
                      {record.kind === 'ai-call' ? <span className="records-pill">{t(KIND_LABELS[record.kind])}</span> : null}
                    </div>
                    <div className={`records-row-title${record.kind === 'ai-call' ? ' records-code' : ''}`}>{record.title}</div>
                    {record.text ? <div className="records-row-text">{record.text}</div> : null}
                  </div>
                )
              })}
            </div>
          )}
          {list.status === 'ready' && list.loadingMore ? (
            <p className="records-note">{t('records.loading')}</p>
          ) : null}
          {list.status === 'ready' && list.moreFailed ? (
            <p className="records-note records-note--error" role="alert">{t('records.loadFailed')}</p>
          ) : null}
        </div>
      </section>
      <div
        className={`pane-splitter${dragWidth !== null ? ' dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('records.resizeList')}
        onPointerDown={onSplitterPointerDown}
      />
      <section className="records-detail-pane" aria-busy={detail.status === 'loading'}>
        {detail.status === 'ready' ? (
          <RecordDetailView record={detail.record} launchLabel={launchLabel} sessionLabel={sessionLabel} />
        ) : (
          <p className={`records-note${detail.status === 'failed' ? ' records-note--error' : ''}`}>
            {detail.status === 'failed' ? t('records.detailFailed') : detail.status === 'none' ? t('records.noSelection') : null}
          </p>
        )}
      </section>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string
  value: string | null
  allLabel: string
  options: { value: string; label: string }[]
  onChange: (value: string | null) => void
}): React.JSX.Element {
  // A chosen value the sources no longer list stays selectable until changed.
  const shown = value === null || options.some((option) => option.value === value)
    ? options
    : [{ value, label: value }, ...options]
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
    >
      <option value="">{allLabel}</option>
      {shown.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

function LevelPill({ level }: { level: RecordLevel }): React.JSX.Element {
  const { t } = useI18n()
  return <span className={`records-pill records-pill--${level}`}>{t(LEVEL_LABELS[level])}</span>
}

function RecordDetailView({
  record,
  launchLabel,
  sessionLabel,
}: {
  record: RecordDetail
  launchLabel: (launch: string) => string
  sessionLabel: (session: string) => string
}): React.JSX.Element {
  const { t, locale } = useI18n()
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      }),
    [locale],
  )
  const seconds = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', minimumFractionDigits: 3, maximumFractionDigits: 3 }),
    [locale],
  )
  const time = (value: string): string => timeFormat.format(new Date(value))
  const level: RecordLevel = record.kind === 'log' ? record.level : record.error === null ? 'info' : 'error'

  const fields: { label: string; value: ReactNode }[] = []
  const add = (label: string, value: ReactNode | null): void => {
    if (value !== null) fields.push({ label, value })
  }
  if (record.kind === 'log') {
    add(t('records.time'), time(record.time))
  } else {
    add(t('records.started'), time(record.time))
    add(t('records.duration'), seconds.format(record.durationMs / 1000))
    add(t('records.backend'), <code className="records-code">{record.backend}</code>)
    add(t('records.model'), <code className="records-code">{record.model}</code>)
    add(t('records.purpose'), <code className="records-code">{record.purpose}</code>)
  }
  add(t('records.task'), record.taskId === null ? null : <code className="records-code">{record.taskId}</code>)
  add(t('records.elaboration'), record.requestId === null ? null : <code className="records-code">{record.requestId}</code>)
  add(t('records.session'), record.sessionId === null ? null : sessionLabel(record.sessionId))
  add(t('records.launch'), launchLabel(record.launch))

  const blocks: { label: string; text: string }[] = []
  if (record.kind === 'log') {
    blocks.push({ label: t('records.details'), text: prettyJson(record.fields) })
  } else {
    blocks.push({ label: t('records.request'), text: prettyJson(record.request) })
    if (record.response !== null) blocks.push({ label: t('records.response'), text: prettyJson(record.response) })
    if (record.error !== null) blocks.push({ label: t('records.error'), text: prettyJson(record.error) })
  }

  return (
    <>
      <div className="records-detail-header">
        <h2 className="records-detail-title">
          {record.kind === 'log' ? record.message : `${record.backend} ${record.purpose}`}
        </h2>
        <div className="records-detail-pills">
          <LevelPill level={level} />
          <span className="records-pill">{t(KIND_LABELS[record.kind])}</span>
        </div>
      </div>
      <div className="records-detail-body" role="region" tabIndex={0} aria-label={t('records.details')}>
        <dl className="records-meta">
          {fields.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
        {blocks.map((block) => (
          <section key={block.label} className="records-block">
            <h3 className="records-block-label">{block.label}</h3>
            <pre className="records-block-text">{block.text}</pre>
          </section>
        ))}
      </div>
    </>
  )
}
