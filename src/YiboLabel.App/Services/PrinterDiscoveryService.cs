using Microsoft.Win32;
using YiboLabel.App.Models;

namespace YiboLabel.App.Services;

public sealed class PrinterDiscoveryService
{
    private const string PrintersRegistryKey = @"SYSTEM\CurrentControlSet\Control\Print\Printers";

    public async Task<IReadOnlyList<PrinterEndpoint>> GetKnownPrintersAsync(PrintAgentClient printAgentClient, CancellationToken cancellationToken)
    {
        var discovered = new List<PrinterEndpoint>();
        var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var candidate in ReadCandidatesFromVendorConfig(GetVendorPrinterPropertyJsonPath()))
        {
            if (seenPaths.Add(candidate.DevicePath))
            {
                discovered.Add(candidate);
            }
        }

        foreach (var candidate in ReadCandidatesFromPrinterRegistry())
        {
            if (seenPaths.Add(candidate.DevicePath))
            {
                discovered.Add(candidate);
            }
        }

        var probes = discovered.Select(async printer =>
        {
            var probe = await printAgentClient.ProbeAsync(printer.DevicePath, cancellationToken);
            return new PrinterEndpoint
            {
                Id = printer.Id,
                DisplayName = printer.DisplayName,
                DevicePath = printer.DevicePath,
                DriverName = printer.DriverName,
                IsAvailable = probe.IsAvailable,
                StatusMessage = probe.IsAvailable ? "在线 · USB 连接正常" : $"离线 · {probe.Message}"
            };
        });

        return await Task.WhenAll(probes);
    }

    internal static string GetVendorPrinterPropertyJsonPath()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Dlabel",
            "PrinterDefaultProperty.json");
    }

    internal static IEnumerable<PrinterEndpoint> ReadCandidatesFromVendorConfig(string vendorPrinterPropertyJson)
    {
        if (!File.Exists(vendorPrinterPropertyJson))
        {
            yield break;
        }

        using var stream = File.OpenRead(vendorPrinterPropertyJson);
        using var document = System.Text.Json.JsonDocument.Parse(stream);

        foreach (var element in document.RootElement.EnumerateArray())
        {
            if (!element.TryGetProperty("devicePath", out var devicePathProperty) ||
                devicePathProperty.ValueKind != System.Text.Json.JsonValueKind.String)
            {
                continue;
            }

            var devicePath = devicePathProperty.GetString();
            if (string.IsNullOrWhiteSpace(devicePath))
            {
                continue;
            }

            var displayName = element.TryGetProperty("printModel", out var modelProperty) && modelProperty.ValueKind == System.Text.Json.JsonValueKind.String
                ? modelProperty.GetString() ?? "USB Printer"
                : "USB Printer";

            yield return new PrinterEndpoint
            {
                Id = Convert.ToHexString(System.Text.Encoding.UTF8.GetBytes(devicePath)).ToLowerInvariant(),
                DisplayName = displayName,
                DevicePath = devicePath,
                DriverName = "USB Direct",
                IsAvailable = false
            };
        }
    }

    private static IEnumerable<PrinterEndpoint> ReadCandidatesFromPrinterRegistry()
    {
        using var printersKey = Registry.LocalMachine.OpenSubKey(PrintersRegistryKey);
        if (printersKey is null)
        {
            yield break;
        }

        foreach (var printerName in printersKey.GetSubKeyNames())
        {
            using var driverDataKey = printersKey.OpenSubKey($@"{printerName}\PrinterDriverData");
            var devicePath = driverDataKey?.GetValue("DevicePath") as string;
            if (string.IsNullOrWhiteSpace(devicePath))
            {
                continue;
            }

            yield return new PrinterEndpoint
            {
                Id = Convert.ToHexString(System.Text.Encoding.UTF8.GetBytes($"registry:{printerName}:{devicePath}")).ToLowerInvariant(),
                DisplayName = printerName,
                DevicePath = devicePath,
                DriverName = "Windows printer driver",
                IsAvailable = false
            };
        }
    }
}
