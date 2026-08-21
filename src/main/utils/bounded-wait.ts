/**
 * Wait for every promise to settle, but never hold shutdown indefinitely.
 * Returns true when the work settled and false when the deadline won.
 */
export function waitForAllSettledWithin(
  promises: readonly Promise<unknown>[],
  timeoutMs: number,
): Promise<boolean> {
  if (promises.length === 0) return Promise.resolve(true)

  return new Promise((resolve) => {
    let finished = false
    const finish = (settled: boolean): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(settled)
    }
    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs))
    void Promise.allSettled(promises).then(() => finish(true))
  })
}
