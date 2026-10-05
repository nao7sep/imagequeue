import { act } from '@testing-library/react'
import { onTestFinished } from 'vitest'

/**
 * Waits until `read` stops throwing and returns what it returned. Between tries
 * one turn of the event loop runs inside act(), so the answers the test's mocks
 * already hold, and the React work they queue, land. It has no deadline of its
 * own, unlike findBy and waitFor: a slow machine makes it slower, never makes it
 * fail, and a condition that never holds ends at the test's timeout. Once its
 * test has ended it stops, so a test that timed out cannot go on to act on the
 * next test's screen.
 */
export async function until<T>(read: () => T): Promise<T> {
  let ended = false
  onTestFinished(() => {
    ended = true
  })
  for (;;) {
    try {
      return read()
    } catch (error) {
      if (ended) throw error
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      })
    }
  }
}
