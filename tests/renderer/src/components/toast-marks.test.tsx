import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import { TOAST_MARKS } from '../../../../src/shared/toast-marks'

// The toast window draws plain HTML, so it carries the check and close shapes
// as markup; they must be the icon set's own shapes.
const shapes = (markup: string): string[] =>
  [...markup.matchAll(/<(\w+)((?:\s+[\w-]+="[^"]*")*)\s*\/?>/g)]
    .filter(([, tag]) => tag !== 'svg')
    .map(([, tag, attributes]) => `${tag}${[...attributes!.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => ` ${name}=${value}`).sort().join('')}`)

describe('toast marks', () => {
  it.each(['check', 'close'] as const)('draws the icon set\'s %s', (name) => {
    expect(shapes(TOAST_MARKS[name])).toEqual(shapes(renderToStaticMarkup(<Icon name={name} />)))
    expect(shapes(TOAST_MARKS[name]).length).toBeGreaterThan(0)
  })
})
