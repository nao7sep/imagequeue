// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider, useConfirm, type Confirm } from '../../../../src/renderer/src/context/ConfirmContext'
import { message } from '../../../../src/shared/i18n/translate'

afterEach(cleanup)

describe('ConfirmProvider', () => {
  it('shows a notice main raised before the window subscribed', async () => {
    window.electronAPI = {
      onAppNotice: vi.fn(() => () => {}),
      takePendingNotices: vi.fn(async () => [{
        title: message('notice.settingsResetTitle'),
        message: message('notice.settingsResetMessage', { path: '/data/config-x.invalid' }),
      }]),
    } as unknown as typeof window.electronAPI
    render(<ConfirmProvider><div /></ConfirmProvider>)
    expect(await screen.findByText('Settings were reset')).toBeTruthy()
    expect(screen.getByText(/\/data\/config-x\.invalid/)).toBeTruthy()
  })

  describe('a confirmation for a key pressed in another view', () => {
    let confirm: Confirm
    function Capture(): null {
      confirm = useConfirm()
      return null
    }
    const api = (confirmInSurface: ReturnType<typeof vi.fn>) => {
      window.electronAPI = {
        onAppNotice: vi.fn(() => () => {}),
        takePendingNotices: vi.fn(async () => []),
        confirmInSurface,
        appLog: vi.fn(async () => undefined),
      } as unknown as typeof window.electronAPI
    }

    it('is asked in that view, and its answer is the answer', async () => {
      const confirmInSurface = vi.fn(async () => true)
      api(confirmInSurface)
      render(<ConfirmProvider><Capture /></ConfirmProvider>)
      await expect(confirm({ message: 'Delete?' }, 'fullscreen-view')).resolves.toBe(true)
      expect(confirmInSurface).toHaveBeenCalledWith('fullscreen-view', { message: 'Delete?' })
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('is asked here when that view has closed in the meantime', async () => {
      api(vi.fn(async () => null))
      render(<ConfirmProvider><Capture /></ConfirmProvider>)
      let answer: Promise<boolean> = Promise.resolve(false)
      await act(async () => { answer = confirm({ message: 'Remove?', confirmLabel: 'Remove' }, 'preview-window') })
      expect(await screen.findByRole('dialog')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
      await expect(answer).resolves.toBe(true)
    })

    it('answers no when the view cannot be asked', async () => {
      api(vi.fn(async () => { throw new Error('ipc down') }))
      render(<ConfirmProvider><Capture /></ConfirmProvider>)
      await expect(confirm({ message: 'Delete?' }, 'preview-window')).resolves.toBe(false)
    })
  })
})
