import { describe, expect, it } from 'vitest'
import { fitStartupFailureHeight } from '../../src/shared/startup-failure'

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
})
