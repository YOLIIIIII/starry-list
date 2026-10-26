param(
    [ValidateSet('click', 'drag', 'hit', 'raise', 'browser', 'win-d', 'win-d-restore')][string]$Action,
    [int]$OwnerPid,
    [long]$Window,
    [int]$X,
    [int]$Y,
    [int]$DeltaX,
    [int]$DeltaY,
    [string]$ProfileDir
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ProbeInput {
    public delegate bool EnumProc(IntPtr h, IntPtr data);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    public static IntPtr SyntheticBrowser() {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, data) => {
            var title = new System.Text.StringBuilder(256);
            GetWindowText(h, title, 256);
            if (title.ToString().StartsWith("SL006 synthetic browser cover")) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flag);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
[void][ProbeInput]::SetProcessDpiAwarenessContext([IntPtr](-4))
$target = [IntPtr]$Window
[uint32]$actualOwner = 0
[void][ProbeInput]::GetWindowThreadProcessId($target, [ref]$actualOwner)
if ($actualOwner -ne $OwnerPid) { throw 'Refusing input: target does not belong to probe process' }
if ($Action -eq 'browser') {
    $browserWindow = [ProbeInput]::SyntheticBrowser()
    if ($browserWindow -eq [IntPtr]::Zero) { throw 'Synthetic browser window not found' }
    [uint32]$browserOwner = 0
    [void][ProbeInput]::GetWindowThreadProcessId($browserWindow, [ref]$browserOwner)
    $browserProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $browserOwner"
    if (-not $ProfileDir -or $browserProcess.Name -ne 'msedge.exe' -or $browserProcess.CommandLine.IndexOf($ProfileDir, [StringComparison]::OrdinalIgnoreCase) -lt 0) { throw 'Refusing browser activation: isolated profile not verified' }
    [void][ProbeInput]::ShowWindow($browserWindow, 9)
    # Position only the profile-verified synthetic browser over the research probe.
    [void][ProbeInput]::SetWindowPos($browserWindow, [IntPtr]::Zero, 60, 100, 1100, 850, 0x10)
    [void][ProbeInput]::SetForegroundWindow($browserWindow)
    return
}
if ($Action -eq 'raise') {
    if (-not [ProbeInput]::SetWindowPos($target, [IntPtr]::Zero, 0, 0, 0, 0, 0x13)) { throw 'Probe raise failed' }
    return
}
if ($Action.StartsWith('win-d')) {
    if ($Action -eq 'win-d') {
        [uint32]$foregroundOwner = 0
        [void][ProbeInput]::GetWindowThreadProcessId([ProbeInput]::GetForegroundWindow(), [ref]$foregroundOwner)
        if ($foregroundOwner -ne $OwnerPid) { throw 'Refusing Win+D: foreground belongs to another process' }
    }
    try {
        [ProbeInput]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)
        [ProbeInput]::keybd_event(0x44, 0, 0, [UIntPtr]::Zero)
    } finally {
        [ProbeInput]::keybd_event(0x44, 0, 2, [UIntPtr]::Zero)
        [ProbeInput]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)
    }
    return
}
$point = New-Object ProbeInput+POINT
$point.X = $X; $point.Y = $Y
if ($Action -eq 'hit') {
    $hitRoot = [ProbeInput]::GetAncestor([ProbeInput]::WindowFromPoint($point), 2)
    $className = New-Object System.Text.StringBuilder 128
    [void][ProbeInput]::GetClassName($hitRoot, $className, 128)
    $role = if ($className.ToString() -in @('Progman', 'WorkerW', 'Shell_TrayWnd')) { $className.ToString() } else { 'other-app-or-probe' }
    $title = New-Object System.Text.StringBuilder 256
    [void][ProbeInput]::GetWindowText($hitRoot, $title, 256)
    @{ targetAtPoint = $hitRoot -eq $target; hitRole = $role; syntheticBrowserAtPoint = $title.ToString().StartsWith('SL006 synthetic browser cover') } | ConvertTo-Json -Compress
    return
}
if ([ProbeInput]::GetAncestor([ProbeInput]::WindowFromPoint($point), 2) -ne $target) {
    throw 'Refusing pointer input: target is occluded or not hit-testable'
}
$oldPoint = New-Object ProbeInput+POINT
[void][ProbeInput]::GetCursorPos([ref]$oldPoint)
try {
    [void][ProbeInput]::SetCursorPos($X, $Y)
    [ProbeInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    if ($Action -eq 'drag') {
        for ($step = 1; $step -le 10; $step++) {
            [void][ProbeInput]::SetCursorPos($X + [int]($DeltaX * $step / 10), $Y + [int]($DeltaY * $step / 10))
            Start-Sleep -Milliseconds 30
        }
    }
} finally {
    [ProbeInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    [void][ProbeInput]::SetCursorPos($oldPoint.X, $oldPoint.Y)
}
