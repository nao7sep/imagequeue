import { gt, valid } from 'semver'
import type { AppReleaseResult } from '../shared/app-release'

export function compareAppRelease(payload: unknown, installed: string): AppReleaseResult {
  const tag = payload && typeof payload === 'object' ? (payload as { tag_name?: unknown }).tag_name : null
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag) || !valid(tag) || !valid(installed)) {
    throw new Error('Invalid GitHub release version')
  }
  return gt(tag, installed) ? { kind: 'newer', version: tag } : { kind: 'current' }
}

export function releaseCheckDue(lastAttempt: string | undefined, now: number): boolean {
  const previous = lastAttempt && /(?:Z|\+00:00)$/.test(lastAttempt) ? Date.parse(lastAttempt) : NaN
  return !Number.isFinite(previous) || previous > now || now - previous >= 86_400_000
}

// One operation owns marker persistence and the request through settlement. A
// manual join promotes its persistence policy before the asynchronous save ends.
export function createAppReleaseCheckOwner(io: {
  enabled: () => boolean
  lastAttempt: () => Promise<string | undefined>
  saveAttempt: (utc: string) => Promise<unknown>
  fetch: () => Promise<unknown>
  installed: string
  present: (result: AppReleaseResult) => void
  log: (error: unknown) => void
  now?: () => number
}): { check: (manual: boolean) => Promise<AppReleaseResult | undefined> } {
  let pending: Promise<AppReleaseResult | undefined> | null = null
  let manualOwner = false
  let launched = false
  return { check(manual) {
    if (pending) { manualOwner ||= manual; return pending }
    const now = (io.now ?? Date.now)()
    if (!manual) {
      if (launched) return Promise.resolve(undefined)
      launched = true
      if (!io.enabled()) return Promise.resolve(undefined)
    }
    manualOwner = manual
    pending = Promise.resolve().then(async () => {
      try {
        if (!manualOwner) {
          const previous = await io.lastAttempt()
          if (!manualOwner && !releaseCheckDue(previous, now)) return
        }
        try { await io.saveAttempt(new Date(now).toISOString()) }
        catch (error) { io.log(error); if (!manualOwner) return }
        const result = compareAppRelease(await io.fetch(), io.installed)
        if (manualOwner || result.kind === 'newer') io.present(result)
        return result
      } catch (error) {
        io.log(error)
        if (manualOwner) io.present({ kind: 'failed' })
        return { kind: 'failed' } as const
      }
    }).finally(() => { pending = null; manualOwner = false })
    return pending
  } }
}
