param(
    [string]$PropsPath = (Join-Path $PSScriptRoot "..\Directory.Build.props"),
    [string]$PackageJsonPath = (Join-Path $PSScriptRoot "..\src\YiboLabel.App\ClientApp\package.json"),
    [string]$PackageLockPath = (Join-Path $PSScriptRoot "..\src\YiboLabel.App\ClientApp\package-lock.json")
)

$ErrorActionPreference = "Stop"

function Get-NextVersion([string]$versionText) {
    $parts = $versionText.Split(".")
    if ($parts.Length -ne 3) {
        throw "Unsupported version format: $versionText"
    }

    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2] + 1
    return "$major.$minor.$patch"
}

[xml]$propsXml = Get-Content -Path $PropsPath
$propertyGroup = $propsXml.Project.PropertyGroup
if (-not $propertyGroup) {
    throw "PropertyGroup was not found in $PropsPath"
}

$currentVersion = [string]$propertyGroup.Version
$nextVersion = Get-NextVersion $currentVersion
$propertyGroup.Version = $nextVersion
$propertyGroup.AssemblyInformationalVersion = $nextVersion
$propsXml.Save((Resolve-Path $PropsPath))

$nodeScript = @"
const fs = require('fs');
const [packageJsonPath, packageLockPath, version] = process.argv.slice(1);

const updateJson = (filePath, mutate) => {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  mutate(json);
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n', 'utf8');
};

updateJson(packageJsonPath, (json) => {
  json.version = version;
});

updateJson(packageLockPath, (json) => {
  json.version = version;
  if (json.packages && json.packages['']) {
    json.packages[''].version = version;
  }
});
"@

node -e $nodeScript $PackageJsonPath $PackageLockPath $nextVersion

Write-Output "Bumped version: $currentVersion -> $nextVersion"
