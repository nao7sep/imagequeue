import { session } from 'electron'

// Content-Security-Policy for the app renderer, set as a response header so it
// governs both the file:// document of a production build and the dev-server
// document in development. Gated on the production-renderer signal (the dev
// server being absent), NOT app.isPackaged — so an unpackaged production run via
// electron-vite preview (run-built/rebuild) still gets the strict policy. The
// renderer makes no network requests of its own (all I/O goes through IPC to
// main) and loads images as data: URLs, so the production policy is strict:
// scripts only from the app bundle, no eval, no remote connections. Development
// relaxes script/connect for Vite's inline refresh preamble and its HMR websocket.
//
// Only http/https/file responses are touched. The viewer and notification
// windows load their own data: documents and are left untouched, so their
// app-injected markup is unaffected.
export function installContentSecurityPolicy(isProductionRenderer: boolean): void {
  const policy = (
    isProductionRenderer
      ? [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self'",
          "connect-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "frame-src 'none'",
        ]
      : [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self' ws: http: https:",
          "object-src 'none'",
        ]
  ).join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const scheme = details.url.split(':', 1)[0]
    if (scheme !== 'http' && scheme !== 'https' && scheme !== 'file') {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}
