// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TextProviderSettings } from '../../../../src/renderer/src/components/TextProviderSettings'

function Harness(): React.JSX.Element {
  const [config, setConfig] = useState<Record<string, unknown>>({
    provider: 'gemini',
    gemini: { endpoint: '', elaboration: 'gemini-3.8-flash', slug: 'gemini-3.5-flash-lite', timeout_ms: 30000 },
    openai: { endpoint: '', elaboration: 'local-unlisted', slug: 'gpt-6-luna', timeout_ms: 60000 },
    extraModelIds: { gemini: ['custom'] },
  })
  return <TextProviderSettings config={config} onChange={setConfig} keyField={() => <input type="password" />} />
}
afterEach(cleanup)
function bridge() {
  const api = { getTextModelLists: vi.fn().mockResolvedValue({ gemini: { fetchedAtUtc: '', ids: ['gemini-future'] } }),
    refreshTextModelList: vi.fn().mockResolvedValue({}), appLog: vi.fn().mockResolvedValue(undefined) }
  ;(window as unknown as { electronAPI: unknown }).electronAPI = api
  return api
}

describe('open text provider settings', () => {
  it('shows both provider sections, grouped sources, out-of-list values and free typing', async () => {
    const api = bridge()
    render(<Harness />)
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'gemini-future' })).toHaveLength(2))
    expect(api.getTextModelLists).toHaveBeenCalledOnce()
    const inputs = screen.getAllByLabelText('Elaboration model') as HTMLInputElement[]
    expect(inputs.map((input) => input.value)).toEqual(['gemini-3.8-flash', 'local-unlisted'])
    expect(screen.getByRole('group', { name: 'Out of list' })).toBeTruthy()
    fireEvent.change(inputs[0], { target: { value: 'typed-arbitrary-id' } })
    expect(inputs[0].value).toBe('typed-arbitrary-id')
    expect(screen.getByRole('option', { name: 'typed-arbitrary-id' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } })
    expect(inputs[0].value).toBe('typed-arbitrary-id')
    expect(inputs[1].value).toBe('local-unlisted')
    expect(api.refreshTextModelList).not.toHaveBeenCalled()
  })
  it('labels each role by its id and reads each provider\'s timeout from its own set', async () => {
    bridge()
    render(<Harness />)
    expect((screen.getAllByLabelText('Slug model') as HTMLInputElement[]).map((input) => input.value)).toEqual(['gemini-3.5-flash-lite', 'gpt-6-luna'])
    const timeouts = screen.getAllByLabelText('Timeout (s)') as HTMLInputElement[]
    expect(timeouts.map((input) => input.value)).toEqual(['30', '60'])
    fireEvent.change(timeouts[1], { target: { value: '90' } })
    expect(timeouts.map((input) => input.value)).toEqual(['30', '90'])
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'gemini-future' })).toHaveLength(2))
  })
  it('preserves newlines while editing extra ids and calls only manual refresh on the button', async () => {
    const api = bridge()
    render(<Harness />)
    const extras = screen.getAllByLabelText('Extra model IDs')[0] as HTMLTextAreaElement
    fireEvent.change(extras, { target: { value: 'custom\n' } })
    expect(extras.value).toBe('custom\n')
    fireEvent.change(extras, { target: { value: 'custom\nsecond' } })
    expect(extras.value).toBe('custom\nsecond')
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh models' })[0])
    await waitFor(() => expect(api.refreshTextModelList).toHaveBeenCalledWith('gemini'))
  })
})
