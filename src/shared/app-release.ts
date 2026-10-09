export type AppReleaseResult = { kind: 'newer'; version: string } | { kind: 'current' } | { kind: 'failed' }
