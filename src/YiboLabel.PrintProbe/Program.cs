using System.Drawing;
using System.Drawing.Printing;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

const string defaultPrinterName = "HB-Q2(USB)";
const int labelWidthMm = 40;
const int labelHeightMm = 30;

var options = ProbeOptions.Parse(args);

if (options.ShowHelp)
{
    PrintHelp();
    return;
}

Console.WriteLine("YiboLabel Print Probe");
Console.WriteLine($"Time: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
Console.WriteLine();

var printers = PrinterSettings.InstalledPrinters.Cast<string>().OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToList();

if (printers.Count == 0)
{
    Console.WriteLine("No printers were found in Windows.");
    return;
}

Console.WriteLine("Installed printers:");
foreach (var printer in printers)
{
    Console.WriteLine($"- {printer}");
}

Console.WriteLine();

var printerName = options.PrinterName ?? defaultPrinterName;
var matchedPrinter = printers.FirstOrDefault(name => string.Equals(name, printerName, StringComparison.OrdinalIgnoreCase));

if (matchedPrinter is null)
{
    Console.WriteLine($"Target printer not found: {printerName}");
    Console.WriteLine("Use --printer <name> to choose another queue.");
    Environment.ExitCode = 2;
    return;
}

var widthHundredths = MmToHundredthsOfInch(labelWidthMm);
var heightHundredths = MmToHundredthsOfInch(labelHeightMm);

Console.WriteLine($"Target printer: {matchedPrinter}");
Console.WriteLine($"Label size: {labelWidthMm}mm x {labelHeightMm}mm ({widthHundredths} x {heightHundredths} hundredths of an inch)");
Console.WriteLine($"Mode: {(options.PrintTestPage ? "print-test" : "inspect-only")}");
Console.WriteLine();

if (options.ProbeUsb)
{
    ProbeUsbAccess();
    Console.WriteLine();
}

if (options.RawProfile is not null)
{
    SendRawCommandProfile(options.RawProfile);
    Console.WriteLine();
}

if (!options.PrintTestPage)
{
    Console.WriteLine("No print job was sent.");
    Console.WriteLine("Run with --print-test to send a test label.");
    return;
}

SendTestPrint(matchedPrinter, widthHundredths, heightHundredths);
Console.WriteLine("Print job submitted.");

static void SendTestPrint(string printerName, int widthHundredths, int heightHundredths)
{
    using var document = new PrintDocument();
    document.DocumentName = $"YiboLabel Probe {DateTime.Now:yyyyMMdd-HHmmss}";
    document.PrinterSettings.PrinterName = printerName;

    if (!document.PrinterSettings.IsValid)
    {
        throw new InvalidOperationException($"Printer is not valid: {printerName}");
    }

    document.PrintController = new StandardPrintController();
    document.DefaultPageSettings.Landscape = false;
    document.DefaultPageSettings.Color = false;
    document.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
    document.DefaultPageSettings.PaperSize = new PaperSize("YiboLabel-40x30mm", widthHundredths, heightHundredths);

    document.PrintPage += (_, eventArgs) =>
    {
        var graphics = eventArgs.Graphics;
        if (graphics is null)
        {
            throw new InvalidOperationException("Print graphics context was not created.");
        }

        graphics.PageUnit = GraphicsUnit.Pixel;
        graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.SingleBitPerPixelGridFit;
        graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.None;
        graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;

        var bounds = eventArgs.PageBounds;
        var printable = eventArgs.MarginBounds;
        var pageRect = new Rectangle(0, 0, bounds.Width - 1, bounds.Height - 1);

        using var borderPen = new Pen(Color.Black, 1);
        using var guidePen = new Pen(Color.Black, 1);
        using var titleFont = new Font("Arial", 10, FontStyle.Bold, GraphicsUnit.Pixel);
        using var bodyFont = new Font("Arial", 8, FontStyle.Regular, GraphicsUnit.Pixel);
        using var smallFont = new Font("Arial", 7, FontStyle.Regular, GraphicsUnit.Pixel);
        using var brush = new SolidBrush(Color.Black);

        graphics.Clear(Color.White);
        graphics.DrawRectangle(borderPen, pageRect);
        graphics.DrawLine(guidePen, 0, 0, bounds.Width - 1, bounds.Height - 1);
        graphics.DrawLine(guidePen, bounds.Width - 1, 0, 0, bounds.Height - 1);
        graphics.DrawRectangle(borderPen, printable);

        var lines = new[]
        {
            "YiboLabel Print Probe",
            $"Printer: {printerName}",
            $"Canvas: {widthHundredths} x {heightHundredths}",
            $"Pixels: {bounds.Width} x {bounds.Height}",
            DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")
        };

        var y = 8;
        graphics.DrawString(lines[0], titleFont, brush, 8, y);
        y += 18;

        foreach (var line in lines.Skip(1))
        {
            graphics.DrawString(line, bodyFont, brush, 8, y);
            y += 14;
        }

        graphics.FillRectangle(brush, 8, bounds.Height - 28, 32, 12);
        graphics.DrawString("BLACK BAR", smallFont, brush, 48, bounds.Height - 26);

        eventArgs.HasMorePages = false;
    };

    document.Print();
}

static int MmToHundredthsOfInch(int millimeters)
{
    return (int)Math.Round(millimeters / 25.4 * 100);
}

static void PrintHelp()
{
    Console.WriteLine("YiboLabel Print Probe");
    Console.WriteLine();
    Console.WriteLine("Usage:");
    Console.WriteLine("  dotnet run --project src\\YiboLabel.PrintProbe -- [--printer <name>] [--probe-usb] [--raw-profile <name>] [--print-test]");
    Console.WriteLine();
    Console.WriteLine("Options:");
    Console.WriteLine("  --printer <name>  Select a Windows printer queue.");
    Console.WriteLine("  --probe-usb       Try opening the USB device path directly.");
    Console.WriteLine("  --raw-profile <name>  Send a raw command profile: tspl-text, tspl-solid, tspl-selftest, cpcl-text, tspl-bitmap-solid.");
    Console.WriteLine("  --print-test      Send a physical test label to the printer.");
    Console.WriteLine("  --help            Show this help message.");
}

static void ProbeUsbAccess()
{
    Console.WriteLine("USB probe:");

    var candidatePaths = GetUsbCandidatePaths().Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    if (candidatePaths.Count == 0)
    {
        Console.WriteLine("- No candidate USB paths were found.");
        return;
    }

    foreach (var path in candidatePaths)
    {
        var result = TryOpenUsbPath(path);
        Console.WriteLine($"- {path}");
        Console.WriteLine($"  {result}");
    }
}

static IEnumerable<string> GetUsbCandidatePaths()
{
    const string printerDriverDataKey = @"HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Print\Printers\HB-Q2(USB)\PrinterDriverData";
    const string vendorPrinterPropertyJson = @"C:\Users\Administrator\AppData\Local\Dlabel\PrinterDefaultProperty.json";

    if (File.Exists(vendorPrinterPropertyJson))
    {
        using var stream = File.OpenRead(vendorPrinterPropertyJson);
        using var document = System.Text.Json.JsonDocument.Parse(stream);
        foreach (var element in document.RootElement.EnumerateArray())
        {
            if (element.TryGetProperty("devicePath", out var property) && property.ValueKind == System.Text.Json.JsonValueKind.String)
            {
                var value = property.GetString();
                if (!string.IsNullOrWhiteSpace(value))
                {
                    yield return value!;
                }
            }
        }
    }

    var registryDevicePath = Microsoft.Win32.Registry.GetValue(printerDriverDataKey, "DevicePath", null) as string;
    if (!string.IsNullOrWhiteSpace(registryDevicePath))
    {
        yield return registryDevicePath;
    }
}

static string TryOpenUsbPath(string path)
{
    using var handle = NativeMethods.CreateFile(
        path,
        NativeMethods.GenericRead | NativeMethods.GenericWrite,
        FileShare.Read | FileShare.Write,
        IntPtr.Zero,
        FileMode.Open,
        FileAttributes.Normal,
        IntPtr.Zero);

    if (!handle.IsInvalid)
    {
        return "open ok";
    }

    var error = Marshal.GetLastWin32Error();
    return $"open failed, win32={error} ({new System.ComponentModel.Win32Exception(error).Message})";
}

static void SendRawCommandProfile(string profileName)
{
    Console.WriteLine($"Raw command profile: {profileName}");

    var targetPath = GetUsbCandidatePaths().FirstOrDefault();

    if (string.IsNullOrWhiteSpace(targetPath))
    {
        Console.WriteLine("- No USB path available.");
        return;
    }

    var profile = profileName.ToLowerInvariant();
    if (profile == "tspl-bitmap-solid")
    {
        SendTsplBitmapSolid(targetPath);
        return;
    }

    var command = profile switch
    {
        "tspl-text" => """
SIZE 40 mm,30 mm
GAP 2 mm,0 mm
DENSITY 8
DIRECTION 1
CLS
TEXT 20,20,"0",0,1,1,"YiboLabel USB"
TEXT 20,50,"0",0,1,1,"TSPL TEXT"
BAR 20,80,200,4
PRINT 1,1
""",
        "tspl-solid" => """
SIZE 40 mm,30 mm
GAP 2 mm,0 mm
DENSITY 8
DIRECTION 1
CLS
BAR 0,0,320,80
BAR 0,100,320,80
PRINT 1,1
""",
        "tspl-selftest" => """
SELFTEST
""",
        "cpcl-text" => """
! 0 200 200 240 1
PW 320
T 0 3 20 20 YiboLabel USB
T 0 3 20 60 CPCL TEXT
FORM
PRINT
""",
        _ => throw new ArgumentException($"Unknown raw profile: {profileName}")
    };

    var payload = Encoding.ASCII.GetBytes(command.ReplaceLineEndings("\r\n") + "\r\n");
    var result = TryWriteUsbPath(targetPath, payload);

    Console.WriteLine($"- Path: {targetPath}");
    Console.WriteLine($"- Payload bytes: {payload.Length}");
    Console.WriteLine($"- Result: {result}");
}

static void SendTsplBitmapSolid(string targetPath)
{
    const int widthBytes = 16;
    const int height = 64;
    var bitmapBytes = Enumerable.Repeat((byte)0xFF, widthBytes * height).ToArray();

    var stream = new MemoryStream();
    var header = """
SIZE 40 mm,30 mm
GAP 2 mm,0 mm
DENSITY 8
DIRECTION 1
CLS
BITMAP 0,0,16,64,0,
""";
    var footer = """

PRINT 1,1
""";

    stream.Write(Encoding.ASCII.GetBytes(header.ReplaceLineEndings("\r\n")));
    stream.Write(bitmapBytes);
    stream.Write(Encoding.ASCII.GetBytes(footer.ReplaceLineEndings("\r\n")));

    var payload = stream.ToArray();
    var result = TryWriteUsbPath(targetPath, payload);

    Console.WriteLine($"- Path: {targetPath}");
    Console.WriteLine($"- Payload bytes: {payload.Length}");
    Console.WriteLine($"- Bitmap bytes: {bitmapBytes.Length}");
    Console.WriteLine($"- Result: {result}");
}

static string TryWriteUsbPath(string path, byte[] payload)
{
    using var handle = NativeMethods.CreateFile(
        path,
        NativeMethods.GenericRead | NativeMethods.GenericWrite,
        FileShare.Read | FileShare.Write,
        IntPtr.Zero,
        FileMode.Open,
        FileAttributes.Normal,
        IntPtr.Zero);

    if (handle.IsInvalid)
    {
        var openError = Marshal.GetLastWin32Error();
        return $"open failed, win32={openError} ({new System.ComponentModel.Win32Exception(openError).Message})";
    }

    var ok = NativeMethods.WriteFile(handle, payload, payload.Length, out var bytesWritten, IntPtr.Zero);
    if (!ok)
    {
        var writeError = Marshal.GetLastWin32Error();
        return $"write failed, win32={writeError} ({new System.ComponentModel.Win32Exception(writeError).Message})";
    }

    return $"write ok, bytesWritten={bytesWritten}";
}

file sealed class ProbeOptions
{
    public string? PrinterName { get; private set; }

    public bool PrintTestPage { get; private set; }

    public bool ProbeUsb { get; private set; }

    public string? RawProfile { get; private set; }

    public bool ShowHelp { get; private set; }

    public static ProbeOptions Parse(string[] args)
    {
        var options = new ProbeOptions();

        for (var index = 0; index < args.Length; index++)
        {
            switch (args[index])
            {
                case "--printer":
                    if (index + 1 >= args.Length)
                    {
                        throw new ArgumentException("Missing value for --printer");
                    }

                    options.PrinterName = args[++index];
                    break;

                case "--print-test":
                    options.PrintTestPage = true;
                    break;

                case "--probe-usb":
                    options.ProbeUsb = true;
                    break;

                case "--raw-profile":
                    if (index + 1 >= args.Length)
                    {
                        throw new ArgumentException("Missing value for --raw-profile");
                    }

                    options.RawProfile = args[++index];
                    break;

                case "--help":
                case "-h":
                case "/?":
                    options.ShowHelp = true;
                    break;

                default:
                    throw new ArgumentException($"Unknown argument: {args[index]}");
            }
        }

        return options;
    }
}

file static class NativeMethods
{
    public const uint GenericRead = 0x80000000;
    public const uint GenericWrite = 0x40000000;

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern SafeFileHandle CreateFile(
        string lpFileName,
        uint dwDesiredAccess,
        FileShare dwShareMode,
        IntPtr lpSecurityAttributes,
        FileMode dwCreationDisposition,
        FileAttributes dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool WriteFile(
        SafeFileHandle hFile,
        byte[] lpBuffer,
        int nNumberOfBytesToWrite,
        out int lpNumberOfBytesWritten,
        IntPtr lpOverlapped);
}
