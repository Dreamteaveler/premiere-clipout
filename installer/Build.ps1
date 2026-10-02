param([string]$ExtensionRoot = (Join-Path $PSScriptRoot '..\com.texs.markerexport'), [string]$LicenseFile = (Join-Path $PSScriptRoot '..\LICENSE'))
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath($ExtensionRoot)
$licensePath = [IO.Path]::GetFullPath($LicenseFile)
$names = @('CSXS/manifest.xml','index.html','js/CSInterface.js','js/client.js','js/encoder-discovery.js','host/export-markers.jsx')
$expectedVersion='1.1.10'; $expectedBuild='B08'
$bridgeText=[IO.File]::ReadAllText((Join-Path $sourceRoot 'js/CSInterface.js'))
$uiText=[IO.File]::ReadAllText((Join-Path $sourceRoot 'index.html'))
if($uiText -match '\bB0[0-9]\b' -or $uiText -notmatch ('id="buildVersion"[^>]*>'+[regex]::Escape($expectedVersion)+'</span>')){throw 'Public UI version must show only the release version'}
$hostText=[IO.File]::ReadAllText((Join-Path $sourceRoot 'host/export-markers.jsx'))
[xml]$manifestText=[IO.File]::ReadAllText((Join-Path $sourceRoot 'CSXS/manifest.xml'))
foreach($key in @('version','hostVersion')){if([regex]::Match($bridgeText,('\b'+$key+':\s*"([^"]+)"')).Groups[1].Value -ne $expectedVersion){throw ('Bridge version inconsistent: '+$key)}}
foreach($key in @('build','hostBuild')){if([regex]::Match($bridgeText,('\b'+$key+':\s*"([^"]+)"')).Groups[1].Value -ne $expectedBuild){throw ('Bridge build inconsistent: '+$key)}}
if([regex]::Match($hostText,'MarkerExportHostVersion\s*=\s*"([^"]+)"').Groups[1].Value -ne $expectedVersion -or [regex]::Match($hostText,'MarkerExportHostBuild\s*=\s*"([^"]+)"').Groups[1].Value -ne $expectedBuild){throw 'Host version/build inconsistent'}
if($manifestText.ExtensionManifest.ExtensionBundleVersion -ne $expectedVersion -or $manifestText.ExtensionManifest.ExtensionList.Extension.Version -ne $expectedVersion){throw 'Manifest version inconsistent'}
if($bridgeText -match '1\.1\.4|1\.1\.7|ME117'){throw 'Obsolete executable bridge identity remains'}
$xml = New-Object Xml.XmlDocument
$declaration = $xml.CreateXmlDeclaration('1.0','utf-8',$null)
[void]$xml.AppendChild($declaration)
$payload = $xml.CreateElement('Payload'); $payload.SetAttribute('Version','1.1.10'); $payload.SetAttribute('CoreVersion','1.1.10'); [void]$xml.AppendChild($payload)
function Get-ByteHash([byte[]]$Bytes) { $sha=[Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() } }
foreach($name in $names) {
 $bytes=[IO.File]::ReadAllBytes((Join-Path $sourceRoot $name)); $hash=Get-ByteHash $bytes
 if($name -eq 'host/export-markers.jsx' -and ($hash -ne 'd09964ed0bed9cfd88b26c38fcd9368c66a556d1f985043ec99e956b3186f495' -or $bytes[0] -ne 239 -or $bytes[1] -ne 187 -or $bytes[2] -ne 191)){ throw 'B08 reviewed host SHA256/BOM mismatch.' }
 $file=$xml.CreateElement('File'); $file.SetAttribute('Path',$name); $file.SetAttribute('SHA256',$hash); $file.SetAttribute('Length',[string]$bytes.Length); $file.InnerText=[Convert]::ToBase64String($bytes); [void]$payload.AppendChild($file)
}
$license=$xml.CreateElement('License'); $license.InnerText=[IO.File]::ReadAllText($licensePath); [void]$payload.AppendChild($license)
$bytes=[Text.Encoding]::UTF8.GetBytes($xml.OuterXml)
$memory=New-Object IO.MemoryStream
$gzip=New-Object IO.Compression.GZipStream($memory,[IO.Compression.CompressionMode]::Compress,$true)
try {$gzip.Write($bytes,0,$bytes.Length)} finally {$gzip.Dispose()}
$compressed=$memory.ToArray(); $memory.Dispose(); $resource=Join-Path $PSScriptRoot 'payload.xml.gz'; [IO.File]::WriteAllBytes($resource,$compressed)
$digest=Get-ByteHash $compressed
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'PayloadBuild.cs'),('namespace MarkerExportSetup { internal static class PayloadBuild { internal const string Digest="'+$digest+'"; } }'),(New-Object Text.UTF8Encoding($false)))
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if(!(Test-Path -LiteralPath $compiler)){throw 'The Windows .NET Framework C# compiler was not found.'}
$output=Join-Path $PSScriptRoot 'Install-ClipOut-1.1.10.exe'
$sources=@('AssemblyInfo.cs','Contracts.cs','Core.cs','PayloadBuild.cs','WindowsPlatform.cs','Program.cs','Tests.cs') | ForEach-Object {Join-Path $PSScriptRoot $_}
$compilerArgs=@('/nologo','/codepage:65001','/target:winexe','/platform:x64','/optimize+',('/out:'+$output),'/main:MarkerExportSetup.Program',('/win32manifest:'+(Join-Path $PSScriptRoot 'app.manifest')),'/reference:System.Xml.Linq.dll','/reference:System.Core.dll','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll',('/resource:'+$resource+',Payload'))+$sources
& $compiler @compilerArgs
if($LASTEXITCODE -ne 0){throw 'C# compilation failed.'}
Copy-Item -LiteralPath $output -Destination (Join-Path $PSScriptRoot 'Uninstall-ClipOut-1.1.10.exe') -Force
Write-Output $output
