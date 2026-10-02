// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '../../../../src/renderer/src/context/ConfirmContext'
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
})
