import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openPath: vi.fn(async () => ''),
  outputDir: '/imagequeue/output',
}))

vi.mock('electron', () => ({ shell: { openPath: mocks.openPath } }))
vi.mock('../../../src/main/session/session', () => ({ getOutputDir: () => mocks.outputDir }))

const { openOutputFolder } = await import('../../../src/main/session/open-output-folder')

describe('openOutputFolder', () => {
  it('opens the authoritative output root', async () => {
    await openOutputFolder()
    expect(mocks.openPath).toHaveBeenCalledWith(mocks.outputDir)
  })

  it('surfaces an OS shell failure', async () => {
    mocks.openPath.mockResolvedValueOnce('no associated application')
    await expect(openOutputFolder()).rejects.toThrow(/no associated application/)
  })
})
