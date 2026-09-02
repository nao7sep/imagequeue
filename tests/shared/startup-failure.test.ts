import { describe, expect, it } from 'vitest'
import { fitStartupFailureHeight, isStartupFailureMeasurement } from '../../src/shared/startup-failure'

describe('startup failure window fit', () => {
  it('uses natural content height for short authored copy', () => {
    expect(fitStartupFailureHeight({ naturalHeight: 206, minimumHeight: 174 }, 1000)).toEqual({
      height: 206,
      minimumHeight: 174,
    })
  })

  it('caps hostile long copy while retaining a body viewport and fixed action band', () => {
    expect(fitStartupFailureHeight({ naturalHeight: 4000, minimumHeight: 174 }, 800)).toEqual({
      height: 680,
      minimumHeight: 174,
    })
  })

  it('accepts only finite positive renderer measurements', () => {
    expect(isStartupFailureMeasurement({ naturalHeight: 206, minimumHeight: 174 })).toBe(true)
    expect(isStartupFailureMeasurement({ naturalHeight: 0, minimumHeight: 174 })).toBe(false)
    expect(isStartupFailureMeasurement({ naturalHeight: 206, minimumHeight: Number.NaN })).toBe(false)
    expect(isStartupFailureMeasurement({ naturalHeight: '206', minimumHeight: 174 })).toBe(false)
  })
})
