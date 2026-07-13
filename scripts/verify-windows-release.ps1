$ErrorActionPreference = 'Stop'

Write-Host 'Interview Buddy Windows x64 release gate'

$nodeVersion = node --version
Write-Host "Node: $nodeVersion"
if ([version]($nodeVersion.TrimStart('v')) -lt [version]'22.12.0') {
  throw 'Node.js 22.12.0 or newer is required.'
}

npm ci
npm run build-native
npm test
npm run dist-packaged

$packageDirectory = Join-Path $PSScriptRoot '..\dist-packaged\Notepadd++-win32-x64'
npm run validate-packaged-content -- $packageDirectory

Write-Host 'Automated Windows release gate passed. Run the manual runtime matrix before shipping.'
