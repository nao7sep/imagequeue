import { BrowserWindow, ipcMain } from 'electron'

let viewerWin: BrowserWindow | null = null

const VIEWER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #000; width: 100vw; height: 100vh; display: flex;
       align-items: center; justify-content: center; overflow: hidden; }
img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
</style>
</head>
<body>
<img id="img">
<script>
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); window.close(); }
});
</script>
</body>
</html>`

export function registerViewerIpc(): void {
  ipcMain.handle('viewer:open', async (_event, dataUrl: string) => {
    if (viewerWin && !viewerWin.isDestroyed()) {
      viewerWin.close()
      viewerWin = null
    }

    viewerWin = new BrowserWindow({
      frame: false,
      backgroundColor: '#000000',
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    })

    if (process.platform === 'darwin') {
      viewerWin.setSimpleFullScreen(true)
    } else {
      viewerWin.setFullScreen(true)
    }

    await viewerWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(VIEWER_HTML))
    await viewerWin.webContents.executeJavaScript(
      'document.getElementById("img").src = ' + JSON.stringify(dataUrl)
    )
    viewerWin.show()
    viewerWin.focus()

    viewerWin.on('closed', () => { viewerWin = null })
  })
}
