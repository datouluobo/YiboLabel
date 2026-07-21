using System.Drawing.Printing;
using Microsoft.Win32;
using YiboLabel.App.Models;

namespace YiboLabel.App.Services;

public sealed class PrintDiagnosticsService
{
    private const string PrintersRegistryKey = @"SYSTEM\CurrentControlSet\Control\Print\Printers";
    private const string VendorDllDirectory = @"C:\Program Files (x86)\Dlabel";

    public async Task<PrintDiagnosticReport> InspectAsync(PrintAgentClient printAgentClient, CancellationToken cancellationToken)
    {
        var vendorConfigPath = PrinterDiscoveryService.GetVendorPrinterPropertyJsonPath();
        var vendorDllPath = Path.Combine(VendorDllDirectory, "DPrintCore.dll");
        var targets = new List<PrintDiagnosticTarget>();

        try
        {
            targets.AddRange(ReadWindowsQueueTargets());
        }
        catch (Exception ex)
        {
            targets.Add(CreateFailedDiagnosticTarget(
                "Windows 打印子系统",
                "windows-queue",
                "Windows InstalledPrinters",
                "windows-printer-enumeration",
                "枚举 Windows 打印队列失败。",
                ex.Message));
        }

        List<PrintDiagnosticTarget> vendorTargets;
        try
        {
            vendorTargets = ReadVendorUsbCandidates(vendorConfigPath)
                .DistinctBy(target => target.Identity, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        catch (Exception ex)
        {
            targets.Add(CreateFailedDiagnosticTarget(
                "Dlabel/HB-Q2 厂商通道",
                "vendor-usb",
                vendorConfigPath,
                "vendor-candidate-enumeration",
                "枚举厂商 USB 候选失败。",
                ex.Message));
            vendorTargets = [];
        }

        foreach (var target in vendorTargets)
        {
            targets.Add(await ProbeVendorUsbTargetAsync(target, vendorDllPath, printAgentClient, cancellationToken));
        }

        return new PrintDiagnosticReport
        {
            CheckedAt = DateTimeOffset.Now,
            VendorConfigPath = vendorConfigPath,
            VendorDllDirectory = VendorDllDirectory,
            VendorDllPath = vendorDllPath,
            Targets = targets
                .OrderBy(target => target.ChannelKind, StringComparer.OrdinalIgnoreCase)
                .ThenBy(target => target.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToList()
        };
    }

    internal static IEnumerable<PrintDiagnosticTarget> ReadVendorUsbCandidates(string vendorConfigPath)
    {
        if (File.Exists(vendorConfigPath))
        {
            foreach (var candidate in PrinterDiscoveryService.ReadCandidatesFromVendorConfig(vendorConfigPath))
            {
                yield return CreateVendorUsbTarget(candidate.DisplayName, candidate.DevicePath, "Dlabel PrinterDefaultProperty.json");
            }
        }

        foreach (var candidate in ReadVendorUsbCandidatesFromPrinterRegistry())
        {
            yield return candidate;
        }
    }

    internal static PrintDiagnosticTarget CreateVendorUsbTarget(string displayName, string devicePath, string source)
    {
        return new PrintDiagnosticTarget
        {
            Id = CreateStableId($"vendor-usb:{source}:{devicePath}"),
            DisplayName = displayName,
            ChannelKind = "vendor-usb",
            Identity = devicePath,
            Source = source,
            IsAvailable = false,
            Status = "未探测",
            Steps =
            [
                new PrintDiagnosticStep
                {
                    Stage = "device-path",
                    Status = string.IsNullOrWhiteSpace(devicePath) ? "failed" : "passed",
                    Message = string.IsNullOrWhiteSpace(devicePath) ? "缺少 USB devicePath。" : "已发现 USB devicePath。",
                    Detail = devicePath
                }
            ]
        };
    }

    private static IEnumerable<PrintDiagnosticTarget> ReadWindowsQueueTargets()
    {
        var defaultPrinter = GetDefaultPrinterName();
        foreach (var printerName in PrinterSettings.InstalledPrinters.Cast<string>().OrderBy(name => name, StringComparer.OrdinalIgnoreCase))
        {
            var settings = new PrinterSettings { PrinterName = printerName };
            var isDefault = string.Equals(printerName, defaultPrinter, StringComparison.OrdinalIgnoreCase);
            var isAvailable = settings.IsValid;
            var steps = new List<PrintDiagnosticStep>
            {
                new()
                {
                    Stage = "windows-queue",
                    Status = isAvailable ? "passed" : "failed",
                    Message = isAvailable ? "Windows 打印队列可用。" : "Windows 打印队列不可用。",
                    Detail = printerName
                }
            };

            if (isDefault)
            {
                steps.Add(new PrintDiagnosticStep
                {
                    Stage = "default-printer",
                    Status = "passed",
                    Message = "这是系统默认打印机。",
                    Detail = printerName
                });
            }

            yield return new PrintDiagnosticTarget
            {
                Id = CreateStableId($"windows-queue:{printerName}"),
                DisplayName = isDefault ? $"{printerName}（默认）" : printerName,
                ChannelKind = "windows-queue",
                Identity = printerName,
                Source = "Windows InstalledPrinters",
                IsAvailable = isAvailable,
                Status = isAvailable ? "在线" : "不可用",
                Steps = steps
            };
        }
    }

    private static async Task<PrintDiagnosticTarget> ProbeVendorUsbTargetAsync(
        PrintDiagnosticTarget target,
        string vendorDllPath,
        PrintAgentClient printAgentClient,
        CancellationToken cancellationToken)
    {
        var steps = target.Steps.ToList();
        var dllDirectory = Path.GetDirectoryName(vendorDllPath) ?? string.Empty;

        var directoryExists = Directory.Exists(dllDirectory);
        steps.Add(new PrintDiagnosticStep
        {
            Stage = "vendor-dll-directory",
            Status = directoryExists ? "passed" : "failed",
            Message = directoryExists ? "厂商 DLL 目录存在。" : "厂商 DLL 目录不存在。",
            Detail = dllDirectory
        });

        var dllExists = File.Exists(vendorDllPath);
        steps.Add(new PrintDiagnosticStep
        {
            Stage = "vendor-dll-file",
            Status = dllExists ? "passed" : "failed",
            Message = dllExists ? "DPrintCore.dll 存在。" : "DPrintCore.dll 不存在。",
            Detail = vendorDllPath
        });

        if (string.IsNullOrWhiteSpace(target.Identity) || !directoryExists || !dllExists)
        {
            return WithStatus(target, false, "不可用", steps);
        }

        var probe = await printAgentClient.ProbeAsync(target.Identity, cancellationToken);
        steps.Add(new PrintDiagnosticStep
        {
            Stage = "vendor-usb-open",
            Status = probe.IsAvailable ? "passed" : "failed",
            Message = probe.IsAvailable ? "厂商 USB 通道可打开。" : "厂商 USB 通道打开失败。",
            Detail = probe.Message
        });

        return WithStatus(target, probe.IsAvailable, probe.IsAvailable ? "在线" : "不可用", steps);
    }

    private static string? GetDefaultPrinterName()
    {
        var settings = new PrinterSettings();
        return settings.IsDefaultPrinter ? settings.PrinterName : null;
    }

    private static IEnumerable<PrintDiagnosticTarget> ReadVendorUsbCandidatesFromPrinterRegistry()
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

            yield return CreateVendorUsbTarget(printerName, devicePath, "Windows PrinterDriverData");
        }
    }

    private static PrintDiagnosticTarget CreateFailedDiagnosticTarget(
        string displayName,
        string channelKind,
        string source,
        string stage,
        string message,
        string detail)
    {
        return new PrintDiagnosticTarget
        {
            Id = CreateStableId($"{channelKind}:{source}:{stage}"),
            DisplayName = displayName,
            ChannelKind = channelKind,
            Identity = source,
            Source = source,
            IsAvailable = false,
            Status = "不可用",
            Steps =
            [
                new PrintDiagnosticStep
                {
                    Stage = stage,
                    Status = "failed",
                    Message = message,
                    Detail = detail
                }
            ]
        };
    }

    private static string CreateStableId(string value)
    {
        return Convert.ToHexString(System.Text.Encoding.UTF8.GetBytes(value)).ToLowerInvariant();
    }

    private static PrintDiagnosticTarget WithStatus(PrintDiagnosticTarget target, bool isAvailable, string status, List<PrintDiagnosticStep> steps)
    {
        return new PrintDiagnosticTarget
        {
            Id = target.Id,
            DisplayName = target.DisplayName,
            ChannelKind = target.ChannelKind,
            Identity = target.Identity,
            Source = target.Source,
            IsAvailable = isAvailable,
            Status = status,
            Steps = steps
        };
    }
}
