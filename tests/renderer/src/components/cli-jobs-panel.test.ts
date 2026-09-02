import { describe, expect, it } from 'vitest'
import { jobIcon } from '../../../../src/renderer/src/components/CliJobsPanel'

describe('CLI job status marks', () => {
  it('does not repeat an explicit successful result with a checkmark', () => {
    expect(jobIcon('import', 'exited', 0)).toBeNull()
    expect(jobIcon('download', 'exited', 0)).toBeNull()
  })

  it('keeps marks only when they identify the active operation', () => {
    expect(jobIcon('import', 'running', null)).toBe('upload')
    expect(jobIcon('download', 'running', null)).toBe('download')
    expect(jobIcon('import', 'stalled', null)).toBe('upload')
    expect(jobIcon('import', 'killed', null)).toBeNull()
    expect(jobIcon('import', 'exited', 1)).toBeNull()
  })
})
