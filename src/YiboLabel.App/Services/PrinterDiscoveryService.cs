using Microsoft.Win32;
using YiboLabel.App.Models;

namespace YiboLabel.App.Services;

public sealed class PrinterDiscoveryService
{
    private const string DlabelPropertyJson = @"C:\Users\Administrator\AppData\Local\Dlabel\PrinterDefaultProperty.json";
    private const string PrinterRegistryKey = @"HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Print\Printers\HB-Q2(USB)\PrinterDriverData";

    public async Task<IReadOnlyList<PrinterEndpoint>> GetKnownPrintersAsync(PrintAgentClient printAgentClient, CancellationToken cancellationToken)
    {
        var discovered = new List<PrinterEndpoint>();
        var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var candidate in ReadCandidatesFromDlabelConfig())
        {
            if (seenPaths.Add(candidate.DevicePath))
            {
                discovered.Add(candidate);
            }
        }

        var registryPath = Registry.GetValue(PrinterRegistryKey, "DevicePath", null) as string;
        if (!string.IsNullOrWhiteSpace(registryPath) && seenPaths.Add(registryPath))
        {
            discovered.Add(new PrinterEndpoint
            {
                Id = "hb-q2-usb-registry",
                DisplayName = "HB-Q2 (USB)",
                DevicePath = registryPath,
                DriverName = "HB-Q2(USB) Driver",
                IsAvailable = false
            });
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

    private static IEnumerable<PrinterEndpoint> ReadCandidatesFromDlabelConfig()
    {
        if (!File.Exists(DlabelPropertyJson))
        {
            yield break;
        }

        using var stream = File.OpenRead(DlabelPropertyJson);
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
                ? modelProperty.GetString() ?? "Dlabel USB Printer"
                : "Dlabel USB Printer";

            yield return new PrinterEndpoint
            {
                Id = Convert.ToHexString(System.Text.Encoding.UTF8.GetBytes(devicePath)).ToLowerInvariant(),
                DisplayName = displayName,
                DevicePath = devicePath,
                DriverName = "Dlabel USB",
                IsAvailable = false
            };
        }
    }
}
