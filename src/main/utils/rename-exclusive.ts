import path from 'node:path'
import koffi from 'koffi'

// Node exposes replacing rename only. These same-volume native operations
// atomically claim an absent name without exposing a partially copied file.
// Koffi's async calls run on native workers and restore errno/GetLastError in
// their completion callback, so slow volumes never block Electron's main loop.
let rename: ((source: string, destination: string) => Promise<boolean>) | undefined

function bindRename(): (source: string, destination: string) => Promise<boolean> {
  const windows = process.platform === 'win32'
  const library = koffi.load(windows ? 'kernel32.dll' : process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6')
  const native = windows
    ? library.func('int __stdcall MoveFileExW(const char16_t *source, const char16_t *destination, uint32_t flags)')
    : process.platform === 'darwin'
      ? library.func('int renamex_np(const char *source, const char *destination, unsigned int flags)')
      : library.func('int renameat2(int olddirfd, const char *source, int newdirfd, const char *destination, unsigned int flags)')
  const lastError = windows ? library.func('uint32_t __stdcall GetLastError(void)') : koffi.errno
  return (source, destination) => new Promise<boolean>((resolve, reject) => {
    const finish = (error: Error | null, result: number): void => {
      if (error) { reject(error); return }
      if (windows ? result !== 0 : result === 0) { resolve(true); return }
      const number = lastError() as number
      if (windows ? number === 80 || number === 183 : number === koffi.os.errno.EEXIST) { resolve(false); return }
      const code = windows ? `WIN32_${number}` : Object.keys(koffi.os.errno).find((name) => koffi.os.errno[name] === number) ?? `ERRNO_${number}`
      reject(Object.assign(new Error(`Exclusive rename failed (${code}): ${source} -> ${destination}`), {
        code, errno: number, syscall: 'rename-exclusive', path: source, dest: destination,
      }))
    }
    if (windows) {
      // No REPLACE_EXISTING or COPY_ALLOWED: destination bytes appear together,
      // and cross-volume mistakes fail instead of degrading into a visible copy.
      native.async(path.toNamespacedPath(path.resolve(source)), path.toNamespacedPath(path.resolve(destination)), 0, finish)
    } else if (process.platform === 'darwin') {
      native.async(source, destination, 4 /* RENAME_EXCL */, finish)
    } else {
      native.async(-100 /* AT_FDCWD */, source, -100, destination, 1 /* RENAME_NOREPLACE */, finish)
    }
  })
}

/** True when moved, false when occupied; failure leaves the stage recoverable. */
export function renameExclusive(source: string, destination: string): Promise<boolean> {
  rename ??= bindRename()
  return rename(source, destination)
}
