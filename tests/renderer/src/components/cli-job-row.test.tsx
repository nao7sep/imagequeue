// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliJobRow } from '../../../../src/renderer/src/components/CliJobsPanel'
import type { CliChunk } from '../../../../src/shared/cli-jobs'
import { until } from '../../until'

const NOTE = 'Earlier output is not shown here. Records in the main menu has all of it.'

function installApi(chunks: CliChunk[]): void {
  window.electronAPI = {
    onCliJobChunk: vi.fn(() => () => undefined),
    onCliJobStatus: vi.fn(() => () => undefined),
    cliSubscribeJob: vi.fn(async () => ({
      jobId: 'job-1', kind: 'download', target: 'alpha.ckpt', startedAtMs: 0,
      status: 'running', exitCode: null, stalled: false, chunks,
    })),
    cliUnsubscribeJob: vi.fn(async () => undefined),
    appLog: vi.fn(async () => undefined),
  } as unknown as typeof window.electronAPI
}

const chunk = (seq: number, text: string): CliChunk => ({ seq, kind: 'stdout', text, tsMs: 0 })

afterEach(cleanup)

// Main keeps only the newest output lines for this view; a view starting
// partway through says so instead of passing as the whole log.
describe('CLI job output view', () => {
  it('notes when earlier output is no longer shown', async () => {
    installApi([chunk(2400, 'line 2400'), chunk(2401, 'line 2401')])
    render(<CliJobRow jobId="job-1" kind="download" target="alpha.ckpt" onDismiss={vi.fn()} />)

    expect(await until(() => screen.getByText('line 2401'))).toBeTruthy()
    expect(screen.getByText(NOTE)).toBeTruthy()
  })

  it('shows no note while the whole output is present', async () => {
    installApi([chunk(0, 'line 0'), chunk(1, 'line 1')])
    render(<CliJobRow jobId="job-1" kind="download" target="alpha.ckpt" onDismiss={vi.fn()} />)

    expect(await until(() => screen.getByText('line 1'))).toBeTruthy()
    expect(screen.queryByText(NOTE)).toBeNull()
  })
})
