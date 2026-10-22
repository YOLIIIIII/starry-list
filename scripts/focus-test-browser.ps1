param([Parameter(Mandatory=$true)][string]$Profile)
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
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr w,out Rect r);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr w,uint flags);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
    public static void Click(IntPtr window,uint pid) {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        uint actual; GetWindowThreadProcessId(window,out actual);
        if (window==IntPtr.Zero || actual!=pid) throw new Exception("Invalid isolated browser HWND");
        SetForegroundWindow(window);
        System.Threading.Thread.Sleep(250);
        Rect r; if (!GetWindowRect(window,out r)) throw new Exception("Cannot read fixture bounds");
        Point p=new Point(r.L+100,r.T+20);
        if (GetAncestor(WindowFromPoint(p),2)!=window) throw new Exception("Fixture click refused: target covered");
        SetCursorPos(p.X,p.Y);
        mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero);
        if (GetForegroundWindow()!=window) throw new Exception("Fixture did not acquire native foreground");
    }
}
'@
[StarryFocusFixture]::Click($browserProcess.MainWindowHandle, [uint32]$browserProcess.Id)
