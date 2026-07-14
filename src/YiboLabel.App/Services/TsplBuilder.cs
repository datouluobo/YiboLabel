using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Text;
using YiboLabel.App.Models;

namespace YiboLabel.App.Services;

public sealed class TsplBuilder
{
    private const double DotsPerMillimeter = 203.0 / 25.4;

    public byte[] Build(LabelDocument document)
    {
        var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.ASCII, leaveOpen: true);

        WriteLine(writer, $"SIZE {document.WidthMm:0.##} mm,{document.HeightMm:0.##} mm");
        WriteLine(writer, $"GAP {document.GapMm:0.##} mm,0 mm");
        WriteLine(writer, $"DENSITY {Math.Clamp((int)Math.Round(document.Darkness), 1, 15)}");
        WriteLine(writer, "DIRECTION 1");
        WriteLine(writer, "CLS");

        foreach (var element in document.Elements
            .Where(element => !element.Hidden)
            .OrderBy(element => element.ZIndex ?? int.MaxValue))
        {
            switch (element)
            {
                case TextElement text:
                    WriteText(writer, text);
                    break;
                case BarcodeElement barcode:
                    WriteBarcode(writer, barcode);
                    break;
                case QrCodeElement qrCode:
                    WriteQrCode(writer, qrCode);
                    break;
                case LineElement line:
                    WriteLineShape(writer, line);
                    break;
                case RectangleElement rectangle:
                    WriteRectangle(writer, rectangle);
                    break;
                case ImageElement image:
                    WriteImage(writer, image);
                    break;
            }
        }

        WriteLine(writer, $"PRINT 1,{Math.Max(1, document.Copies)}");
        writer.Flush();
        return stream.ToArray();
    }

    private static void WriteText(BinaryWriter writer, TextElement element)
    {
        var x = ToDots(element.X);
        var y = ToDots(element.Y);
        var widthScale = Math.Max(1, (int)Math.Round(element.Width / 12));
        var heightScale = Math.Max(1, (int)Math.Round(element.Height / 4));
        var font = element.Bold ? "TSS24.BF2" : "3";
        WriteLine(writer, $"TEXT {x},{y},\"{font}\",{NormalizeRotation(element.Rotation)},{widthScale},{heightScale},\"{EscapeText(element.Text)}\"");
    }

    private static void WriteBarcode(BinaryWriter writer, BarcodeElement element)
    {
        var x = ToDots(element.X);
        var y = ToDots(element.Y);
        var height = Math.Max(32, ToDots(element.Height));
        var narrow = Math.Max(2, ToDots(element.Width / 32));
        var wide = Math.Max(narrow + 1, narrow * 2);
        var human = element.ShowHumanReadable ? 1 : 0;
        var symbology = string.IsNullOrWhiteSpace(element.Symbology) ? "128" : element.Symbology.Trim();
        WriteLine(writer, $"BARCODE {x},{y},\"{symbology}\",{height},{human},{NormalizeRotation(element.Rotation)},{narrow},{wide},\"{EscapeText(element.Value)}\"");
    }

    private static void WriteQrCode(BinaryWriter writer, QrCodeElement element)
    {
        var x = ToDots(element.X);
        var y = ToDots(element.Y);
        var cellWidth = Math.Clamp((int)Math.Round(element.Width / 2), 3, 8);
        WriteLine(writer, $"QRCODE {x},{y},L,{cellWidth},A,0,\"{EscapeText(element.Value)}\"");
        if (!element.ShowHumanReadable)
        {
            return;
        }

        var font = Math.Clamp(element.HumanReadableFontSize, 8, 36) >= 18 ? "3" : "2";
        var textY = string.Equals(element.TextPosition, "top", StringComparison.OrdinalIgnoreCase)
            ? Math.Max(0, y - ToDots(4))
            : y + ToDots(element.Height) + ToDots(1);
        WriteLine(writer, $"TEXT {x},{textY},\"{font}\",{NormalizeRotation(element.Rotation)},1,1,\"{EscapeText(element.Value)}\"");
    }

    private static void WriteLineShape(BinaryWriter writer, LineElement element)
    {
        var x = ToDots(element.X);
        var y = ToDots(element.Y);
        var width = Math.Max(ToDots(element.Width), element.Thickness);
        var height = Math.Max(ToDots(element.Height), element.Thickness);
        WriteLine(writer, $"BAR {x},{y},{width},{height}");
    }

    private static void WriteRectangle(BinaryWriter writer, RectangleElement element)
    {
        var x1 = ToDots(element.X);
        var y1 = ToDots(element.Y);
        var x2 = ToDots(element.X + element.Width);
        var y2 = ToDots(element.Y + element.Height);
        WriteLine(writer, $"BOX {x1},{y1},{x2},{y2},{Math.Max(1, element.Thickness)}");
    }

    private static void WriteImage(BinaryWriter writer, ImageElement element)
    {
        var imageBytes = ConvertDataUrlToBitmapPayload(element.DataUrl, element.Width, element.Height, element.Invert);
        var x = ToDots(element.X);
        var y = ToDots(element.Y);
        var widthBytes = Math.Max(1, (int)Math.Ceiling(ToDots(element.Width) / 8d));
        var heightDots = Math.Max(1, ToDots(element.Height));

        WriteLine(writer, $"BITMAP {x},{y},{widthBytes},{heightDots},0,");
        writer.Write(imageBytes);
        writer.Write(Encoding.ASCII.GetBytes("\r\n"));
    }

    private static byte[] ConvertDataUrlToBitmapPayload(string dataUrl, double widthMm, double heightMm, bool invert)
    {
        var marker = "base64,";
        var markerIndex = dataUrl.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 0)
        {
            throw new InvalidOperationException("Image data URL must contain base64 payload.");
        }

        var bytes = Convert.FromBase64String(dataUrl[(markerIndex + marker.Length)..]);
        using var inputStream = new MemoryStream(bytes);
        using var source = new Bitmap(inputStream);
        var widthDots = Math.Max(8, ToDots(widthMm));
        var heightDots = Math.Max(8, ToDots(heightMm));
        var stride = (int)Math.Ceiling(widthDots / 8d);
        var payload = new byte[stride * heightDots];

        using var canvas = new Bitmap(widthDots, heightDots, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(canvas))
        {
            graphics.Clear(Color.White);
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.DrawImage(source, new Rectangle(0, 0, widthDots, heightDots));
        }

        for (var y = 0; y < heightDots; y++)
        {
            for (var x = 0; x < widthDots; x++)
            {
                var pixel = canvas.GetPixel(x, y);
                var luminance = (pixel.R * 0.299) + (pixel.G * 0.587) + (pixel.B * 0.114);
                var shouldPrint = invert ? luminance > 128 : luminance < 128;
                if (!shouldPrint)
                {
                    continue;
                }

                var byteIndex = (y * stride) + (x / 8);
                payload[byteIndex] |= (byte)(0x80 >> (x % 8));
            }
        }

        return payload;
    }

    private static int ToDots(double millimeters) => Math.Max(0, (int)Math.Round(millimeters * DotsPerMillimeter));

    private static int NormalizeRotation(double degrees)
    {
        var normalized = ((int)Math.Round(degrees / 90.0) % 4 + 4) % 4;
        return normalized * 90;
    }

    private static string EscapeText(string text) => text.Replace("\"", "\\\"", StringComparison.Ordinal);

    private static void WriteLine(BinaryWriter writer, string command) => writer.Write(Encoding.ASCII.GetBytes(command + "\r\n"));
}
