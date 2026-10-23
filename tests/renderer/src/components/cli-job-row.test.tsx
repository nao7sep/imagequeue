// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliJobRow } from '../../../../src/renderer/src/components/CliJobsPanel'
import { CliJobsProvider, useCliJobs } from '../../../../src/renderer/src/context/CliJobsContext'
import type { CliChunk, CliJobKind, CliJobStatus } from '../../../../src/shared/cli-jobs'
import { until } from '../../until'

const NOTE = 'Earlier output is not shown here. Records in the main menu has all of it.'

function installApi(chunks: CliChunk[], status: CliJobStatus = 'running'): void {
  window.electronAPI = {
    onCliJobChunk: vi.fn(() => () => undefined),
    onCliJobStatus: vi.fn(() => () => undefined),
    cliSubscribeJob: vi.fn(async () => ({
      jobId: 'job-1', kind: 'download', target: 'alpha.ckpt', startedAtMs: 0,
      status, exitCode: null, stalled: false, chunks,
    })),
    cliUnsubscribeJob: vi.fn(async () => undefined),
    cliKillJob: vi.fn(async () => undefined),
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


describe('CLI job lifetime states', () => {
  it('keeps a pending stop active and unavailable for dismissal until physical exit', async () => {
    installApi([])
    const dismiss = vi.fn()
    render(<CliJobRow jobId="job-1" kind="download" target="alpha.ckpt" onDismiss={dismiss} />)
    await until(() => expect(window.electronAPI.cliSubscribeJob).toHaveBeenCalledOnce())
    const onStatus = vi.mocked(window.electronAPI.onCliJobStatus).mock.calls[0][0]
    vi.mocked(window.electronAPI.cliKillJob).mockImplementation(async () => {
      onStatus({ jobId: 'job-1', status: 'stopping', exitCode: null, stalled: false })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await until(() => screen.getByText('Stopping alpha.ckpt'))
    expect(screen.getByText('Waiting for the process to stop.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Close job result' })).toBeNull()
    expect(document.querySelector('.cli-job-row-title-error')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(window.electronAPI.cliKillJob).toHaveBeenCalledOnce()
    act(() => onStatus({ jobId: 'job-1', status: 'killed', exitCode: null, stalled: false }))
    expect(screen.getByText('Stopped: alpha.ckpt')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close job result' }))
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it.each([
    ['download', 'The download stopped after no output for too long.'],
    ['import', 'The import exceeded its time limit.'],
  ] as const)('shows a terminal %s timeout as a failure', async (kind, summary) => {
    installApi([], 'timed-out')
    render(<CliJobRow jobId="job-1" kind={kind} target="alpha.ckpt" onDismiss={vi.fn()} />)
    await until(() => screen.getByText(summary))
    expect(screen.getByText('Failed: alpha.ckpt')).toBeTruthy()
    expect(document.querySelector('.cli-job-summary-error')?.textContent).toBe(summary)
    expect(document.querySelector('.cli-job-row-title-success')).toBeNull()
    expect(screen.queryByText('Stopped before completion.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close job result' })).toBeTruthy()
  })

  it('explains a queued download waits for other model work', async () => {
    installApi([], 'queued')
    render(<CliJobRow jobId="job-1" kind="download" target="alpha.ckpt" onDismiss={vi.fn()} />)
    await until(() => screen.getByText('Waiting for other model work to finish.'))
    expect(screen.getByText('Queued download: alpha.ckpt')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

function CoalescedJobs({ kind }: { kind: CliJobKind }): React.JSX.Element {
  const { jobs, addJob, removeJob } = useCliJobs()
  return <><button onClick={() => addJob('job-1', kind, 'alpha.ckpt')}>Add job</button>
    {[...jobs].map(([jobId, meta]) => <CliJobRow key={jobId} jobId={jobId} {...meta} onDismiss={() => removeJob(jobId)} />)}
  </>
}

describe('coalesced CLI job displays', () => {
  it.each(['download', 'import'] as const)('keeps one %s row when repeated starts return the same job id', async (kind) => {
    installApi([])
    render(<CliJobsProvider><CoalescedJobs kind={kind} /></CliJobsProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Add job' }))
    await until(() => expect(window.electronAPI.cliSubscribeJob).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Add job' }))
    expect(document.querySelectorAll('.cli-job-row')).toHaveLength(1)
    expect(window.electronAPI.cliSubscribeJob).toHaveBeenCalledExactlyOnceWith('job-1')
  })
})
