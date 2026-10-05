// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { until } from './until'

describe('until', () => {
  it('returns once the condition holds, after the work already queued has run', async () => {
    let ready = false
    void Promise.resolve().then(() => Promise.resolve()).then(() => { ready = true })
    await expect(until(() => {
      if (!ready) throw new Error('not yet')
      return 'done'
    })).resolves.toBe('done')
  })

  // A test that times out leaves its wait running; it must not go on to act on
  // whatever the next test renders.
  let left: Promise<unknown> = Promise.resolve()
  it('is left waiting by a test that ends first', () => {
    left = until(() => { throw new Error('never holds') }).catch((error: unknown) => error)
  })

  it('stops once that test has ended', async () => {
    expect(await left).toEqual(new Error('never holds'))
  })
})
