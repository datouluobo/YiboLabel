using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Text;
using YiboLabel.App.Models;
using ZXing;
using ZXing.Common;
using ZXing.Rendering;

namespace YiboLabel.App.Services;

public sealed class TsplBuilder
{
    private const double PrinterDpi = 203.0;
    private const double PointsPerInch = 72.0;
    private const double DotsPerMillimeter = PrinterDpi / 25.4;

    public byte[] Build(LabelDocument document)
    {
        var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.ASCII, leaveOpen: true);

        WriteLine(writer, $"SIZE {document.WidthMm:0.##} mm,{document.HeightMm:0.##} mm");
        WriteLine(writer, $"GAP {document.GapMm:0.##} mm,0 mm");
        WriteLine(writer, $"DENSITY {Math.Clamp((int)Math.Round(document.Darkness), 1, 15)}");
        WriteLine(writer, "DIRECTION 1");
        WriteLine(writer, "CLS");

        WriteRasterizedDocument(writer, document);

        WriteLine(writer, $"PRINT 1,{Math.Max(1, document.Copies)}");
        writer.Flush();
        return stream.ToArray();
    }

    private static void WriteRasterizedDocument(BinaryWriter writer, LabelDocument document)
    {
        var widthDots = Math.Max(8, ToDots(document.WidthMm));
        var heightDots = Math.Max(8, ToDots(document.HeightMm));
        var rendered = RenderDocumentToBitmapPayload(document, widthDots, heightDots);

        WriteLine(writer, $"BITMAP 0,0,{rendered.WidthBytes},{rendered.HeightDots},0,");
        writer.Write(rendered.Payload);
        writer.Write(Encoding.ASCII.GetBytes("\r\n"));
    }

    private static BitmapPayload RenderDocumentToBitmapPayload(LabelDocument document, int widthDots, int heightDots)
    {
        using var canvas = new Bitmap(widthDots, heightDots, PixelFormat.Format24bppRgb);
        canvas.SetResolution((float)PrinterDpi, (float)PrinterDpi);
        using (var graphics = Graphics.FromImage(canvas))
        {
            graphics.Clear(Color.White);
            graphics.TextRenderingHint = TextRenderingHint.SingleBitPerPixelGridFit;
            graphics.SmoothingMode = SmoothingMode.None;
            graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
            graphics.PixelOffsetMode = PixelOffsetMode.Half;

            foreach (var element in document.Elements
                .Where(element => !element.Hidden)
                .OrderBy(element => element.ZIndex ?? int.MaxValue))
            {
                DrawElement(graphics, element, document.PrintOffsetXMm, document.PrintOffsetYMm);
            }
        }

        ApplyPrintRotation(canvas, document.PrintRotation);
        var widthBytes = Math.Max(1, (int)Math.Ceiling(canvas.Width / 8d));
        return new BitmapPayload(widthBytes, canvas.Height, ConvertBitmapToMonoPayload(canvas, widthBytes, threshold: 180, invertBits: document.PrintInvert));
    }

    private static void DrawElement(Graphics graphics, LabelElement element, double offsetXMillimeters, double offsetYMillimeters)
    {
        var bounds = new RectangleF(
            ToDots(element.X + offsetXMillimeters),
            ToDots(element.Y + offsetYMillimeters),
            Math.Max(1, ToDots(element.Width)),
            Math.Max(1, ToDots(element.Height)));

        var state = graphics.Save();
        try
        {
            if (Math.Abs(element.Rotation) > double.Epsilon)
            {
                graphics.TranslateTransform(bounds.Left + (bounds.Width / 2f), bounds.Top + (bounds.Height / 2f));
                graphics.RotateTransform((float)element.Rotation);
                graphics.TranslateTransform(-(bounds.Left + (bounds.Width / 2f)), -(bounds.Top + (bounds.Height / 2f)));
            }

            switch (element)
            {
                case TextElement text:
                    DrawText(graphics, text, bounds);
                    break;
                case BarcodeElement barcode:
                    DrawBarcode(graphics, barcode, bounds);
                    break;
                case QrCodeElement qrCode:
                    DrawQrCode(graphics, qrCode, bounds);
                    break;
                case LineElement line:
                    DrawLine(graphics, line, bounds);
                    break;
                case RectangleElement rectangle:
                    DrawRectangle(graphics, rectangle, bounds);
                    break;
                case ImageElement image:
                    DrawImage(graphics, image, bounds);
                    break;
            }
        }
        finally
        {
            graphics.Restore(state);
        }
    }

    private static void DrawText(Graphics graphics, TextElement element, RectangleF bounds)
    {
        using var brush = new SolidBrush(Color.Black);
        using var font = CreateTextFont(element.FontSize, element.Bold, element.FontFamily);
        using var format = new StringFormat
        {
            Alignment = element.Align switch
            {
                "center" => StringAlignment.Center,
                "right" => StringAlignment.Far,
                _ => StringAlignment.Near
            },
            LineAlignment = StringAlignment.Center,
            Trimming = StringTrimming.None,
            FormatFlags = StringFormatFlags.NoWrap | StringFormatFlags.NoClip | StringFormatFlags.FitBlackBox
        };

        graphics.DrawString(element.Text, font, brush, bounds, format);
    }

    private static void DrawBarcode(Graphics graphics, BarcodeElement element, RectangleF bounds)
    {
        var encoding = ParseBarcodeFormat(element.Symbology);
        var margin = 0;
        var barcodeHeight = Math.Max(1, (int)Math.Floor(bounds.Height * (element.ShowHumanReadable ? 0.72 : 1)));
        var barcodeBitmap = new BarcodeWriterPixelData
        {
            Format = encoding,
            Options = new EncodingOptions
            {
                Width = Math.Max(16, (int)Math.Ceiling(bounds.Width)),
                Height = Math.Max(24, barcodeHeight),
                Margin = margin,
                PureBarcode = !element.ShowHumanReadable
            }
        }.Write(element.Value);

        using var bitmap = PixelDataToBitmap(barcodeBitmap);
        graphics.DrawImage(bitmap, bounds.Left, bounds.Top, bounds.Width, barcodeHeight);

        if (!element.ShowHumanReadable)
        {
            return;
        }

        var textAreaTop = bounds.Top + barcodeHeight;
        var textAreaHeight = Math.Max(8, bounds.Height - barcodeHeight);
        using var brush = new SolidBrush(Color.Black);
        using var font = CreateTextFont(element.HumanReadableFontSize, bold: false, element.HumanReadableFontFamily);
        using var format = new StringFormat
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Center,
            FormatFlags = StringFormatFlags.NoWrap
        };
        graphics.DrawString(element.Value, font, brush, new RectangleF(bounds.Left, textAreaTop, bounds.Width, textAreaHeight), format);
    }

    private static void DrawQrCode(Graphics graphics, QrCodeElement element, RectangleF bounds)
    {
        var qrHeight = Math.Max(16, (int)Math.Floor(bounds.Height * (element.ShowHumanReadable ? 0.76 : 1)));
        var qrSize = Math.Max(16, Math.Min((int)Math.Ceiling(bounds.Width), qrHeight));
        var qrBitmap = new BarcodeWriterPixelData
        {
            Format = BarcodeFormat.QR_CODE,
            Options = new EncodingOptions
            {
                Width = qrSize,
                Height = qrSize,
                Margin = 0,
                PureBarcode = true
            }
        }.Write(element.Value);

        using var bitmap = PixelDataToBitmap(qrBitmap);
        graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
        graphics.DrawImage(bitmap, bounds.Left, bounds.Top, qrSize, qrSize);

        if (!element.ShowHumanReadable)
        {
            return;
        }

        var fontY = string.Equals(element.TextPosition, "top", StringComparison.OrdinalIgnoreCase)
            ? bounds.Top - Math.Max(10, bounds.Height * 0.22f)
            : bounds.Top + qrSize;
        var textBounds = new RectangleF(bounds.Left, Math.Max(0, fontY), bounds.Width, Math.Max(10, bounds.Height - qrSize));
        using var brush = new SolidBrush(Color.Black);
        using var font = CreateTextFont(element.HumanReadableFontSize, bold: false, element.HumanReadableFontFamily);
        using var format = new StringFormat
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Center,
            FormatFlags = StringFormatFlags.NoWrap
        };
        graphics.DrawString(element.Value, font, brush, textBounds, format);
    }

    private static void DrawLine(Graphics graphics, LineElement element, RectangleF bounds)
    {
        using var brush = new SolidBrush(Color.Black);
        graphics.FillRectangle(brush, bounds);
    }

    private static void DrawRectangle(Graphics graphics, RectangleElement element, RectangleF bounds)
    {
        using var pen = new Pen(Color.Black, Math.Max(1, element.Thickness));
        graphics.DrawRectangle(pen, bounds.X, bounds.Y, bounds.Width, bounds.Height);
    }

    private static void DrawImage(Graphics graphics, ImageElement element, RectangleF bounds)
    {
        if (string.IsNullOrWhiteSpace(element.DataUrl))
        {
            return;
        }

        var marker = "base64,";
        var markerIndex = element.DataUrl.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 0)
        {
            throw new InvalidOperationException("Image data URL must contain base64 payload.");
        }

        var bytes = Convert.FromBase64String(element.DataUrl[(markerIndex + marker.Length)..]);
        using var inputStream = new MemoryStream(bytes);
        using var source = new Bitmap(inputStream);
        using var imageAttributes = new ImageAttributes();

        if (element.Invert)
        {
            var invertMatrix = new ColorMatrix(
            [
                [-1, 0, 0, 0, 0],
                [0, -1, 0, 0, 0],
                [0, 0, -1, 0, 0],
                [0, 0, 0, 1, 0],
                [1, 1, 1, 0, 1]
            ]);
            imageAttributes.SetColorMatrix(invertMatrix);
        }

        graphics.DrawImage(
            source,
            Rectangle.Round(bounds),
            0,
            0,
            source.Width,
            source.Height,
            GraphicsUnit.Pixel,
            imageAttributes);
    }

    private static byte[] ConvertBitmapToMonoPayload(Bitmap canvas, int stride, int threshold, bool invertBits)
    {
        var payload = new byte[stride * canvas.Height];
        for (var y = 0; y < canvas.Height; y++)
        {
            for (var x = 0; x < canvas.Width; x++)
            {
                var pixel = canvas.GetPixel(x, y);
                var luminance = (pixel.R * 0.299) + (pixel.G * 0.587) + (pixel.B * 0.114);
                var shouldSetBit = invertBits ? luminance >= threshold : luminance < threshold;
                if (!shouldSetBit)
                {
                    continue;
                }

                var byteIndex = (y * stride) + (x / 8);
                payload[byteIndex] |= (byte)(0x80 >> (x % 8));
            }
        }

        return payload;
    }

    private static void ApplyPrintRotation(Bitmap canvas, int rotation)
    {
        var normalized = ((rotation % 360) + 360) % 360;
        var flipType = normalized switch
        {
            90 => RotateFlipType.Rotate90FlipNone,
            180 => RotateFlipType.Rotate180FlipNone,
            270 => RotateFlipType.Rotate270FlipNone,
            _ => RotateFlipType.RotateNoneFlipNone
        };

        if (flipType != RotateFlipType.RotateNoneFlipNone)
        {
            canvas.RotateFlip(flipType);
        }
    }

    private static Font CreateTextFont(int fontSize, bool bold, string? preferredFamily = null)
    {
        var emSize = Math.Max(1f, ConvertPointSizeToPixels(fontSize));
        var style = bold ? FontStyle.Bold : FontStyle.Regular;
        foreach (var familyName in EnumerateFontCandidates(preferredFamily))
        {
            try
            {
                return new Font(familyName, emSize, style, GraphicsUnit.Pixel);
            }
            catch
            {
                // Try the next available font.
            }
        }

        return new Font(FontFamily.GenericSansSerif, emSize, style, GraphicsUnit.Pixel);
    }

    private static IEnumerable<string> EnumerateFontCandidates(string? preferredFamily)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var familyName in new[] { preferredFamily, "Microsoft YaHei UI", "Microsoft YaHei", "SimHei", "SimSun", "KaiTi", "Arial Unicode MS", "Arial" })
        {
            if (string.IsNullOrWhiteSpace(familyName) || !seen.Add(familyName))
            {
                continue;
            }

            yield return familyName;
        }
    }

    internal static float ConvertPointSizeToPixels(int pointSize) => (float)(pointSize * PrinterDpi / PointsPerInch);

    private static BarcodeFormat ParseBarcodeFormat(string? symbology)
    {
        var normalized = symbology?.Trim().ToUpperInvariant();
        return normalized switch
        {
            "128" or "CODE128" => BarcodeFormat.CODE_128,
            "39" or "CODE39" => BarcodeFormat.CODE_39,
            "EAN13" or "EAN-13" => BarcodeFormat.EAN_13,
            "EAN8" or "EAN-8" => BarcodeFormat.EAN_8,
            "ITF" => BarcodeFormat.ITF,
            _ => BarcodeFormat.CODE_128
        };
    }

    private static Bitmap PixelDataToBitmap(PixelData pixelData)
    {
        var bitmap = new Bitmap(pixelData.Width, pixelData.Height, PixelFormat.Format32bppRgb);
        var bitmapData = bitmap.LockBits(new Rectangle(0, 0, pixelData.Width, pixelData.Height), ImageLockMode.WriteOnly, bitmap.PixelFormat);
        try
        {
            System.Runtime.InteropServices.Marshal.Copy(pixelData.Pixels, 0, bitmapData.Scan0, pixelData.Pixels.Length);
        }
        finally
        {
            bitmap.UnlockBits(bitmapData);
        }

        return bitmap;
    }

    private static int ToDots(double millimeters) => Math.Max(0, (int)Math.Round(millimeters * DotsPerMillimeter));

    private static void WriteLine(BinaryWriter writer, string command) => writer.Write(Encoding.ASCII.GetBytes(command + "\r\n"));

    private sealed record BitmapPayload(int WidthBytes, int HeightDots, byte[] Payload);
}
