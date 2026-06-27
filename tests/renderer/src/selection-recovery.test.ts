import { describe, expect, it } from 'vitest'
import { nextSelectionAfterRemoval, type TaskRef } from '../../../src/renderer/src/utils/selection-recovery'
import type { BackendId } from '../../../src/shared'

const ids = (...names: string[]): TaskRef[] => names.map((id) => ({ id }))
const noGeometry = (): number | null => null

describe('nextSelectionAfterRemoval', () => {
  const visible: BackendId[] = ['openai', 'imagen', 'flux']

  it('selects the next task down in the same column', () => {
    const lists = { openai: ids('a', 'b', 'c') }
    expect(nextSelectionAfterRemoval({ backend: 'openai', taskId: 'b' }, lists, visible, noGeometry)).toEqual({
      backend: 'openai',
      taskId: 'c'
    })
  })

  it('falls back to the previous task when removing the last in the column', () => {
    const lists = { openai: ids('a', 'b', 'c') }
    expect(nextSelectionAfterRemoval({ backend: 'openai', taskId: 'c' }, lists, visible, noGeometry)).toEqual({
      backend: 'openai',
      taskId: 'b'
    })
  })

  it('jumps to the nearest task in the next column by vertical center', () => {
    const lists = {
      openai: ids('only'), // removing the sole task — no same-column neighbor
      imagen: ids('x', 'y', 'z')
    }
    // removed center 100; y (center 110) is nearest.
    const centers: Record<string, number> = { only: 100, x: 0, y: 110, z: 300 }
    const result = nextSelectionAfterRemoval(
      { backend: 'openai', taskId: 'only' },
      lists,
      visible,
      (id) => centers[id] ?? null
    )
    expect(result).toEqual({ backend: 'imagen', taskId: 'y' })
  })

  it('falls back to the first task in the column when the removed row has no geometry', () => {
    const lists = { openai: ids('only'), imagen: ids('x', 'y') }
    const result = nextSelectionAfterRemoval({ backend: 'openai', taskId: 'only' }, lists, visible, noGeometry)
    expect(result).toEqual({ backend: 'imagen', taskId: 'x' })
  })

  it('searches leftward when no column to the right has tasks', () => {
    const lists = { openai: ids('a'), flux: ids('only') }
    // Remove flux's sole task; nothing to the right, so recover leftward to openai.
    const result = nextSelectionAfterRemoval({ backend: 'flux', taskId: 'only' }, lists, visible, noGeometry)
    expect(result).toEqual({ backend: 'openai', taskId: 'a' })
  })

  it('returns null when no other task exists anywhere', () => {
    const lists = { openai: ids('only') }
    expect(nextSelectionAfterRemoval({ backend: 'openai', taskId: 'only' }, lists, visible, noGeometry)).toBeNull()
  })

  it('returns null when the backend is not among the visible columns', () => {
    const lists = { drawthings: ids('a', 'b') }
    expect(nextSelectionAfterRemoval({ backend: 'drawthings', taskId: 'a' }, lists, visible, noGeometry)).toEqual({
      backend: 'drawthings',
      taskId: 'b'
    })
    // But a sole task in a non-visible column has no adjacent-column fallback.
    expect(
      nextSelectionAfterRemoval({ backend: 'drawthings', taskId: 'solo' }, { drawthings: ids('solo') }, visible, noGeometry)
    ).toBeNull()
  })
})
