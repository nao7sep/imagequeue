import { describe, expect, it } from 'vitest'
import { nearestInAdjacentColumn, nextSelectionAfterRemoval, type TaskRef } from '../../../../src/renderer/src/utils/selection-recovery'
import type { BackendId } from '../../../../src/shared'

const ids = (...names: string[]): TaskRef[] => names.map((id) => ({ id }))
const noGeometry = (): number | null => null

describe('nextSelectionAfterRemoval', () => {
  const visible: BackendId[] = ['openai', 'nanobanana', 'flux']

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
      nanobanana: ids('x', 'y', 'z')
    }
    // removed center 100; y (center 110) is nearest.
    const centers: Record<string, number> = { only: 100, x: 0, y: 110, z: 300 }
    const result = nextSelectionAfterRemoval(
      { backend: 'openai', taskId: 'only' },
      lists,
      visible,
      (id) => centers[id] ?? null
    )
    expect(result).toEqual({ backend: 'nanobanana', taskId: 'y' })
  })

  it('falls back to the first task in the column when the removed row has no geometry', () => {
    const lists = { openai: ids('only'), nanobanana: ids('x', 'y') }
    const result = nextSelectionAfterRemoval({ backend: 'openai', taskId: 'only' }, lists, visible, noGeometry)
    expect(result).toEqual({ backend: 'nanobanana', taskId: 'x' })
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

describe('nearestInAdjacentColumn', () => {
  const visible: BackendId[] = ['openai', 'nanobanana', 'flux']
  const centers: Record<string, number> = { a: 50, b: 150, c: 250, x: 40, y: 160, z: 260, p: 10 }
  const centerOf = (taskId: string): number | null => centers[taskId] ?? null

  it('picks the task in the next column whose row is nearest the selected row', () => {
    const lists = { openai: ids('a', 'b', 'c'), nanobanana: ids('x', 'y', 'z') }
    expect(nearestInAdjacentColumn({ backend: 'openai', taskId: 'b' }, lists, visible, 'right', centerOf))
      .toEqual({ backend: 'nanobanana', taskId: 'y' })
    expect(nearestInAdjacentColumn({ backend: 'nanobanana', taskId: 'z' }, lists, visible, 'left', centerOf))
      .toEqual({ backend: 'openai', taskId: 'c' })
  })

  it('skips empty columns and stops at the edge of the board', () => {
    const lists = { openai: ids('a'), nanobanana: [], flux: ids('p') }
    expect(nearestInAdjacentColumn({ backend: 'openai', taskId: 'a' }, lists, visible, 'right', centerOf))
      .toEqual({ backend: 'flux', taskId: 'p' })
    expect(nearestInAdjacentColumn({ backend: 'openai', taskId: 'a' }, lists, visible, 'left', centerOf)).toBeNull()
    expect(nearestInAdjacentColumn({ backend: 'flux', taskId: 'p' }, lists, visible, 'right', centerOf)).toBeNull()
  })

  it('takes the first task of the column when the selected row has no position', () => {
    const lists = { openai: ids('gone'), nanobanana: ids('x', 'y') }
    expect(nearestInAdjacentColumn({ backend: 'openai', taskId: 'gone' }, lists, visible, 'right', centerOf))
      .toEqual({ backend: 'nanobanana', taskId: 'x' })
  })
})
