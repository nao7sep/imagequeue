// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StartupFailureApp } from '../../../../src/renderer/src/components/StartupFailureApp'
import { until } from '../../until'

const reportMeasurement = vi.fn()
const getStartupFailureMessage = vi.fn()

beforeEach(() => {
  getStartupFailureMessage.mockResolvedValue({ key: 'startupFailure.message' })
  window.electronAPI = {
    reportStartupFailureMeasurement: reportMeasurement,
    getStartupFailureMessage,
  } as unknown as typeof window.electronAPI
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    lineHeight: '24px',
    paddingTop: '20px',
    paddingBottom: '20px',
  } as CSSStyleDeclaration)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.tagName === 'H1') return 50
    if (this.tagName === 'FOOTER') return 60
    return 0
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.tagName === 'P' ? 90 : 0
  })
})

afterEach(() => {
  cleanup()
  reportMeasurement.mockReset()
  getStartupFailureMessage.mockReset()
  vi.restoreAllMocks()
})

describe('StartupFailureApp measurement handshake', () => {
  it('reports natural content geometry only after the authored surface is committed', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
    render(<StartupFailureApp />)
    expect(reportMeasurement).not.toHaveBeenCalled()

    await until(() => screen.getByText(/stopped before opening its main window/))
    // The measurement runs in an effect after the text commits.
    await until(() => expect(reportMeasurement).toHaveBeenCalledOnce())
    expect(reportMeasurement).toHaveBeenCalledWith({
      naturalHeight: 200,
      minimumHeight: 174,
    })
    expect(document.querySelector('.startup-failure-app')?.hasAttribute('data-measuring')).toBe(false)
    const details = document.querySelector('.startup-failure-app > p')
    expect(details?.getAttribute('role')).toBe('region')
    expect(details?.getAttribute('aria-label')).toBe('Startup failure details')
    expect(details?.getAttribute('tabindex')).toBe('0')
  })

  it('waits for production stylesheets before reporting the committed geometry', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    render(<StartupFailureApp />)
    await until(() => screen.getByText(/stopped before opening its main window/))
    // The text can commit before its passive measurement effect runs. In the
    // browser a load in that gap leaves readyState 'complete', which the effect
    // handles; here readyState stays mocked as 'loading', so let the effect
    // attach its load listener before dispatching.
    await act(async () => {})
    expect(reportMeasurement).not.toHaveBeenCalled()

    act(() => window.dispatchEvent(new Event('load')))

    expect(reportMeasurement).toHaveBeenCalledOnce()
    expect(reportMeasurement).toHaveBeenCalledWith({
      naturalHeight: 200,
      minimumHeight: 174,
    })
  })

  it('lists each refused file on its own line when main says files stopped startup', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
    const line = (key: 'startupFailure.refusedNewer' | 'startupFailure.refusedUnreadable', path: string) => ({ key, values: { path } })
    getStartupFailureMessage.mockResolvedValue({ key: 'startupFailure.refusedMessage', values: { files: {
      key: 'startupFailure.fileList',
      values: { first: line('startupFailure.refusedNewer', '/Users/me/.imagequeue/config.json'), next: line('startupFailure.refusedUnreadable', '/Users/me/.imagequeue/api-keys.json') },
    } } })
    render(<StartupFailureApp />)

    const details = await until(() => screen.getByText(/can’t use these files/))
    expect(details.textContent).toContain('/Users/me/.imagequeue/config.json: written by a newer version of ImageQueue\n/Users/me/.imagequeue/api-keys.json: couldn’t be read')
    await until(() => expect(reportMeasurement).toHaveBeenCalledOnce())
  })

  it('keeps the general copy when main cannot say what stopped startup', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
    getStartupFailureMessage.mockRejectedValue(new Error('Error invoking remote method'))
    render(<StartupFailureApp />)

    await until(() => screen.getByText(/stopped before opening its main window/))
    await until(() => expect(reportMeasurement).toHaveBeenCalledOnce())
  })
})
