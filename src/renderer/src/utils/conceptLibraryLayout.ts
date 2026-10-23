import { CONCEPT_LIBRARY_PAGE_SIZE, type ConceptLibraryIndex, type ConceptLibraryLocation } from '../../../shared/concept-library'

export function conceptLocationKey(location: ConceptLibraryLocation): string {
  return location.offset < 0 ? `p:${location.probeId}` : `c:${location.probeId}:${location.offset}`
}

/** Compact navigation and page geometry; no array of every concept identity. */
export function conceptLibraryLayout(groups: ConceptLibraryIndex['groups']) {
  let optionCount = 0
  const blocks: { probeId: number; offset: number; count: number; first: boolean; last: boolean }[] = []
  const indexed = groups.map((group) => {
    const entry = { ...group, optionStart: optionCount, blockStart: blocks.length }
    optionCount += group.count + 1
    const pages = Math.max(1, Math.ceil(group.count / CONCEPT_LIBRARY_PAGE_SIZE))
    for (let page = 0; page < pages; page++) blocks.push({
      probeId: group.probeId, offset: page * CONCEPT_LIBRARY_PAGE_SIZE,
      count: Math.min(CONCEPT_LIBRARY_PAGE_SIZE, group.count - page * CONCEPT_LIBRARY_PAGE_SIZE),
      first: page === 0, last: page === pages - 1,
    })
    return entry
  })
  const byProbe = new Map(indexed.map((group) => [group.probeId, group]))
  const locationAt = (index: number): ConceptLibraryLocation => {
    let low = 0; let high = indexed.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (indexed[middle].optionStart <= index) low = middle
      else high = middle - 1
    }
    const group = indexed[low]
    return { probeId: group.probeId, offset: index - group.optionStart - 1 }
  }
  const locationForKey = (key: string): ConceptLibraryLocation => {
    const [kind, probe, offset] = key.split(':')
    return { probeId: Number(probe), offset: kind === 'p' ? -1 : Number(offset) }
  }
  const indexOfLocation = (location: ConceptLibraryLocation): number => {
    const group = byProbe.get(location.probeId)
    return group && location.offset >= -1 && location.offset < group.count
      ? group.optionStart + location.offset + 1 : -1
  }
  const blockForLocation = (location: ConceptLibraryLocation): number => {
    const group = byProbe.get(location.probeId)
    return group ? group.blockStart + Math.floor(Math.max(0, location.offset) / CONCEPT_LIBRARY_PAGE_SIZE) : -1
  }
  return { blocks, count: optionCount, locationAt, locationForKey, indexOfLocation, blockForLocation,
    idAt: (index: number) => conceptLocationKey(locationAt(index)),
    indexOf: (key: string) => indexOfLocation(locationForKey(key)),
  }
}
