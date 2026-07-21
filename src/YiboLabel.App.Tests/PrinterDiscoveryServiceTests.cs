using YiboLabel.App.Services;
using Xunit;

namespace YiboLabel.App.Tests;

public sealed class PrinterDiscoveryServiceTests : IDisposable
{
    private readonly string rootDirectory = Path.Combine(Path.GetTempPath(), "YiboLabel.PrinterDiscovery.Tests", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(rootDirectory))
        {
            Directory.Delete(rootDirectory, true);
        }
    }

    [Fact]
    public async Task ReadCandidatesFromVendorConfig_UsesProvidedCurrentUserConfigPath()
    {
        Directory.CreateDirectory(rootDirectory);
        var configPath = Path.Combine(rootDirectory, "PrinterDefaultProperty.json");
        await File.WriteAllTextAsync(configPath, """
        [
          {
            "printModel": "HB-Q2",
            "devicePath": "\\\\?\\usb#vid_28e9&pid_0285#00000000011a#{a5dcbf10-6530-11d2-901f-00c04fb951ed}"
          }
        ]
        """);

        var printers = PrinterDiscoveryService.ReadCandidatesFromVendorConfig(configPath).ToList();

        Assert.Single(printers);
        Assert.Equal("HB-Q2", printers[0].DisplayName);
        Assert.Equal(
            @"\\?\usb#vid_28e9&pid_0285#00000000011a#{a5dcbf10-6530-11d2-901f-00c04fb951ed}",
            printers[0].DevicePath);
    }

    [Fact]
    public void CreateVendorUsbTarget_RecordsDevicePathDiagnosticStep()
    {
        var target = PrintDiagnosticsService.CreateVendorUsbTarget(
            "HB-Q2",
            @"\\?\usb#vid_28e9&pid_0285#00000000011a#{a5dcbf10-6530-11d2-901f-00c04fb951ed}",
            "test");

        Assert.Equal("vendor-usb", target.ChannelKind);
        Assert.Equal("test", target.Source);
        Assert.Single(target.Steps);
        Assert.Equal("device-path", target.Steps[0].Stage);
        Assert.Equal("passed", target.Steps[0].Status);
    }
}
