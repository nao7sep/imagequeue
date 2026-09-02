import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import type {
  DependenciesState,
  DependencyId,
  DependencyProgress,
} from '../../../shared/types'
import { presentFailure } from '../utils/failurePresentation'
import { recordOperationalDiagnostic } from '../utils/operationalFailure'

export type DependencyOperation = DependencyId | 'check' | 'toggle'
export type DependencyTerminalOutcome = 'cancelled'

interface ControllerState {
  snapshot: DependenciesState | null
  busy: ReadonlySet<DependencyOperation>
  progress: DependencyProgress | null
  errors: Partial<Record<DependencyOperation | 'load' | 'cancel', string>>
  terminalOutcomes: Partial<Record<DependencyOperation, DependencyTerminalOutcome>>
}

type Action =
  | { type: 'load-success'; snapshot: DependenciesState }
  | { type: 'load-failure'; error: string }
  | { type: 'start'; operation: DependencyOperation }
  | {
      type: 'settle'
      operation: DependencyOperation
      snapshot: DependenciesState | null
      error: string | null
      cancelled: boolean
    }
  | { type: 'progress'; progress: DependencyProgress }
  | { type: 'cancel-failure'; error: string }

const INITIAL_STATE: ControllerState = {
  snapshot: null,
  busy: new Set(),
  progress: null,
  errors: {},
  terminalOutcomes: {},
}

function withoutError(
  errors: ControllerState['errors'],
  key: keyof ControllerState['errors'],
): ControllerState['errors'] {
  const next = { ...errors }
  delete next[key]
  return next
}

function mergeSnapshot(
  current: DependenciesState | null,
  next: DependenciesState,
  operation: DependencyOperation,
): DependenciesState {
  if (!current) return next
  switch (operation) {
    case 'cli':
    case 'check':
      return { ...current, cli: next.cli, platformSupported: next.platformSupported }
    case 'recommendations':
      return {
        ...current,
        recommendations: next.recommendations,
        platformSupported: next.platformSupported,
      }
    case 'toggle':
      return { ...current, checkUpdatesAtLaunch: next.checkUpdatesAtLaunch }
  }
}

function reducer(state: ControllerState, action: Action): ControllerState {
  switch (action.type) {
    case 'load-success':
      return {
        ...state,
        snapshot: action.snapshot,
        errors: withoutError(state.errors, 'load'),
      }
    case 'load-failure':
      return { ...state, errors: { ...state.errors, load: action.error } }
    case 'start': {
      const busy = new Set(state.busy)
      busy.add(action.operation)
      let errors = { ...state.errors }
      // CLI checks and acquisitions supersede each other's prior terminal
      // errors because both resolve the same artifact row. Other operations
      // clear only their own domain's error.
      if (action.operation === 'cli' || action.operation === 'check') {
        errors = withoutError(errors, 'cli')
        errors = withoutError(errors, 'check')
      } else {
        errors = withoutError(errors, action.operation)
      }
      errors = withoutError(errors, 'cancel')
      const terminalOutcomes = { ...state.terminalOutcomes }
      // Checks and acquisitions share the CLI row, so either new attempt
      // supersedes the prior terminal result for that artifact.
      if (action.operation === 'cli' || action.operation === 'check') {
        delete terminalOutcomes.cli
        delete terminalOutcomes.check
      } else {
        delete terminalOutcomes[action.operation]
      }
      return { ...state, busy, errors, terminalOutcomes }
    }
    case 'settle': {
      const busy = new Set(state.busy)
      busy.delete(action.operation)
      const errors = withoutError(state.errors, action.operation)
      if (action.error) errors[action.operation] = action.error
      const terminalOutcomes = { ...state.terminalOutcomes }
      delete terminalOutcomes[action.operation]
      if (action.cancelled) terminalOutcomes[action.operation] = 'cancelled'
      return {
        ...state,
        snapshot: action.snapshot
          ? mergeSnapshot(state.snapshot, action.snapshot, action.operation)
          : state.snapshot,
        busy,
        progress: action.operation === 'cli' ? null : state.progress,
        errors,
        terminalOutcomes,
      }
    }
    case 'progress':
      return state.busy.has('cli') ? { ...state, progress: action.progress } : state
    case 'cancel-failure':
      return { ...state, errors: { ...state.errors, cancel: action.error } }
  }
}

interface DependenciesController {
  state: DependenciesState | null
  busy: ReadonlySet<DependencyOperation>
  progress: DependencyProgress | null
  error: string | null
  terminalOutcomes: Partial<Record<DependencyOperation, DependencyTerminalOutcome>>
  check: () => Promise<void>
  installCli: () => Promise<void>
  installRecommendations: () => Promise<void>
  setCheckAtLaunch: (value: boolean) => Promise<void>
  cancelOperations: () => Promise<void>
}

const DependenciesContext = createContext<DependenciesController | null>(null)

export function DependenciesProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [controller, dispatch] = useReducer(reducer, INITIAL_STATE)
  const active = useRef(new Set<DependencyOperation>())
  const cancelled = useRef(new Set<DependencyOperation>())
  const operationRevision = useRef(0)
  const refreshSequence = useRef(0)

  const announceChange = useCallback((): void => {
    window.dispatchEvent(new CustomEvent('dependencies-changed'))
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (active.current.size > 0) return
    const sequence = ++refreshSequence.current
    const revision = operationRevision.current
    try {
      const snapshot = await window.electronAPI.getDependenciesState()
      // A focus read that began before an operation is not allowed to overwrite
      // that operation's newer terminal facts. Likewise, only the newest idle
      // read may publish a full snapshot.
      if (
        sequence === refreshSequence.current
        && revision === operationRevision.current
        && active.current.size === 0
      ) {
        dispatch({ type: 'load-success', snapshot })
      }
    } catch (error) {
      if (
        sequence === refreshSequence.current
        && revision === operationRevision.current
        && active.current.size === 0
      ) {
        dispatch({ type: 'load-failure', error: presentFailure('dependencies-load', error) })
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    const stopProgress = window.electronAPI.onDependencyProgress((progress) => {
      dispatch({ type: 'progress', progress })
    })
    return () => {
      window.removeEventListener('focus', onFocus)
      stopProgress()
    }
  }, [refresh])

  const run = useCallback(async (
    operation: DependencyOperation,
    invoke: () => Promise<DependenciesState>,
  ): Promise<void> => {
    if (active.current.has(operation)) return
    active.current.add(operation)
    operationRevision.current += 1
    dispatch({ type: 'start', operation })
    let snapshot: DependenciesState | null = null
    let error: string | null = null
    try {
      snapshot = await invoke()
    } catch (operationError) {
      if (!cancelled.current.has(operation)) error = presentFailure('dependencies-change', operationError)
      try {
        snapshot = await window.electronAPI.getDependenciesState()
      } catch (reconciliationError) {
        recordOperationalDiagnostic('Failed to reconcile managed-tool state after an operation', reconciliationError, { operation })
        // Retain the operation error and the prior snapshot. The operation itself
        // remains the actionable failure when reconciliation is unavailable.
      }
    } finally {
      const wasCancelled = cancelled.current.has(operation)
      active.current.delete(operation)
      cancelled.current.delete(operation)
      dispatch({ type: 'settle', operation, snapshot, error, cancelled: wasCancelled })
      if (snapshot) announceChange()
    }
  }, [announceChange])

  const check = useCallback(
    (): Promise<void> => run('check', () => window.electronAPI.checkDependencies()),
    [run],
  )
  const installCli = useCallback(
    (): Promise<void> => run('cli', () => window.electronAPI.installCli()),
    [run],
  )
  const installRecommendations = useCallback(
    (): Promise<void> => run(
      'recommendations',
      () => window.electronAPI.downloadRecommendations(),
    ),
    [run],
  )
  const setCheckAtLaunch = useCallback(
    (value: boolean): Promise<void> => run(
      'toggle',
      () => window.electronAPI.setCheckUpdatesAtLaunch(value),
    ),
    [run],
  )

  const cancelOperations = useCallback(async (): Promise<void> => {
    const cancellable = [...active.current].filter(
      (operation) => operation === 'cli' || operation === 'recommendations' || operation === 'check',
    )
    if (cancellable.length === 0) return
    cancelled.current = new Set(cancellable)
    try {
      await window.electronAPI.cancelDependencyOperations()
    } catch (error) {
      cancelled.current.clear()
      dispatch({ type: 'cancel-failure', error: presentFailure('dependencies-cancel', error) })
    }
  }, [])

  const errorMessages = Object.values(controller.errors)
  const error = errorMessages.length === 1
    ? errorMessages[0] ?? null
    : errorMessages.join('; ') || null

  const value = useMemo<DependenciesController>(() => ({
    state: controller.snapshot,
    busy: controller.busy,
    progress: controller.progress,
    error,
    terminalOutcomes: controller.terminalOutcomes,
    check,
    installCli,
    installRecommendations,
    setCheckAtLaunch,
    cancelOperations,
  }), [
    controller.snapshot,
    controller.busy,
    controller.progress,
    controller.terminalOutcomes,
    error,
    check,
    installCli,
    installRecommendations,
    setCheckAtLaunch,
    cancelOperations,
  ])

  return <DependenciesContext.Provider value={value}>{children}</DependenciesContext.Provider>
}

export function useDependencies(): DependenciesController {
  const value = useContext(DependenciesContext)
  if (!value) throw new Error('useDependencies must be used within DependenciesProvider')
  return value
}
