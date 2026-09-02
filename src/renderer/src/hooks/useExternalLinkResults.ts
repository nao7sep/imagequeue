import { useCallback, useRef, useState } from 'react'
import { recordOperationalDiagnostic } from '../utils/operationalFailure'

export type ExternalLinkResults = Record<string, string | undefined>

/** Retain each external-link failure at its modal owner with latest-attempt settlement. */
export function useExternalLinkResults(): {
  results: ExternalLinkResults
  open: (options: {
    key: string
    url: string
    message: string
    diagnosticMessage: string
  }) => Promise<void>
  dismiss: (key: string) => void
} {
  const [results, setResults] = useState<ExternalLinkResults>({})
  const attemptsRef = useRef(new Map<string, number>())

  const dismiss = useCallback((key: string): void => {
    setResults((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])

  const open = useCallback(async ({ key, url, message, diagnosticMessage }: {
    key: string
    url: string
    message: string
    diagnosticMessage: string
  }): Promise<void> => {
    const attempt = (attemptsRef.current.get(key) ?? 0) + 1
    attemptsRef.current.set(key, attempt)
    try {
      await window.electronAPI.openExternal(url)
      if (attemptsRef.current.get(key) === attempt) dismiss(key)
    } catch (error) {
      recordOperationalDiagnostic(diagnosticMessage, error, { url, linkKey: key })
      if (attemptsRef.current.get(key) !== attempt) return
      setResults((current) => ({ ...current, [key]: message }))
    }
  }, [dismiss])

  return { results, open, dismiss }
}
