// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StartupFailureApp } from '../../../../src/renderer/src/components/StartupFailureApp'

const reportMeasurement = vi.fn()

beforeEach(() => {
  window.electronAPI = {
    reportStartupFailureMeasurement: reportMeasurement,
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
  vi.restoreAllMocks()
})

describe('StartupFailureApp measurement handshake', () => {
  it('reports natural content geometry only after the authored surface is committed', () => {
    render(<StartupFailureApp message="ImageQueue could not read its configuration." />)

    expect(reportMeasurement).toHaveBeenCalledOnce()
    expect(reportMeasurement).toHaveBeenCalledWith({
      naturalHeight: 200,
      minimumHeight: 174,
    })
    expect(document.querySelector('.startup-failure-app')?.hasAttribute('data-measuring')).toBe(false)
  })
})
