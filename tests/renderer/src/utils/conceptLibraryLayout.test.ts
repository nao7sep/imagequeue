import { describe, expect, it } from 'vitest'
import { conceptLibraryLayout } from '../../../../src/renderer/src/utils/conceptLibraryLayout'
import { CONCEPT_LIBRARY_PAGE_SIZE } from '../../../../src/shared/concept-library'

describe('concept library navigation across paged domains', () => {
  it('includes empty domain headers and crosses page/domain boundaries without losing options', () => {
    const size = CONCEPT_LIBRARY_PAGE_SIZE
    const layout = conceptLibraryLayout([{ probeId: 3, count: size + 1 }, { probeId: 9, count: 0 }, { probeId: 15, count: 2 }])
    expect(layout.count).toBe(size + 6)
    expect(layout.idAt(0)).toBe('p:3')
    expect(layout.idAt(size + 1)).toBe(`c:3:${size}`)
    expect(layout.idAt(size + 2)).toBe('p:9')
    expect(layout.idAt(size + 3)).toBe('p:15')
    expect(layout.idAt(layout.count - 1)).toBe('c:15:1')
    expect(layout.blockForLocation(layout.locationAt(size + 1))).toBe(1)
    expect(layout.blockForLocation(layout.locationAt(size + 2))).toBe(2)
    expect(layout.indexOf('c:9:0')).toBe(-1)
    expect(layout.indexOf(`c:3:${size + 1}`)).toBe(-1)
    expect(layout.indexOf('p:100')).toBe(-1)
  })
  it('represents a large domain with page descriptors rather than every option', () => {
    const layout = conceptLibraryLayout([{ probeId: 1, count: 100000 }])
    expect(layout.blocks).toHaveLength(Math.ceil(100000 / CONCEPT_LIBRARY_PAGE_SIZE))
    expect(layout.indexOf(layout.idAt(100000))).toBe(100000)
    expect(layout.blocks.at(-1)?.last).toBe(true)
  })
  it('has no navigation or page targets when the filtered library is empty', () => {
    const layout = conceptLibraryLayout([])
    expect(layout.count).toBe(0)
    expect(layout.blocks).toEqual([])
    expect(layout.indexOf('p:1')).toBe(-1)
  })
})
