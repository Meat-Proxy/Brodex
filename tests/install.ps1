$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$sandbox=Join-Path (Split-Path $repo -Parent) ('install-test-'+[guid]::NewGuid().ToString('N'))
$localData=Join-Path $sandbox 'Test User\AppData\Local'
$root=Join-Path $localData 'Brodex'
$app=Join-Path $root 'App'
$homeDir=Join-Path $root 'codex'
New-Item -ItemType Directory -Force -Path $homeDir | Out-Null
# Reproduce AppData traversal without touching the user's real AppData.
[IO.File]::SetAttributes($root,([IO.File]::GetAttributes($root) -bor [IO.FileAttributes]::Hidden))
$PSDefaultParameterValues=@{}
$setup=Join-Path $repo 'scripts\setup.ps1'
$cli=(Get-Command codex).Source
# A second MCP entry exercises JSON array -> single filtered PSCustomObject in PS 5.1.
$savedHome=$env:CODEX_HOME
try{
 $env:CODEX_HOME=$homeDir
 & $cli mcp add unrelated-test -- node unrelated-test.cjs
 if($LASTEXITCODE -ne 0){throw 'Cannot create isolated unrelated MCP fixture'}
}finally{$env:CODEX_HOME=$savedHome}
# Never touch real native registration. This test has not registered an extension.
function Test-Path {param([string]$LiteralPath,[string]$Path,[string]$PathType='Any')
 $p=$LiteralPath;if(!$p){$p=$Path}
 if($p -like 'HKCU:*'){return $false}
 Microsoft.PowerShell.Management\Test-Path -LiteralPath $p -PathType $PathType
}
$savedLocal=$env:LOCALAPPDATA
try{
 $env:LOCALAPPDATA=$localData
 # Exercise the default install path for another user's environment, including spaces.
 & $setup -Action Install -CodexHome $homeDir -CodexCommand $cli
}finally{$env:LOCALAPPDATA=$savedLocal}
if(!(Test-Path -LiteralPath (Join-Path $homeDir 'skills\brodex\SKILL.md'))){throw 'Missing skill'}
$owned=Get-Content -LiteralPath (Join-Path $app 'components.json') -Raw | ConvertFrom-Json
if(!$owned.mcp -or ($owned.mcp | ConvertFrom-Json).name -ne 'brodex'){throw 'Single MCP result was not recorded'}
& $setup -Action Install -InstallDir $app -CodexHome $homeDir -CodexCommand $cli
$before=Get-Content -LiteralPath (Join-Path $app 'components.json') -Raw
& $setup -Action Stage -InstallDir $app
& $setup -Action Connect -InstallDir $app -CodexHome $homeDir -CodexCommand $cli
& $setup -Action Rollback -InstallDir $app
& $setup -Action Connect -InstallDir $app -CodexHome $homeDir -CodexCommand $cli
if((Get-Content -LiteralPath (Join-Path $app 'components.json') -Raw) -ne $before){throw 'Update lost component ownership'}
$skillFile=Join-Path $homeDir 'skills\brodex\SKILL.md'
$original=[IO.File]::ReadAllText($skillFile)
[IO.File]::AppendAllText($skillFile,"`nUser change")
$refused=$false
try{& $setup -Action Uninstall -InstallDir $app -CodexHome $homeDir -CodexCommand $cli}catch{$refused=$true}
if(!$refused -or !(Test-Path -LiteralPath $app)){throw 'Modified skill was not protected'}
[IO.File]::WriteAllText($skillFile,$original,(New-Object Text.UTF8Encoding($false)))
& $setup -Action Uninstall -InstallDir $app -CodexHome $homeDir -CodexCommand $cli
if((Test-Path -LiteralPath $app) -or (Test-Path -LiteralPath (Split-Path $skillFile -Parent))){throw 'Owned components remain'}
try{
 $env:CODEX_HOME=$homeDir
 $parsed=(& $cli mcp list --json) | ConvertFrom-Json
 $remaining=@($parsed | Where-Object name -eq 'unrelated-test')
 if($LASTEXITCODE -ne 0 -or $remaining.Count -ne 1){throw 'Unrelated MCP configuration was changed'}
}finally{$env:CODEX_HOME=$savedHome}
& $setup -Action Stage -InstallDir $app
New-Item -ItemType Directory -Force -Path (Split-Path $skillFile -Parent) | Out-Null
[IO.File]::WriteAllText($skillFile,'Existing user skill')
$refused=$false
try{& $setup -Action Connect -InstallDir $app -CodexHome $homeDir -CodexCommand $cli}catch{$refused=$true}
if(!$refused -or [IO.File]::ReadAllText($skillFile) -ne 'Existing user skill'){throw 'Foreign skill was not protected'}
Write-Output 'PASS: isolated real Codex install, idempotent connect, update/rollback ownership, modified and foreign skill refusal, uninstall. Native registry mocked absent; no browser integration tested.'
