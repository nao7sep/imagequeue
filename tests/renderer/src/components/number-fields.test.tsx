// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { until } from '../../until'
import { settingsEnvironment } from './settings-environment'
import { createDefaultConfig } from '../../../../src/main/config/defaults'

// A number field that does not hold a whole number in range keeps what was
// typed, shows why beneath it and holds Save until it is corrected; it is never
// replaced by 1 or the field's minimum.

const mocks = vi.hoisted(() => ({ settingsValue: {} as Record<string, unknown> }))

vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => mocks.settingsValue,
}))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({
  useConfirm: () => async () => true,
}))
vi.mock('../../../../src/renderer/src/context/UiStateContext', () => ({
  useUiState: () => ({ uiState: { columnWidth: null }, patchUiState: vi.fn() }),
}))

const { SettingsModal } = await import('../../../../src/renderer/src/components/SettingsModal')
const { ElaborationSettingsModal } = await import('../../../../src/renderer/src/components/ElaborationSettingsModal')

beforeEach(() => {
  mocks.settingsValue = {
    settings: createDefaultConfig() as unknown as Record<string, unknown>,
    apiKeys: {},
    apiKeyPresence: null,
    saveChangedSettings: vi.fn().mockResolvedValue({}),
    saveBrainstormSettings: vi.fn().mockResolvedValue(undefined),
    saveNotificationField: vi.fn().mockResolvedValue({}),
  }
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = { platform: 'darwin', ...settingsEnvironment }
})
afterEach(cleanup)

function field(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement
}

function errorOf(input: HTMLInputElement): string | null {
  const id = input.getAttribute('aria-describedby')
  return id ? document.getElementById(id)?.textContent ?? null : null
}

describe('Settings number fields', () => {
  it.each([
    ['settings-openai-concurrency', '', 'Enter a whole number from 1 to 10.'],
    ['settings-openai-concurrency', '11', 'Enter a whole number from 1 to 10.'],
    ['settings-flux-concurrency', '0', 'Enter a whole number from 1 to 24.'],
    ['settings-flux-concurrency', '25', 'Enter a whole number from 1 to 24.'],
    ['settings-grok-timeout', '', 'Enter a whole number of 1 or more.'],
    ['settings-drawthings-timeout', '0', 'Enter a whole number of 1 or more.'],
    ['gemini-timeout', '', 'Enter a whole number of 1 or more.'],
    ['settings-autoPreview', '2.5', 'Enter a whole number of 0 or more.'],
    ['settings-autoPreview', '', 'Enter a whole number of 0 or more.'],
    ['settings-fallbackWidth', '1000', 'Enter a multiple of 64 that is 64 or more.'],
    ['settings-fallbackHeight', '0', 'Enter a multiple of 64 that is 64 or more.'],
    ['settings-fallbackSteps', '0', 'Enter a whole number of 1 or more.'],
    ['settings-fallbackGuidance', '-1', 'Enter a number of 0 or more.'],
    ['settings-fallbackGuidance', '', 'Enter a number of 0 or more.'],
  ])('%s with %j shows an error and holds Save', (id, typed, message) => {
    render(<SettingsModal onClose={vi.fn()} />)
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    fireEvent.change(field('settings-nanobanana-concurrency'), { target: { value: '5' } })
    expect(save.disabled).toBe(false)
    expect(screen.queryByText('Correct the number fields that show an error to save.')).toBeNull()
    fireEvent.change(field(id), { target: { value: typed } })
    expect(field(id).value).toBe(typed)
    expect(field(id).getAttribute('aria-invalid')).toBe('true')
    expect(errorOf(field(id))).toBe(message)
    expect(save.disabled).toBe(true)
    // The field may be on another tab, so the footer says why Save waits.
    expect(screen.getByText('Correct the number fields that show an error to save.')).toBeTruthy()
    fireEvent.click(save)
    expect(mocks.settingsValue.saveChangedSettings).not.toHaveBeenCalled()
  })

  it('saves Draw Things fallbacks without a steps or guidance maximum', async () => {
    const onClose = vi.fn()
    render(<SettingsModal onClose={onClose} />)
    fireEvent.change(field('settings-fallbackSteps'), { target: { value: '200' } })
    fireEvent.change(field('settings-fallbackGuidance'), { target: { value: '0.5' } })
    fireEvent.change(field('settings-fallbackWidth'), { target: { value: '1088' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await until(() => expect(onClose).toHaveBeenCalledOnce())
    const saved = (mocks.settingsValue.saveChangedSettings as ReturnType<typeof vi.fn>).mock.calls[0][1] as
      { image_backends: { drawthings: { default_params: Record<string, number> } } }
    expect(saved.image_backends.drawthings.default_params).toMatchObject({ fallback_steps: 200, fallback_guidance: 0.5, fallback_width: 1088 })
  })

  it('saves the corrected value once the field holds a whole number again', async () => {
    const onClose = vi.fn()
    render(<SettingsModal onClose={onClose} />)
    const timeout = field('settings-openai-timeout')
    fireEvent.change(timeout, { target: { value: '' } })
    fireEvent.change(timeout, { target: { value: '45' } })
    expect(timeout.getAttribute('aria-invalid')).toBe('false')
    expect(errorOf(timeout)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await until(() => expect(onClose).toHaveBeenCalledOnce())
    const saved = (mocks.settingsValue.saveChangedSettings as ReturnType<typeof vi.fn>).mock.calls[0][1] as
      { image_backends: Record<string, { timeout_ms: number }> }
    expect(saved.image_backends.openai.timeout_ms).toBe(45000)
  })
})

describe('Elaboration Settings number fields', () => {
  it('keeps a count outside its range in the field with an error and holds Save', async () => {
    render(<ElaborationSettingsModal onClose={vi.fn()} />)
    const batch = await until(() => {
      const input = field('elaboration-batch_size')
      if (!input) throw new Error('The form has not loaded')
      return input
    })
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    fireEvent.change(batch, { target: { value: '51' } })
    expect(batch.value).toBe('51')
    expect(errorOf(batch)).toBe('Enter a whole number from 1 to 50.')
    expect(save.disabled).toBe(true)
    fireEvent.change(field('elaboration-concurrency'), { target: { value: '' } })
    expect(errorOf(field('elaboration-concurrency'))).toBe('Enter a whole number from 1 to 24.')
    fireEvent.change(batch, { target: { value: '7' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(field('elaboration-concurrency'), { target: { value: '2' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await until(() => expect(mocks.settingsValue.saveBrainstormSettings).toHaveBeenCalledOnce())
    const saved = (mocks.settingsValue.saveBrainstormSettings as ReturnType<typeof vi.fn>).mock.calls[0][0] as
      { batch_size: number; concurrency: number }
    expect(saved).toMatchObject({ batch_size: 7, concurrency: 2 })
  })
})
