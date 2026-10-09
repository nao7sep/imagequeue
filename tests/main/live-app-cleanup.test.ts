import { afterEach, expect, it, vi } from 'vitest'
import { stopApp, type App } from '../live/main/live-app'

afterEach(() => vi.restoreAllMocks())

it('checks remaining resources even when live-app shutdown fails', async () => {
  const failure = new Error('store close failed')
  const resources = vi.spyOn(process, 'getActiveResourcesInfo').mockReturnValue([])
  const app = { shutdown: vi.fn().mockRejectedValue(failure) } as unknown as App
  await expect(stopApp(app)).rejects.toMatchObject({ errors: [failure] })
  expect(resources).toHaveBeenCalledOnce()
})

it('retains both child and server leaks alongside the original close failure', async () => {
  const failure = new Error('store close failed')
  vi.spyOn(process, 'getActiveResourcesInfo').mockReturnValue(['ProcessWrap', 'TCPServerWrap'])
  vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(3_000)
  const app = { shutdown: vi.fn().mockRejectedValue(failure) } as unknown as App
  const outcome = await stopApp(app).catch((error: unknown) => error)
  expect(outcome).toBeInstanceOf(AggregateError)
  const failures = (outcome as AggregateError).errors
  expect(failures).toHaveLength(3)
  expect(failures[0]).toBe(failure)
  expect(failures[1].message).toContain('no child process')
  expect(failures[2].message).toContain('no server')
})
