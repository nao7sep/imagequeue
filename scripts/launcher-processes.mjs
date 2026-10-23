import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

// Creation identity is used only to observe recorded children, never to infer
// authority from an executable path or a command-line argument.
export async function listProcesses(platform = process.platform, run = execute) {
  if (platform !== 'win32') {
    const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,lstart='], {
      encoding: 'utf8', timeout: 5000, env: { ...process.env, LC_ALL: 'C' },
    });
    return stdout.trim().split('\n').flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      return match ? [{ pid: Number(match[1]), parentPid: Number(match[2]), created: match[3].trim() }] : [];
    });
  }
  const script = '$ErrorActionPreference = "Stop"; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,@{Name="Created";Expression={if ($_.CreationDate) {$_.CreationDate.ToUniversalTime().ToString("o")}}} | ConvertTo-Json -Compress';
  const { stdout } = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 10000,
  });
  const parsed = JSON.parse(stdout || '[]');
  return (Array.isArray(parsed) ? parsed : parsed ? [parsed] : []).filter((row) => typeof row.Created === 'string' && row.Created.length > 0).map((row) => ({
    pid: Number(row.ProcessId), parentPid: Number(row.ParentProcessId), created: row.Created,
  }));
}

export const processKey = ({ pid, created }) => `${pid}:${created}`;
export const processIdentity = ({ pid, created }) => ({ pid, created });

/** Keep previously recorded descendants after reparenting. Only a still-live
 * recorded parent can admit a new child; a reused PID cannot grow this set. */
export function retainProcessTree(recorded, current) {
  const identities = new Map(recorded.map((item) => [processKey(item), item]));
  const live = new Set(current.filter((item) => identities.has(processKey(item))).map((item) => item.pid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of current) {
      if (live.has(item.parentPid) && !live.has(item.pid)) {
        live.add(item.pid);
        identities.set(processKey(item), processIdentity(item));
        changed = true;
      }
    }
  }
  return [...identities.values()];
}

export function liveRecorded(recorded, current) {
  const keys = new Set(recorded.map(processKey));
  return current.filter((item) => keys.has(processKey(item)));
}
