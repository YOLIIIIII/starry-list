param([Parameter(Mandatory=$true)][string]$Profile, [switch]$EnsureVisible)
$ErrorActionPreference = 'Stop'
$profilePath = [IO.Path]::GetFullPath($Profile)
$cacheRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.cache/'))
if (!$profilePath.StartsWith($cacheRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Only isolated test profiles are allowed' }
$browserProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($profilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -notmatch '--type=' })
if ($browserProcesses.Count -ne 1) { throw 'Cannot uniquely identify the isolated browser' }
$browserProcess = Get-Process -Id $browserProcesses[0].ProcessId
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class StarryFocusFixture {
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int L,T,R,B; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; public Point(int x,int y) { X=x;Y=y; } }
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr w);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr w,int command);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr w,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr w,int index);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr w,out Rect r);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr w,uint flags);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
    public static void Click(IntPtr window,uint pid,bool ensureVisible) {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        uint actual; GetWindowThreadProcessId(window,out actual);
        if (window==IntPtr.Zero || actual!=pid) throw new Exception("Invalid isolated browser HWND");
        bool wasTopmost=(GetWindowLongPtr(window,-20).ToInt64() & 8)!=0;
        try {
            // Only the profile-verified fixture is temporarily raised; never a user window.
            if (ensureVisible) {
                ShowWindow(window,9);
                if (!SetWindowPos(window,new IntPtr(-1),0,0,0,0,0x13)) throw new Exception("Cannot raise fixture");
            }
            SetForegroundWindow(window);
            System.Threading.Thread.Sleep(250);
            Rect r; if (!GetWindowRect(window,out r)) throw new Exception("Cannot read fixture bounds");
            Point p=new Point(r.L+100,r.T+20);
            if (GetAncestor(WindowFromPoint(p),2)!=window) throw new Exception("Fixture click refused: target covered");
            SetCursorPos(p.X,p.Y);
            mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero);
            // Native mouse activation is queued. Observe the verified browser
            // process (including its owned windows), not an immediate HWND guess.
            uint foregroundPid=0;
            for (int attempt=0;attempt<40;attempt++) {
                GetWindowThreadProcessId(GetForegroundWindow(),out foregroundPid);
                if (foregroundPid==pid) break;
                System.Threading.Thread.Sleep(50);
            }
            if (foregroundPid!=pid) throw new Exception("Fixture did not acquire native foreground");
        } finally {
            if (ensureVisible && !wasTopmost) SetWindowPos(window,new IntPtr(-2),0,0,0,0,0x13);
        }
    }
}
'@
[StarryFocusFixture]::Click($browserProcess.MainWindowHandle, [uint32]$browserProcess.Id, [bool]$EnsureVisible)
