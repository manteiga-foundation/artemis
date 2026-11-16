// Ends a launched Artemis and everything it started, as a failed test's cleanup. POSIX: the
// process group, then Electron by the test's own profile path (Playwright gives Electron its own
// group). Windows has no process groups: taskkill takes the whole tree.
export function killTree(pid: number, profile: string): void {
  if (process.platform === 'win32') {
    Bun.spawnSync(['taskkill', '/F', '/T', '/PID', String(pid)]);
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // already gone
  }
  Bun.spawnSync(['pkill', '-9', '-f', profile]);
}

/** Is any process still running with the test's own profile path on its command line? */
export function stillRunning(profile: string): boolean {
  if (process.platform === 'win32') {
    const needle = profile.replace(/'/g, "''");
    const r = Bun.spawnSync([
      'powershell',
      '-NoProfile',
      '-Command',
      `@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('${needle}') }).Count`
    ]);
    return Number(r.stdout.toString().trim()) > 0;
  }
  return Bun.spawnSync(['pgrep', '-f', profile]).exitCode === 0;
}

/**
 * Windows: one Ctrl+C in the console the process runs in, as a person pressing it there. A
 * PowerShell attaches to that console, ignores the event itself, and sends CTRL_C_EVENT to every
 * process on it. True when it was sent.
 */
export function pressCtrlC(pid: number): boolean {
  const script = `Add-Type @'
using System; using System.Runtime.InteropServices;
public static class ArtemisCtrlC {
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint p);
  [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr h, bool add);
  [DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint e, uint g);
}
'@
[ArtemisCtrlC]::FreeConsole() | Out-Null
if (-not [ArtemisCtrlC]::AttachConsole(${pid})) { exit 2 }
[ArtemisCtrlC]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
if (-not [ArtemisCtrlC]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }
Start-Sleep -Milliseconds 500`;
  return Bun.spawnSync(['powershell', '-NoProfile', '-Command', script]).exitCode === 0;
}
