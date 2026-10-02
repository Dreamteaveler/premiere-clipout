param([string]$ExtensionRoot = (Join-Path $PSScriptRoot '..\com.texs.markerexport'), [string]$LicenseFile = (Join-Path $PSScriptRoot '..\LICENSE'))
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath($ExtensionRoot)
$licensePath = [IO.Path]::GetFullPath($LicenseFile)
$names = @('CSXS/manifest.xml','index.html','js/CSInterface.js','js/client.js','host/export-markers.jsx')
$xml = New-Object Xml.XmlDocument
$declaration = $xml.CreateXmlDeclaration('1.0','utf-8',$null)
[void]$xml.AppendChild($declaration)
$payload = $xml.CreateElement('Payload'); $payload.SetAttribute('Version','1.1.9'); $payload.SetAttribute('CoreVersion','1.1.4'); [void]$xml.AppendChild($payload)
function Get-ByteHash([byte[]]$Bytes) { $sha=[Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() } }
foreach($name in $names) {
 $bytes=[IO.File]::ReadAllBytes((Join-Path $sourceRoot $name)); $hash=Get-ByteHash $bytes
 if($name -eq 'host/export-markers.jsx' -and ($hash -ne 'ddef6220e75502eeb3953221cfa476975392b45656fcd9f5f5410e46d5e45cd7' -or $bytes[0] -ne 239 -or $bytes[1] -ne 187 -or $bytes[2] -ne 191)){ throw 'Frozen core SHA256/BOM mismatch.' }
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
$output=Join-Path $PSScriptRoot 'Install-Premiere-ClipOut-1.1.9.exe'
$sources=@('AssemblyInfo.cs','Contracts.cs','Core.cs','PayloadBuild.cs','WindowsPlatform.cs','Program.cs','Tests.cs') | ForEach-Object {Join-Path $PSScriptRoot $_}
$compilerArgs=@('/nologo','/codepage:65001','/target:winexe','/platform:x64','/optimize+',('/out:'+$output),'/main:MarkerExportSetup.Program',('/win32manifest:'+(Join-Path $PSScriptRoot 'app.manifest')),'/reference:System.Xml.Linq.dll','/reference:System.Core.dll','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll',('/resource:'+$resource+',Payload'))+$sources
& $compiler @compilerArgs
if($LASTEXITCODE -ne 0){throw 'C# compilation failed.'}
Copy-Item -LiteralPath $output -Destination (Join-Path $PSScriptRoot 'Uninstall-Premiere-ClipOut-1.1.9.exe') -Force
Write-Output $output
