// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WelcomePane } from '../../../../src/renderer/src/components/WelcomePane'

afterEach(cleanup)
describe('first-run choices', () => {
  it.each(['darwin', 'win32'])('offers the supported generation routes on %s', (platform) => {
    Object.assign(window, { electronAPI: { platform } })
    const settings = vi.fn()
    const managedTools = vi.fn()
    render(<WelcomePane onOpenSettings={settings} onOpenManagedTools={managedTools} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }))
    expect(settings).toHaveBeenCalledOnce()
    const local = screen.queryByRole('button', { name: 'Managed tools' })
    if (platform === 'darwin') {
      expect(local).not.toBeNull()
      fireEvent.click(local!)
      expect(managedTools).toHaveBeenCalledOnce()
    } else expect(local).toBeNull()
  })
})
