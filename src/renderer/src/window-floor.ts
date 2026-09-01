import type { CSSProperties } from 'react'
import {
  computeWindowMinHeight,
  computeWindowMinWidth,
} from '../../shared/layout-metrics'

export const LAYOUT_VIEWPORT_CLASS = 'layout-viewport'

/** The complete pane floor remains renderer-owned when the native shell must be capped. */
export function layoutFloorStyle(paneCount: number): CSSProperties {
  return {
    height: '100%',
    minWidth: computeWindowMinWidth(paneCount),
    minHeight: computeWindowMinHeight(),
  }
}
