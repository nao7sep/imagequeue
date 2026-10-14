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

// The job title is one line; the target inside it is shortened before it is
// embedded, so the sentence around it stays whole in every language.
describe('CLI job title', () => {
  it('keeps the final segment of a long import path', async () => {
    installApi([])
    const target = '/Users/someone/Library/Containers/Some Very Long Folder Name/Models/checkpoints/flux_1_dev_q8p.ckpt'
    render(<CliJobRow jobId="job-1" kind="import" target={target} onDismiss={vi.fn()} />)
    const title = await until(() => document.querySelector('.cli-job-row-title')!)
    expect(title.textContent).toMatch(/^Importing \/Users\/someone.*…\/flux_1_dev_q8p\.ckpt$/)
    expect(title.textContent).not.toContain('Some Very Long Folder Name')
  })

  it('keeps the beginning of a long model file name', async () => {
    installApi([])
    const target = 'a_model_file_with_an_unusually_long_descriptive_name_and_more_words.ckpt'
    render(<CliJobRow jobId="job-1" kind="download" target={target} onDismiss={vi.fn()} />)
    const title = await until(() => document.querySelector('.cli-job-row-title')!)
    expect(title.textContent).toMatch(/^Downloading a_model_file_with_.*…$/)
  })
})
