param(
    [string]$Runtime = "win-x64",
    [string]$Configuration = "Release",
    [string]$ArtifactsRoot = (Join-Path $PSScriptRoot "..\artifacts")
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$propsPath = Join-Path $repoRoot "Directory.Build.props"
[xml]$propsXml = Get-Content -Path $propsPath
$version = [string]$propsXml.Project.PropertyGroup.Version
if ([string]::IsNullOrWhiteSpace($version)) {
    throw "Version was not found in $propsPath"
}

$releaseRoot = Join-Path $ArtifactsRoot "YiboLabel-$version"
$publishDir = Join-Path $releaseRoot "publish"
$installerProjectDir = Join-Path $releaseRoot "self-extract-installer"
$payloadPath = Join-Path $installerProjectDir "payload.zip"
$setupExe = Join-Path $releaseRoot "YiboLabel-$version-Setup.exe"

if (Test-Path $releaseRoot) {
    throw "Release directory already exists: $releaseRoot"
}

New-Item -ItemType Directory -Path $publishDir, $installerProjectDir | Out-Null

dotnet publish (Join-Path $repoRoot "src\YiboLabel.App\YiboLabel.App.csproj") `
    -c $Configuration `
    -r $Runtime `
    --self-contained true `
    -o $publishDir

dotnet publish (Join-Path $repoRoot "src\YiboLabel.PrintAgent\YiboLabel.PrintAgent.csproj") `
    -c $Configuration `
    -r win-x86 `
    --self-contained true `
    -o $publishDir

dotnet publish (Join-Path $repoRoot "src\YiboLabel.Desktop\YiboLabel.Desktop.csproj") `
    -c $Configuration `
    -r $Runtime `
    --self-contained true `
    -o $publishDir

Compress-Archive -Path (Join-Path $publishDir "*") -DestinationPath $payloadPath -CompressionLevel Optimal

$installerProject = @"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net10.0-windows</TargetFramework>
    <UseWindowsForms>true</UseWindowsForms>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <AssemblyName>YiboLabel-$version-Setup</AssemblyName>
    <Version>$version</Version>
    <ApplicationIcon>$repoRoot\assets\branding\YiboLabel.ico</ApplicationIcon>
  </PropertyGroup>
  <ItemGroup>
    <EmbeddedResource Include="payload.zip" LogicalName="payload.zip" />
  </ItemGroup>
</Project>
"@

$installerCode = @"
using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

const string Version = "$version";
const string AppName = "YiboLabel";
const string Publisher = "YiboLabel";
const string UninstallKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\YiboLabel";

try
{
    var installRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppName);
    var installDir = Path.Combine(installRoot, Version);
    Directory.CreateDirectory(installDir);

    var tempZip = Path.Combine(Path.GetTempPath(), `$"YiboLabel-{Version}-{Guid.NewGuid():N}.zip");
    await using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip") ?? throw new InvalidOperationException("Installer payload was not found."))
    await using (var file = File.Create(tempZip))
    {
        await resource.CopyToAsync(file);
    }

    ZipFile.ExtractToDirectory(tempZip, installDir, overwriteFiles: true);
    File.Delete(tempZip);

    var exePath = Path.Combine(installDir, "YiboLabel.Desktop.exe");
    if (!File.Exists(exePath))
    {
        throw new FileNotFoundException("YiboLabel.Desktop.exe was not installed.", exePath);
    }

    WriteUninstaller(installRoot, installDir);

    var desktopShortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "YiboLabel.lnk");
    var startMenuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName);
    Directory.CreateDirectory(startMenuDir);
    CreateShortcut(desktopShortcut, exePath, installDir, "YiboLabel label printing tool");
    CreateShortcut(Path.Combine(startMenuDir, "YiboLabel.lnk"), exePath, installDir, "YiboLabel label printing tool");
    CreateShortcut(Path.Combine(startMenuDir, "Uninstall YiboLabel.lnk"), Path.Combine(installRoot, "Uninstall.cmd"), installRoot, "Uninstall YiboLabel");

    RegisterUninstallEntry(installRoot, installDir, exePath);

    MessageBox.Show(`$"YiboLabel {Version} has been installed.\n\nInstall location: {installDir}\nDesktop, Start menu, and uninstall entries were created.", "YiboLabel installed", MessageBoxButtons.OK, MessageBoxIcon.Information);
}
catch (Exception ex)
{
    MessageBox.Show(ex.Message, "YiboLabel setup failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
    Environment.ExitCode = 1;
}

static void WriteUninstaller(string installRoot, string installDir)
{
    var uninstallCmd = Path.Combine(installRoot, "Uninstall.cmd");
    var uninstallPs1 = Path.Combine(installRoot, "Uninstall.ps1");
    var escapedRoot = EscapePowerShellSingleQuotedString(installRoot);
    var escapedStartMenu = EscapePowerShellSingleQuotedString(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName));
    var escapedDesktopShortcut = EscapePowerShellSingleQuotedString(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "YiboLabel.lnk"));

    var scriptLines = new[]
    {
        "`$ErrorActionPreference = 'Stop'",
        "`$installRoot = '" + escapedRoot + "'",
        "`$startMenuDir = '" + escapedStartMenu + "'",
        "`$desktopShortcut = '" + escapedDesktopShortcut + "'",
        "`$uninstallKey = 'HKCU:\\" + UninstallKeyPath + "'",
        "",
        "Get-Process -Name 'YiboLabel.Desktop', 'YiboLabel.App', 'YiboLabel.PrintAgent' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
        "",
        "if (Test-Path -LiteralPath `$desktopShortcut) {",
        "    Remove-Item -LiteralPath `$desktopShortcut -Force -ErrorAction SilentlyContinue",
        "}",
        "",
        "if (Test-Path -LiteralPath `$startMenuDir) {",
        "    Remove-Item -LiteralPath `$startMenuDir -Recurse -Force -ErrorAction SilentlyContinue",
        "}",
        "",
        "if (Test-Path -LiteralPath `$uninstallKey) {",
        "    Remove-Item -LiteralPath `$uninstallKey -Recurse -Force -ErrorAction SilentlyContinue",
        "}",
        "",
        "`$cleanupCommand = '/c timeout /t 1 /nobreak > nul & rmdir /s /q ' + [char]34 + `$installRoot + [char]34",
        "Start-Process -FilePath 'cmd.exe' -WindowStyle Hidden -ArgumentList `$cleanupCommand"
    };
    var script = string.Join(Environment.NewLine, scriptLines) + Environment.NewLine;

    File.WriteAllText(uninstallPs1, script, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    File.WriteAllText(
        uninstallCmd,
        "@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0Uninstall.ps1\"\r\n",
        Encoding.ASCII);
}

static void RegisterUninstallEntry(string installRoot, string installDir, string exePath)
{
    using var key = Registry.CurrentUser.CreateSubKey(UninstallKeyPath, writable: true) ?? throw new InvalidOperationException("Failed to create uninstall registry key.");
    var uninstallCmd = Path.Combine(installRoot, "Uninstall.cmd");
    key.SetValue("DisplayName", AppName);
    key.SetValue("DisplayVersion", Version);
    key.SetValue("Publisher", Publisher);
    key.SetValue("InstallLocation", installRoot);
    key.SetValue("DisplayIcon", exePath);
    key.SetValue("UninstallString", Quote(uninstallCmd));
    key.SetValue("QuietUninstallString", `$"powershell.exe -NoProfile -ExecutionPolicy Bypass -File {Quote(Path.Combine(installRoot, "Uninstall.ps1"))}");
    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
    key.SetValue("EstimatedSize", GetDirectorySizeInKb(installDir), RegistryValueKind.DWord);
}

static int GetDirectorySizeInKb(string directory)
{
    var bytes = Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories).Sum(file => new FileInfo(file).Length);
    return (int)Math.Max(1, bytes / 1024);
}

static string Quote(string value) => `$"\"{value}\"";

static string EscapePowerShellSingleQuotedString(string value) => value.Replace("'", "''");

static void CreateShortcut(string shortcutPath, string targetPath, string workingDirectory, string description)
{
    var shellType = Type.GetTypeFromProgID("WScript.Shell") ?? throw new InvalidOperationException("WScript.Shell is unavailable.");
    dynamic shell = Activator.CreateInstance(shellType) ?? throw new InvalidOperationException("Failed to create WScript.Shell.");
    dynamic shortcut = shell.CreateShortcut(shortcutPath);
    shortcut.TargetPath = targetPath;
    shortcut.WorkingDirectory = workingDirectory;
    shortcut.Description = description;
    shortcut.IconLocation = targetPath;
    shortcut.Save();

    if (shortcut is not null && Marshal.IsComObject(shortcut))
    {
        Marshal.FinalReleaseComObject(shortcut);
    }

    if (shell is not null && Marshal.IsComObject(shell))
    {
        Marshal.FinalReleaseComObject(shell);
    }
}
"@

Set-Content -Path (Join-Path $installerProjectDir "YiboLabel.Setup.csproj") -Value $installerProject -Encoding UTF8
Set-Content -Path (Join-Path $installerProjectDir "Program.cs") -Value $installerCode -Encoding UTF8

dotnet publish (Join-Path $installerProjectDir "YiboLabel.Setup.csproj") `
    -c $Configuration `
    -r $Runtime `
    --self-contained true `
    -p:PublishSingleFile=true `
    -o (Join-Path $releaseRoot "self-extract-publish")

Copy-Item -LiteralPath (Join-Path $releaseRoot "self-extract-publish\YiboLabel-$version-Setup.exe") -Destination $setupExe

Write-Output "Installer created: $setupExe"
