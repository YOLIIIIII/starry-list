param([int]$OwnerPid,[string]$TestRoot,[string]$FilePath,[switch]$Cancel)
$ErrorActionPreference='Stop'
$cacheRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.cache'))+[IO.Path]::DirectorySeparatorChar
$testDirectory=[IO.Path]::GetFullPath($TestRoot)
if(-not $testDirectory.StartsWith($cacheRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Test directory must stay within workspace cache'}
if(-not $Cancel){$targetPath=[IO.Path]::GetFullPath($FilePath);if(-not $targetPath.StartsWith($testDirectory+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'File selection must stay within isolated test directory'}}
$expectedExe=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\src-tauri\target\debug\starry-list.exe'))
if((Get-Process -Id $OwnerPid).Path -ne $expectedExe){throw 'Only the isolated debug executable is allowed'}
Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class BackupDialogInput {
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr h);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb,IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent,EnumProc cb,IntPtr l);
 [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr h,uint msg,IntPtr w,string text);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageW")] public static extern IntPtr GetText(IntPtr h,uint msg,IntPtr length,StringBuilder text);
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect rect);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 public static void Click(IntPtr h) {Rect r;if(!GetWindowRect(h,out r))throw new Exception("No control bounds");var p=new Point{X=(r.Left+r.Right)/2,Y=(r.Top+r.Bottom)/2};if(GetAncestor(WindowFromPoint(p),2)!=GetAncestor(h,2))throw new Exception("Refusing click on a covered test dialog");SetCursorPos(p.X,p.Y);mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);}
 public static IntPtr Child(IntPtr parent,int id,string cls) {IntPtr result=IntPtr.Zero;EnumChildWindows(parent,(h,l)=>{var s=new StringBuilder(100);GetClassName(h,s,100);if(GetDlgCtrlID(h)==id && s.ToString()==cls && IsWindowVisible(h)){result=h;return false;}return true;},IntPtr.Zero);return result;}
 public static IntPtr Find(int owner) {IntPtr result=IntPtr.Zero;EnumWindows((h,l)=>{uint pid;GetWindowThreadProcessId(h,out pid);var s=new StringBuilder(100);GetClassName(h,s,100);if(pid==owner&&IsWindowVisible(h)&&s.ToString()=="#32770"){result=h;return false;}return true;},IntPtr.Zero);return result;}
}
'@
[void][BackupDialogInput]::SetProcessDpiAwarenessContext([IntPtr](-4))
$dialog=[IntPtr]::Zero
for($i=0;$i -lt 100;$i++){$dialog=[BackupDialogInput]::Find($OwnerPid);if($dialog -ne [IntPtr]::Zero){break};Start-Sleep -Milliseconds 100}
if($dialog -eq [IntPtr]::Zero){throw 'No owned native file dialog found'}
[void][BackupDialogInput]::SetForegroundWindow($dialog)
Start-Sleep -Milliseconds 150
[uint32]$foregroundOwner=0
[void][BackupDialogInput]::GetWindowThreadProcessId([BackupDialogInput]::GetForegroundWindow(),[ref]$foregroundOwner)
if($foregroundOwner -ne $OwnerPid){throw 'Refusing keyboard input outside test process'}
if($Cancel){[Windows.Forms.SendKeys]::SendWait('{ESC}')}
else {
 [Windows.Forms.SendKeys]::SendWait('%n')
 $filename=[IntPtr]::Zero
 for($i=0;$i -lt 30;$i++){
 $filename=[BackupDialogInput]::Child($dialog,1001,'Edit')
 if($filename -eq [IntPtr]::Zero){$filename=[BackupDialogInput]::Child($dialog,1152,'Edit')}
 if($filename -eq [IntPtr]::Zero){$filename=[BackupDialogInput]::Child($dialog,1148,'Edit')}
 if($filename -ne [IntPtr]::Zero){break};Start-Sleep -Milliseconds 100
 }
 if($filename -eq [IntPtr]::Zero){throw 'Owned native filename edit control not found'}
 Start-Sleep -Milliseconds 500
 # Native shell dialogs cache the filename separately. A keyboard edit after
 # setting the edit control commits it without typing through a user's IME.
 [void][BackupDialogInput]::SendMessageW($filename,12,[IntPtr]::Zero,$targetPath)
 [Windows.Forms.SendKeys]::SendWait('%n')
 [Windows.Forms.SendKeys]::SendWait('{END} {BACKSPACE}')
 Start-Sleep -Milliseconds 150
 $content=New-Object Text.StringBuilder 32768
 [void][BackupDialogInput]::GetText($filename,13,[IntPtr]32768,$content)
 if($content.ToString() -ne $targetPath){throw ('Native filename did not accept isolated test path; lengths='+$content.Length+'/'+$targetPath.Length)}
 $button=[BackupDialogInput]::Child($dialog,1,'Button')
 if($button -eq [IntPtr]::Zero){throw 'Owned native confirmation button not found'}
 [BackupDialogInput]::Click($button)
 Start-Sleep -Milliseconds 500
}

Write-Output 'Owned Windows file dialog completed'
