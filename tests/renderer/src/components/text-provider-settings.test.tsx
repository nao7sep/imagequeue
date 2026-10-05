// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TextProviderSettings } from '../../../../src/renderer/src/components/TextProviderSettings'

function Harness(): React.JSX.Element {
  const [config, setConfig] = useState<Record<string, unknown>>({
    provider: 'gemini',
    gemini: { endpoint: 'https://generativelanguage.googleapis.com', elaboration: 'gemini-3.8-flash', slug: 'gemini-3.5-flash-lite', thinking: { elaboration: '', slug: '' }, timeout_ms: 30000 },
    openai: { endpoint: 'https://api.openai.com/v1', elaboration: 'local-unlisted', slug: 'gpt-6-luna', thinking: { elaboration: '', slug: 'high' }, timeout_ms: 60000 },
  })
  return <TextProviderSettings config={config} onChange={setConfig} keyField={() => <input type="password" />} />
}
afterEach(cleanup)

const WARNING = 'Not a supported model. It may not work as expected.'

describe('text provider settings', () => {
  it('lays out each provider as endpoint, key, elaboration model, slug model, timeout', () => {
    const { container } = render(<Harness />)
    const sections = container.querySelectorAll('.settings-subsection')
    expect(sections).toHaveLength(2)
    const labels = [...sections[0]!.querySelectorAll('label')].map((label) => label.textContent)
    expect(labels).toEqual(['Endpoint', 'API Key', 'Elaboration model', 'Thinking', 'Slug model', 'Thinking', 'Timeout (s)'])
    expect(screen.getByText('The address ImageQueue sends Gemini requests to.')).toBeTruthy()
    expect(screen.getAllByText('Expands an idea into varied image prompts.')).toHaveLength(2)
    expect(screen.getAllByText('Names each generated image file from its prompt.')).toHaveLength(2)
    expect(container.querySelector('textarea')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('warns under a model field only when the id is not a text row for that provider', () => {
    render(<Harness />)
    expect(screen.getAllByText(WARNING)).toHaveLength(1)
    const elaboration = screen.getAllByLabelText('Elaboration model') as HTMLInputElement[]
    fireEvent.change(elaboration[1]!, { target: { value: ' GPT-5.6-TERRA ' } })
    expect(screen.queryAllByText(WARNING)).toHaveLength(0)
    fireEvent.change(elaboration[0]!, { target: { value: 'gpt-5.6-terra' } })
    expect(screen.getAllByText(WARNING)).toHaveLength(1)
    expect(elaboration[0]!.value).toBe('gpt-5.6-terra')
  })
  it('keeps each provider\'s fields when the provider changes, and reads each timeout from its own set', () => {
    render(<Harness />)
    const timeouts = screen.getAllByLabelText('Timeout (s)') as HTMLInputElement[]
    expect(timeouts.map((input) => input.value)).toEqual(['30', '60'])
    fireEvent.change(timeouts[1]!, { target: { value: '90' } })
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } })
    expect(timeouts.map((input) => input.value)).toEqual(['30', '90'])
    expect((screen.getAllByLabelText('Slug model') as HTMLInputElement[]).map((input) => input.value)).toEqual(['gemini-3.5-flash-lite', 'gpt-6-luna'])
  })
  it('lists the selected model\'s thinking values in its own words, showing the chosen or default value', () => {
    const { container } = render(<Harness />)
    const select = (id: string) => container.querySelector<HTMLSelectElement>(`#${id}-thinking`)
    expect([...select('gemini-slug')!.options].map((option) => option.value)).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(select('gemini-slug')!.value).toBe('minimal')
    expect(select('gemini-elaboration')!.value).toBe('medium')
    expect([...select('openai-slug')!.options].map((option) => option.value)).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(select('openai-slug')!.value).toBe('high')
    expect(select('openai-elaboration')).toBeNull()
  })
  it('resets a role\'s thinking to the new model\'s default when its model changes', () => {
    const { container } = render(<Harness />)
    const slug = (screen.getAllByLabelText('Slug model') as HTMLInputElement[])[1]!
    fireEvent.change(slug, { target: { value: 'gpt-6.1-sol' } })
    const select = container.querySelector<HTMLSelectElement>('#openai-slug-thinking')!
    expect([...select.options].map((option) => option.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    // The smart model's own default, though the slug role is fast.
    expect(select.value).toBe('medium')
    fireEvent.change(select, { target: { value: 'max' } })
    expect(select.value).toBe('max')
    fireEvent.change(slug, { target: { value: 'gpt-6-luna' } })
    expect(container.querySelector<HTMLSelectElement>('#openai-slug-thinking')!.value).toBe('none')
    fireEvent.change(slug, { target: { value: 'local-model' } })
    expect(container.querySelector('#openai-slug-thinking')).toBeNull()
  })
  it('keeps a role\'s chosen thinking when the model edit resolves to the same row', () => {
    const { container } = render(<Harness />)
    const slug = (screen.getAllByLabelText('Slug model') as HTMLInputElement[])[1]!
    const select = (): HTMLSelectElement => container.querySelector<HTMLSelectElement>('#openai-slug-thinking')!
    expect(select().value).toBe('high')
    for (const value of ['gpt-6-luna ', ' GPT-6-Luna', 'gpt-6-luna']) {
      fireEvent.change(slug, { target: { value } })
      expect(slug.value).toBe(value)
      expect(select().value).toBe('high')
    }
  })
  it('resets thinking when the model moves from an unlisted id back to a listed one', () => {
    const { container } = render(<Harness />)
    const slug = (screen.getAllByLabelText('Slug model') as HTMLInputElement[])[1]!
    fireEvent.change(slug, { target: { value: 'local-model' } })
    expect(container.querySelector('#openai-slug-thinking')).toBeNull()
    fireEvent.change(slug, { target: { value: 'gpt-6-luna' } })
    expect(container.querySelector<HTMLSelectElement>('#openai-slug-thinking')!.value).toBe('none')
  })
})
