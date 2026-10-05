import { createElement as h } from 'react'
import { beforeAll } from 'vitest'

// The first render and the first accessible-name query in a file compile
// React's renderer and Testing Library's role and label code, which costs a
// test several times what the same work costs once warm. That one-time cost is
// paid here, before the file's first test, on a small surface built from the
// elements the app's windows use.
beforeAll(async () => {
  if (typeof document === 'undefined') return
  const { cleanup, fireEvent, render, screen } = await import('@testing-library/react')
  render(
    h('div', { role: 'dialog', 'aria-label': 'Warm-up' },
      h('h2', null, 'Warm-up'),
      h('label', null, 'Name', h('input', { defaultValue: 'x' })),
      h('select', { 'aria-label': 'Choice', defaultValue: 'a' }, h('option', { value: 'a' }, 'A')),
      h('div', { role: 'radiogroup', 'aria-label': 'Mode' }, h('label', null, h('input', { type: 'radio', name: 'm' }), 'One')),
      h('div', { role: 'alert' }, 'Note'),
      h('button', { type: 'button' }, 'Go'),
    ),
  )
  screen.getByRole('dialog', { name: 'Warm-up' })
  screen.getByRole('heading', { name: 'Warm-up' })
  screen.getByLabelText('Name')
  screen.getByRole('combobox', { name: 'Choice' })
  screen.getByRole('radio', { name: 'One' })
  screen.getByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Go', hidden: true }))
  screen.getByText('Note')
  cleanup()
})
