[CmdletBinding()]
param(
 [ValidateSet('Stage','Register','Rollback','Install','Connect','Uninstall')][string]$Action='Stage',
 [string]$InstallDir=(Join-Path $env:LOCALAPPDATA 'Brodex\App'),
 [string]$ExtensionId,
 [string]$NodePath,
 [switch]$ReplaceRegistration,
 [string]$CodexHome,
 [string]$CodexCommand='codex'
)
$ErrorActionPreference='Stop'
$sourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$target=[IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
if($target.Length -lt 12 -or $target -eq $sourceRoot -or $target.StartsWith($sourceRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Choose a separate installation directory.'}
$parent=Split-Path $target -Parent
$leaf=Split-Path $target -Leaf
$previous=Join-Path $parent ($leaf+'.previous')
$registry='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.brodex.bridge'
function Assert-Owned([string]$dir){
 if((Get-Item -LiteralPath $dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Installation cannot be a link or junction.'}
 $state=Get-Content -LiteralPath (Join-Path $dir 'installation.json') -Raw | ConvertFrom-Json
 if($state.product -ne 'Brodex' -or $state.directory -ne $target){throw 'Unrecognized installation; no files were replaced.'}
}
function Write-Utf8([string]$file,[string]$body){[IO.File]::WriteAllText($file,$body,(New-Object Text.UTF8Encoding($false)))}
function Save-Inventory([string]$dir){
 $excluded=@((Join-Path $dir 'files.json'),(Join-Path $dir 'components.json'),(Join-Path $dir 'components.json.tmp'))
 $items=@(Get-ChildItem -LiteralPath $dir -File -Recurse -Force | Where-Object {$_.FullName -notin $excluded} | ForEach-Object {@{path=$_.FullName.Substring($dir.Length+1);sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}})
 Write-Utf8 (Join-Path $dir 'files.json') (ConvertTo-Json -InputObject $items -Depth 4)
}
if($Action -eq 'Install'){
 if(!(Test-Path -LiteralPath $target)){
  & $PSCommandPath -Action Stage -InstallDir $target -NodePath $NodePath
 }
 Assert-Owned $target
 & $PSCommandPath -Action Connect -InstallDir $target -CodexHome $CodexHome -CodexCommand $CodexCommand
 exit
}
if($Action -in @('Connect','Uninstall')){
 Assert-Owned $target
 & (Join-Path $PSScriptRoot 'components.ps1') -Action $Action -InstallDir $target -CodexHome $CodexHome -CodexCommand $CodexCommand
 exit
}
if($Action -eq 'Stage'){
 if(!$NodePath){$NodePath=(Get-Command node -ErrorAction Stop).Source}
 $NodePath=(Resolve-Path -LiteralPath $NodePath).Path
 $nodeMajor=& $NodePath -p 'parseInt(process.versions.node)'
 if($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 20){throw 'Node.js 20 or later is required.'}
 if(Test-Path -LiteralPath $target){Assert-Owned $target}
 if(Test-Path -LiteralPath $previous){throw 'Previous rollback copy exists. Archive it before another update.'}
 $compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
 if(!(Test-Path -LiteralPath $compiler)){$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'}
 if(!(Test-Path -LiteralPath $compiler)){throw '.NET Framework C# compiler was not found.'}
 New-Item -ItemType Directory -Force -Path $parent | Out-Null
 $stage=Join-Path $parent ($leaf+'.stage-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory -Path $stage | Out-Null
 foreach($dir in @('extension','bridge','skill','scripts')){Copy-Item -LiteralPath (Join-Path $sourceRoot $dir) -Destination (Join-Path $stage $dir) -Recurse}
 foreach($file in @('LICENSE','README.md')){Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination $stage}
 # Release inputs must not carry credentials from a developer machine.
 foreach($name in @('bridge-config.json','allowed-origin.txt','node-path.txt','com.brodex.bridge.json')){if(Test-Path -LiteralPath (Join-Path $stage ('bridge\'+$name))){throw 'Release contains local bridge configuration.'}}
 & $compiler /nologo /target:exe /optimize+ ('/out:'+(Join-Path $stage 'bridge\BrodexNative.exe')) (Join-Path $stage 'bridge\Launcher.cs')
 if($LASTEXITCODE -ne 0){throw 'Native launcher compilation failed; installation not changed.'}
 if(Test-Path -LiteralPath $target){
  foreach($name in @('bridge-config.json','allowed-origin.txt','node-path.txt','com.brodex.bridge.json')){
   $existing=Join-Path $target ('bridge\'+$name)
   if(Test-Path -LiteralPath $existing){Copy-Item -LiteralPath $existing -Destination (Join-Path $stage ('bridge\'+$name))}
  }
  $oldRegistration=Join-Path $target 'registration-before.json'
  if(Test-Path -LiteralPath $oldRegistration){Copy-Item -LiteralPath $oldRegistration -Destination $stage}
  $ledger=Join-Path $target 'components.json'
  if(Test-Path -LiteralPath $ledger){Copy-Item -LiteralPath $ledger -Destination $stage}
 }
 Write-Utf8 (Join-Path $stage 'installation.json') (@{product='Brodex';directory=$target;version=(Get-Content -LiteralPath (Join-Path $stage 'extension\VERSION.txt') -Raw).Trim();node=$NodePath;staged_at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json)
 Save-Inventory $stage
 $moved=$false
 try{
  if(Test-Path -LiteralPath $target){Move-Item -LiteralPath $target -Destination $previous;$moved=$true}
  Move-Item -LiteralPath $stage -Destination $target
 }catch{if($moved -and !(Test-Path -LiteralPath $target)){Move-Item -LiteralPath $previous -Destination $target};throw}
 Write-Output "Staged: $target"
 Write-Output "Load unpacked in Chrome: $(Join-Path $target 'extension')"
 Write-Output 'Then run this script with -Action Register -ExtensionId <Chrome ID> and the same -InstallDir.'
 exit
}
Assert-Owned $target
if($Action -eq 'Rollback'){
 if(!(Test-Path -LiteralPath $previous)){throw 'No previous installation.'}
 Assert-Owned $previous
 # External skill/MCP still belong to the current installation until Connect reconciles them.
 $currentLedger=Join-Path $target 'components.json'
 if(Test-Path -LiteralPath $currentLedger){Copy-Item -LiteralPath $currentLedger -Destination (Join-Path $previous 'components.json') -Force}
 $retained=Join-Path $parent ($leaf+'.replaced-'+[guid]::NewGuid().ToString('N'))
 Move-Item -LiteralPath $target -Destination $retained
 try{Move-Item -LiteralPath $previous -Destination $target}catch{Move-Item -LiteralPath $retained -Destination $target;throw}
 Write-Output "Restored previous code. Current code retained at $retained. Reload extension and restart MCP."
 exit
}
if($ExtensionId -notmatch '^[a-p]{32}$'){throw 'Provide the extension ID shown by Chrome.'}
$state=Get-Content -LiteralPath (Join-Path $target 'installation.json') -Raw | ConvertFrom-Json
$bridge=Join-Path $target 'bridge'
$manifest=Join-Path $bridge 'com.brodex.bridge.json'
$old=$null
if(Test-Path -LiteralPath $registry){$old=(Get-Item -LiteralPath $registry).GetValue('')}
if($old -and $old -ne $manifest -and !$ReplaceRegistration){throw 'Another Brodex native host is registered. Use -ReplaceRegistration only for an intentional switch; the previous value will be saved.'}
$origin=Join-Path $bridge 'allowed-origin.txt'
if(Test-Path -LiteralPath $origin){
 if((Get-Content -LiteralPath $origin -Raw).Trim() -ne "chrome-extension://$ExtensionId/"){throw 'Extension ID differs from the saved binding. Existing configuration was preserved.'}
 if(!(Test-Path -LiteralPath $manifest)){throw 'Incomplete existing configuration.'}
}else{
 & $state.node (Join-Path $target 'scripts\configure-bridge.cjs') $ExtensionId
 if($LASTEXITCODE -ne 0){throw 'Bridge configuration failed.'}
}
$backup=Join-Path $target 'registration-before.json'
if(!(Test-Path -LiteralPath $backup)){Write-Utf8 $backup (@{previous=$old;current=$manifest} | ConvertTo-Json)}
New-Item -Path $registry -Force | Out-Null
Set-Item -LiteralPath $registry -Value $manifest
if((Get-Item -LiteralPath $registry).GetValue('') -ne $manifest){throw 'Native host registration verification failed.'}
Save-Inventory $target
Write-Output 'Native host registered. Reload the extension.'
Write-Output 'Add MCP through Codex settings, or execute:'
Write-Output ('codex mcp add brodex -- "'+$state.node+'" "'+(Join-Path $bridge 'server.cjs')+'"')
Write-Output ('Install skill from: '+(Join-Path $target 'skill\brodex'))
