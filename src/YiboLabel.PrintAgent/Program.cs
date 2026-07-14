using YiboLabel.PrintCore;

if (args.Length == 2 && string.Equals(args[0], "probe", StringComparison.OrdinalIgnoreCase))
{
    try
    {
        using var channel = DlabelPrinterChannel.Open(args[1]);
        Console.WriteLine("Printer USB connection is available.");
        return 0;
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"{ex.GetType().Name}: {ex.Message}");
        return 1;
    }
}

if (args.Length < 3 || !string.Equals(args[0], "print-file", StringComparison.OrdinalIgnoreCase))
{
    Console.Error.WriteLine("Usage: YiboLabel.PrintAgent probe <device-path> | print-file <tspl-path> <device-path>");
    return 2;
}

var tsplPath = args[1];
var devicePath = args[2];

if (!File.Exists(tsplPath))
{
    Console.Error.WriteLine($"TSPL file not found: {tsplPath}");
    return 3;
}

try
{
    var payload = await File.ReadAllTextAsync(tsplPath);
    using var channel = DlabelPrinterChannel.Open(devicePath);
    channel.SendRaw(payload);
    Console.WriteLine("Print agent sent payload successfully.");
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine($"{ex.GetType().Name}: {ex.Message}");
    return 1;
}
