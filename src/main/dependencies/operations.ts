export type MutableDependency = 'cli' | 'recommendations'

export type DependencyOperationOwner = object

export type WatchDependencyOperationOwner = (
  cancel: (reason: Error) => void
) => () => void

interface ActiveDependencyOperation {
  owner: DependencyOperationOwner
  controller: AbortController
}

export class DependencyOperationBusyError extends Error {
  readonly dependency: MutableDependency

  constructor(dependency: MutableDependency) {
    super(`Dependency ${dependency} operation is already running`)
    this.name = 'DependencyOperationBusyError'
    this.dependency = dependency
  }
}

// Launch checks have process lifetime rather than renderer lifetime. The stable
// token makes that ownership explicit while keeping cancellation scoped to the
// window object that owns an interactive operation.
export const APP_DEPENDENCY_OPERATION_OWNER: DependencyOperationOwner = Object.freeze({
  kind: 'app-dependency-operation-owner',
})

const activeOperations = new Map<MutableDependency, ActiveDependencyOperation>()

/** Reserve all requested dependencies atomically, run the operation, and retain
 * ownership until its promise settles. A busy dependency is refused explicitly;
 * callers such as the launch checker may catch DependencyOperationBusyError and
 * deliberately skip that one best-effort check. */
export async function runDependencyOperation<T>(
  owner: DependencyOperationOwner,
  dependencies: readonly MutableDependency[],
  run: (signal: AbortSignal) => Promise<T>,
  watchOwner?: WatchDependencyOperationOwner
): Promise<T> {
  const busyDependency = dependencies.find((dependency) => activeOperations.has(dependency))
  if (busyDependency) throw new DependencyOperationBusyError(busyDependency)

  const controller = new AbortController()
  const operation: ActiveDependencyOperation = { owner, controller }
  for (const dependency of dependencies) activeOperations.set(dependency, operation)

  let stopWatchingOwner: (() => void) | undefined
  try {
    stopWatchingOwner = watchOwner?.((reason) => controller.abort(reason))
    return await run(controller.signal)
  } finally {
    try {
      stopWatchingOwner?.()
    } finally {
      for (const dependency of dependencies) {
        if (activeOperations.get(dependency) === operation) activeOperations.delete(dependency)
      }
    }
  }
}

/** Cancel only operations owned by this exact owner. Shared operations (a check
 * reserves two slots) are deduplicated so their controller is aborted once. */
export function cancelDependencyOperationsOwnedBy(
  owner: DependencyOperationOwner,
  reason: Error
): void {
  for (const operation of new Set(activeOperations.values())) {
    if (operation.owner === owner) operation.controller.abort(reason)
  }
}
