export interface MainWindowContentTarget {
  loadURL(url: string): Promise<void>
  loadFile(filePath: string): Promise<void>
}

/** Keep Chromium's renderer navigation rejectable until the startup owner settles it. */
export function loadMainWindowContent(
  win: MainWindowContentTarget,
  rendererUrl: string | undefined,
  rendererFile: string,
): Promise<void> {
  return rendererUrl ? win.loadURL(rendererUrl) : win.loadFile(rendererFile)
}

/** Route every navigation rejection to the startup recovery owner. */
export function ownMainWindowContentLoad(
  win: MainWindowContentTarget,
  rendererUrl: string | undefined,
  rendererFile: string,
  onFailure: (cause: unknown) => void,
): void {
  void loadMainWindowContent(win, rendererUrl, rendererFile).catch(onFailure)
}
