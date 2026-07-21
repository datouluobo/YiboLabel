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
    var defaultInstallRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppName);
    string? installRoot = null;
    Exception? dialogError = null;
    var dialogThread = new Thread(() =>
    {
        try
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            installRoot = ShowInstallPathDialog(defaultInstallRoot);
        }
        catch (Exception ex)
        {
            dialogError = ex;
        }
    });
    dialogThread.SetApartmentState(ApartmentState.STA);
    dialogThread.Start();
    dialogThread.Join();

    if (dialogError is not null)
    {
        throw dialogError;
    }

    if (installRoot is null)
    {
        return;
    }

    installRoot = Path.GetFullPath(Environment.ExpandEnvironmentVariables(installRoot.Trim()));
    if (string.IsNullOrWhiteSpace(installRoot))
    {
        throw new InvalidOperationException("Install location cannot be empty.");
    }

    var installDir = Path.Combine(installRoot, "app");
    Directory.CreateDirectory(installRoot);
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
    CreateShortcut(desktopShortcut, exePath, installDir, "YiboLabel label printing tool", exePath);
    CreateShortcut(Path.Combine(startMenuDir, "YiboLabel.lnk"), exePath, installDir, "YiboLabel label printing tool", exePath);
    CreateShortcut(Path.Combine(startMenuDir, "Uninstall YiboLabel.lnk"), Path.Combine(installRoot, "Uninstall.cmd"), installRoot, "Uninstall YiboLabel", exePath);

    RegisterUninstallEntry(installRoot, installDir, exePath);

    MessageBox.Show("YiboLabel " + Version + " has been installed.\n\nInstall location: " + installRoot + "\nDesktop, Start menu, and uninstall entries were created.", "YiboLabel installed", MessageBoxButtons.OK, MessageBoxIcon.Information);
}
catch (Exception ex)
{
    MessageBox.Show(ex.Message, "YiboLabel setup failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
    Environment.ExitCode = 1;
}

static string? ShowInstallPathDialog(string defaultInstallRoot)
{
    using var form = new Form
    {
        Text = "YiboLabel Setup",
        StartPosition = FormStartPosition.CenterScreen,
        FormBorderStyle = FormBorderStyle.FixedDialog,
        MaximizeBox = false,
        MinimizeBox = false,
        ClientSize = new System.Drawing.Size(520, 236),
    };

    using var icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    if (icon is not null)
    {
        form.Icon = icon;
    }

    var title = new Label
    {
        AutoSize = true,
        Font = new System.Drawing.Font(form.Font, System.Drawing.FontStyle.Bold),
        Text = "Install YiboLabel " + Version,
        Location = new System.Drawing.Point(18, 18),
    };

    var summary = new Label
    {
        AutoSize = false,
        Text = "Choose where YiboLabel should be installed. Setup will create Start menu shortcuts and a Windows uninstall entry.",
        Location = new System.Drawing.Point(18, 48),
        Size = new System.Drawing.Size(480, 40),
    };

    var pathLabel = new Label
    {
        AutoSize = true,
        Text = "Install location",
        Location = new System.Drawing.Point(18, 100),
    };

    var pathBox = new TextBox
    {
        Text = defaultInstallRoot,
        Location = new System.Drawing.Point(18, 122),
        Size = new System.Drawing.Size(382, 26),
        Anchor = AnchorStyles.Left | AnchorStyles.Top | AnchorStyles.Right,
    };

    var browseButton = new Button
    {
        Text = "Browse...",
        Location = new System.Drawing.Point(410, 121),
        Size = new System.Drawing.Size(88, 28),
        Anchor = AnchorStyles.Top | AnchorStyles.Right,
    };

    browseButton.Click += (_, _) =>
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "Choose YiboLabel install location",
            SelectedPath = Directory.Exists(pathBox.Text) ? pathBox.Text : defaultInstallRoot,
            UseDescriptionForTitle = true,
        };

        if (dialog.ShowDialog(form) == DialogResult.OK)
        {
            pathBox.Text = dialog.SelectedPath;
        }
    };

    var cancelButton = new Button
    {
        Text = "Cancel",
        DialogResult = DialogResult.Cancel,
        Location = new System.Drawing.Point(316, 184),
        Size = new System.Drawing.Size(86, 30),
        Anchor = AnchorStyles.Right | AnchorStyles.Bottom,
    };

    var installButton = new Button
    {
        Text = "Install",
        DialogResult = DialogResult.OK,
        Location = new System.Drawing.Point(412, 184),
        Size = new System.Drawing.Size(86, 30),
        Anchor = AnchorStyles.Right | AnchorStyles.Bottom,
    };

    form.Controls.AddRange(new Control[] { title, summary, pathLabel, pathBox, browseButton, cancelButton, installButton });
    form.AcceptButton = installButton;
    form.CancelButton = cancelButton;

    return form.ShowDialog() == DialogResult.OK ? pathBox.Text : null;
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

static void CreateShortcut(string shortcutPath, string targetPath, string workingDirectory, string description, string iconPath)
{
    var shellType = Type.GetTypeFromProgID("WScript.Shell") ?? throw new InvalidOperationException("WScript.Shell is unavailable.");
    dynamic shell = Activator.CreateInstance(shellType) ?? throw new InvalidOperationException("Failed to create WScript.Shell.");
    dynamic shortcut = shell.CreateShortcut(shortcutPath);
    shortcut.TargetPath = targetPath;
    shortcut.WorkingDirectory = workingDirectory;
    shortcut.Description = description;
    shortcut.IconLocation = iconPath + ",0";
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
