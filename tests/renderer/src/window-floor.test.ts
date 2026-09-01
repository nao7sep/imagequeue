import { describe, expect, it } from 'vitest'
import {
  computeWindowMinHeight,
  computeWindowMinWidth,
} from '../../../src/shared/layout-metrics'
import {
  LAYOUT_VIEWPORT_CLASS,
  layoutFloorStyle,
} from '../../../src/renderer/src/window-floor'

describe('main layout viewport floor', () => {
  it('keeps the complete live pane floor on a definite ordinary height', () => {
    expect(layoutFloorStyle(5)).toEqual({
      height: '100%',
      minWidth: computeWindowMinWidth(5),
      minHeight: computeWindowMinHeight(),
    })
  })

  it('names the single renderer overflow owner used by Layout', () => {
    expect(LAYOUT_VIEWPORT_CLASS).toBe('layout-viewport')
  })
})
