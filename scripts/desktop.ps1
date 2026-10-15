param(
    [ValidateSet('dev', 'build', 'check')][string]$Mode = 'dev',
    [switch]$Opaque
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$originalPath = $env:PATH
$originalCargoCache = $env:CARGO_HOME
$originalOffline = $env:CARGO_NET_OFFLINE
Push-Location $projectRoot
try {
    $localNode = Get-ChildItem -LiteralPath (Join-Path $projectRoot '.tools') -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if ($localNode) { $env:PATH = "$($localNode.FullName);$env:PATH" }
    $nodeVersion = & node -p 'process.versions.node'
    if ([version]$nodeVersion -lt [version]'22.12.0') { throw '需要 Node.js 24 LTS（最低 22.12），请先安装 Node。' }
    $cargoCache = Join-Path $projectRoot '.cache/cargo'
    if (Test-Path -LiteralPath $cargoCache) { $env:CARGO_HOME = $cargoCache }
    $env:CARGO_NET_OFFLINE = 'false'
    $npmCommand = (Get-Command npm.cmd).Source
    if ($Mode -eq 'dev') { & $npmCommand run tauri dev }
    elseif ($Mode -eq 'build') {
        if ($Opaque) { & $npmCommand run tauri build -- --config src-tauri/tauri.opaque.conf.json }
        else { & $npmCommand run tauri build }
    }
    else {
        & $npmCommand run check
        if ($LASTEXITCODE -ne 0) { throw '前端检查失败' }
        & cargo fmt --manifest-path src-tauri/Cargo.toml --check
        if ($LASTEXITCODE -ne 0) { throw 'Rust 格式检查失败' }
        & cargo test --manifest-path src-tauri/Cargo.toml --locked
    }
    if ($LASTEXITCODE -ne 0) { throw "命令失败，退出码 $LASTEXITCODE" }
}
finally {
    Pop-Location
    $env:PATH = $originalPath
    $env:CARGO_HOME = $originalCargoCache
    $env:CARGO_NET_OFFLINE = $originalOffline
}
