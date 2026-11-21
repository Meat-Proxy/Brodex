[CmdletBinding()]
param([ValidateSet('Connect','Uninstall')][string]$Action,[Parameter(Mandatory)][string]$InstallDir,[string]$CodexHome,[string]$CodexCommand='codex')
$ErrorActionPreference='Stop'
function Safe-Tree([string]$dir,[bool]$Recurse=$true){
 $p=[IO.Path]::GetFullPath($dir)
 $walk=$p
 while($walk){if((Test-Path -LiteralPath $walk) -and ((Get-Item -LiteralPath $walk -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw "Linked path refused: $walk"};$walk=Split-Path $walk -Parent}
 if($Recurse -and (Test-Path -LiteralPath $p)){Get-ChildItem -LiteralPath $p -Recurse -Force | ForEach-Object {if($_.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Linked child refused: $($_.FullName)"}}}
}
function Fingerprint([string]$dir){
 Safe-Tree $dir
 if(!(Test-Path -LiteralPath $dir)){return ''}
 $rows=@(Get-ChildItem -LiteralPath $dir -Recurse -File -Force | Sort-Object FullName | ForEach-Object {$_.FullName.Substring($dir.Length)+':'+(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash})
 return ($rows -join "`n")
}
$target=[IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
Safe-Tree $target
$installation=Get-Content -LiteralPath (Join-Path $target 'installation.json') -Raw | ConvertFrom-Json
if($installation.product -ne 'Brodex' -or $installation.directory -ne $target){throw 'Installation ownership mismatch'}
$ledgerPath=Join-Path $target 'components.json'
if(!$CodexHome){$CodexHome=$env:CODEX_HOME}
if(!$CodexHome){$CodexHome=Join-Path $env:USERPROFILE '.codex'}
$CodexHome=[IO.Path]::GetFullPath($CodexHome).TrimEnd('\')
Safe-Tree $CodexHome $false
if(!(Test-Path -LiteralPath $CodexHome)){New-Item -ItemType Directory -Path $CodexHome -Force | Out-Null}
$skill=Join-Path $CodexHome 'skills\brodex'
$ledger=[ordered]@{schema=1;product='Brodex';directory=$target;codex_home=$CodexHome;skill=$skill;skill_hash=$null;mcp=$null}
if(Test-Path -LiteralPath $ledgerPath){
 $saved=Get-Content -LiteralPath $ledgerPath -Raw | ConvertFrom-Json
 if($saved.schema -ne 1 -or $saved.product -ne 'Brodex' -or $saved.directory -ne $target -or $saved.codex_home -ne $CodexHome -or $saved.skill -ne $skill){throw 'Component ledger mismatch'}
 foreach($key in @('skill_hash','mcp')){$ledger[$key]=$saved.$key}
}
function Save-Ledger { $temp=$ledgerPath+'.tmp';[IO.File]::WriteAllText($temp,($ledger | ConvertTo-Json -Depth 20),(New-Object Text.UTF8Encoding($false)));Move-Item -LiteralPath $temp -Destination $ledgerPath -Force }
function MCP-List {
 $raw=& $CodexCommand mcp list --json
 if($LASTEXITCODE -ne 0){throw 'Cannot inspect MCP configuration; no blind overwrite/removal'}
 # Windows PowerShell 5.1 can emit the parsed JSON array as one pipeline object.
 $parsed=$raw | ConvertFrom-Json
 return @($parsed | Where-Object {$_.name -eq 'brodex'})
}
$oldHome=$env:CODEX_HOME
try{
 $env:CODEX_HOME=$CodexHome
 $existing=@(MCP-List)
 if($Action -eq 'Connect'){
  if($existing.Count -and !$ledger.mcp){throw 'Existing MCP brodex is not owned by this installer; preserve it and resolve explicitly'}
  if($ledger.mcp -and $existing.Count -and (($existing[0] | ConvertTo-Json -Depth 20 -Compress) -ne $ledger.mcp)){throw 'MCP configuration changed outside installer'}
  if(Test-Path -LiteralPath $skill){if(!$ledger.skill_hash -or (Fingerprint $skill) -ne $ledger.skill_hash){throw 'Existing skill is unowned or modified; preserve it and resolve explicitly'}}
  Save-Ledger
  if(!(Test-Path -LiteralPath $skill)){
   New-Item -ItemType Directory -Force -Path (Split-Path $skill -Parent) | Out-Null
   Copy-Item -LiteralPath (Join-Path $target 'skill\brodex') -Destination $skill -Recurse
   $ledger.skill_hash=Fingerprint $skill;Save-Ledger
  }elseif((Fingerprint (Join-Path $target 'skill\brodex')) -ne $ledger.skill_hash){
   # Only a verified, installer-owned tree is replaced.
   Remove-Item -LiteralPath $skill -Recurse -Force
   Copy-Item -LiteralPath (Join-Path $target 'skill\brodex') -Destination $skill -Recurse
   $ledger.skill_hash=Fingerprint $skill;Save-Ledger
  }
  if(!$existing.Count){
   & $CodexCommand mcp add brodex -- $installation.node (Join-Path $target 'bridge\server.cjs')
   if($LASTEXITCODE -ne 0){throw 'MCP add failed; installed skill is recorded'}
   $created=@(MCP-List)
   if($created.Count -ne 1){throw 'MCP registration could not be verified'}
   $ledger.mcp=$created[0] | ConvertTo-Json -Depth 20 -Compress;Save-Ledger
  }
  Write-Output 'Files, skill and MCP installed. Browser connection is NOT yet verified.'
  Write-Output ('USER STEP: Open chrome://extensions yourself, enable Developer mode, Load unpacked: '+(Join-Path $target 'extension')+'. Open Brodex Details and enable Allow in Incognito. Send the displayed extension ID to Codex.')
 }else{
  # Preflight all externally installed components before removing any of them.
  $inventory=Get-Content -LiteralPath (Join-Path $target 'files.json') -Raw | ConvertFrom-Json
  $excluded=@((Join-Path $target 'files.json'),$ledgerPath,($ledgerPath+'.tmp'))
  $actual=@(Get-ChildItem -LiteralPath $target -File -Recurse -Force | Where-Object {$_.FullName -notin $excluded})
  if($actual.Count -ne @($inventory).Count){throw 'Program files changed; removal stopped'}
  foreach($entry in $inventory){
   $file=[IO.Path]::GetFullPath((Join-Path $target $entry.path))
   if(!$file.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $file) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256){throw 'Program file identity mismatch; removal stopped'}
  }
  if((Test-Path -LiteralPath $skill) -and (!$ledger.skill_hash -or (Fingerprint $skill) -ne $ledger.skill_hash)){throw 'Skill is unowned or modified; removal stopped'}
  if($existing.Count -and (!$ledger.mcp -or ($existing[0] | ConvertTo-Json -Depth 20 -Compress) -ne $ledger.mcp)){throw 'MCP is unowned or modified; removal stopped'}
  $registry='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.brodex.bridge'
  $manifest=Join-Path $target 'bridge\com.brodex.bridge.json'
  if(Test-Path -LiteralPath $registry){if((Get-Item -LiteralPath $registry).GetValue('') -ne $manifest){throw 'Another native host owns the registration; removal stopped'}}
  if($existing.Count){& $CodexCommand mcp remove brodex;if($LASTEXITCODE -ne 0 -or @(MCP-List).Count){throw 'MCP removal failed'}}
  $ledger.mcp=$null;Save-Ledger
  if(Test-Path -LiteralPath $skill){Safe-Tree $skill;Remove-Item -LiteralPath $skill -Recurse -Force}
  $ledger.skill_hash=$null;Save-Ledger
  if(Test-Path -LiteralPath $registry){Remove-Item -LiteralPath $registry}
  Safe-Tree $target
  Remove-Item -LiteralPath $target -Recurse -Force
  Write-Output 'Program, MCP, installer-owned skill and native registration removed. Remove the extension manually in Chrome.'
  Write-Output 'Task data and previous/rollback copies are retained. No complete data purge performed. Previously replaced native registrations are not automatically restored.'
 }
}finally{$env:CODEX_HOME=$oldHome}
