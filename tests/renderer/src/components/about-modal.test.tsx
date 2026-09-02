// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { AboutModal } = await import('../../../../src/renderer/src/components/AboutModal')

let openExternal: ReturnType<typeof vi.fn>
let appLog: ReturnType<typeof vi.fn>

beforeEach(() => {
  openExternal = vi.fn(async () => undefined)
  appLog = vi.fn(async () => undefined)
  window.electronAPI = { openExternal, appLog } as unknown as typeof window.electronAPI
})

afterEach(cleanup)

describe('AboutModal external links', () => {
  it('retains independent authored results, preserves diagnostics, and clears only a matching success', async () => {
    openExternal
      .mockRejectedValueOnce(new Error('EACCES /private/tmp/IMAGEQUEUE_GITHUB_SENTINEL'))
      .mockRejectedValueOnce(new Error('Error invoking remote method IMAGEQUEUE_ISSUES_SENTINEL'))
      .mockResolvedValueOnce(undefined)
    render(<AboutModal onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('link', { name: /GitHub/ }))
    fireEvent.click(screen.getByRole('link', { name: /Report Issue/ }))
    expect(await screen.findAllByRole('alert')).toHaveLength(2)

    const presented = screen.getAllByRole('alert').map((alert) => alert.textContent).join(' ')
    expect(presented).toContain('GitHub page could not be opened')
    expect(presented).toContain('issue page could not be opened')
    expect(presented).not.toMatch(/EACCES|private\/tmp|remote method|SENTINEL/i)
    expect(appLog).toHaveBeenCalledWith(
      'error', 'Failed to open an About link',
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('IMAGEQUEUE_GITHUB_SENTINEL') }) }),
    )

    fireEvent.click(screen.getByRole('link', { name: /GitHub/ }))
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1))
    expect(screen.queryByText(/GitHub page could not be opened/)).toBeNull()
    expect(screen.getByText(/issue page could not be opened/)).toBeTruthy()
  })
})
