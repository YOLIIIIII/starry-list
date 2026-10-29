param([int]$OwnerPid,[long]$Window,[int]$X,[int]$Y,[int]$DeltaX,[int]$DeltaY,[switch]$Cancel,[int]$HoldMs=0)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DragInput {
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
}
'@
[void][DragInput]::SetProcessDpiAwarenessContext([IntPtr](-4))
$target=[IntPtr]$Window
[uint32]$actual=0
[void][DragInput]::GetWindowThreadProcessId($target,[ref]$actual)
if($actual -ne $OwnerPid){throw 'Wrong test process'}
$p=New-Object DragInput+POINT;$p.X=$X;$p.Y=$Y
if([DragInput]::GetAncestor([DragInput]::WindowFromPoint($p),2) -ne $target){throw 'Covered test handle'}
try {
 [void][DragInput]::SetCursorPos($X,$Y)
 [DragInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
 for($i=1;$i -le 30;$i++){
 [void][DragInput]::SetCursorPos($X+[int]($DeltaX*$i/30),$Y+[int]($DeltaY*$i/30))
 Start-Sleep -Milliseconds 30
 }
 if($HoldMs -gt 0){Start-Sleep -Milliseconds ([Math]::Min(2000,$HoldMs))}
 if($Cancel){
 [uint32]$foregroundOwner=0
 [void][DragInput]::GetWindowThreadProcessId([DragInput]::GetForegroundWindow(),[ref]$foregroundOwner)
 if($foregroundOwner -ne $OwnerPid){throw 'Refusing Escape outside test process'}
 [DragInput]::keybd_event(27,0,0,[UIntPtr]::Zero)
 [DragInput]::keybd_event(27,0,2,[UIntPtr]::Zero)
 }
} finally { [DragInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
