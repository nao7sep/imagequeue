import { describe, expect, it } from 'vitest'
import { CLI_JOB_STATUS_LABELS, jsonBlockText } from '../../../../src/renderer/src/records/record-format'
import { ENGLISH } from '../../../../src/shared/i18n/catalogues'

describe('record formatting', () => {
  it('indents stored JSON and shows other text as it is', () => {
    expect(jsonBlockText('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(jsonBlockText('[0]')).toBe('[\n  0\n]')
    expect(jsonBlockText('false')).toBe('false')
    expect(jsonBlockText('"text"')).toBe('"text"')
    expect(jsonBlockText('not json')).toBe('not json')
  })

  it('leaves out a block with nothing in it', () => {
    for (const empty of [null, '', '  \n', '{}', ' { } ', 'null', '[]', '""', '"  "']) {
      expect(jsonBlockText(empty)).toBeNull()
    }
  })
})


it('names a timed-out CLI record without exposing its internal status value', () => {
  const label = CLI_JOB_STATUS_LABELS['timed-out']!
  expect(ENGLISH[label]).toBe('Timed out')
})
