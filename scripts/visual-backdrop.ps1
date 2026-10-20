param([Parameter(Mandatory=$true)][string]$Control)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'visual-backdrop.cs') -ReferencedAssemblies System.Windows.Forms,System.Drawing
[StarryVisualBackdrop]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$form = New-Object StarryVisualBackdrop
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 80
$script:lastId = ''
$timer.Add_Tick({
    if (!(Test-Path -LiteralPath $Control)) { return }
    try {
        $request = Get-Content -LiteralPath $Control -Raw | ConvertFrom-Json
        if ($request.id -eq $script:lastId) { return }
        $script:lastId = $request.id
        if ($request.action -eq 'close') { $form.Close(); return }
        if ($request.action -eq 'scene') { $form.Scene = $request.scene; $form.Invalidate(); $form.Update() }
        if ($request.action -eq 'front') { $form.BringToFront(); $form.Activate() }
        if ($request.action -eq 'capture') { $form.CaptureRegion([string]$request.path, [uint32]$request.appProcess, [IntPtr]([long]$request.appWindow), [int]$request.blurMargin) }
        if ($request.action -eq 'drag') { $form.DragRegion([uint32]$request.appProcess, [IntPtr]([long]$request.appWindow), [int]$request.fromX, [int]$request.fromY, [int]$request.toX, [int]$request.toY) }
        $extra = if ($request.action -eq 'backdrop-type') { $form.BackdropType([IntPtr]([long]$request.appWindow)) } else { $null }
        @{ id=$request.id; ok=$true; backdropType=$extra } | ConvertTo-Json -Compress | Set-Content -LiteralPath "$Control.$($request.id).reply" -Encoding utf8
    } catch {
        @{ id=$script:lastId; ok=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress | Set-Content -LiteralPath "$Control.$($script:lastId).reply" -Encoding utf8
    }
})
$form.Add_Shown({
    @{ ready=$true; bounds=@{x=$form.Left;y=$form.Top;width=$form.Width;height=$form.Height} } | ConvertTo-Json -Compress | Set-Content -LiteralPath "$Control.ready" -Encoding utf8
    $timer.Start()
})
try { [System.Windows.Forms.Application]::Run($form) }
finally { $timer.Stop(); $timer.Dispose(); $form.Dispose() }
