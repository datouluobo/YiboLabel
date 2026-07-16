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
        var surfaceSize = GetPrintSurfaceSize(document);

        WriteLine(writer, $"SIZE {surfaceSize.WidthMm:0.##} mm,{surfaceSize.HeightMm:0.##} mm");
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
        DrawFittedText(graphics, element.Text, font, brush, bounds, element.Align);
    }

    private static void DrawBarcode(Graphics graphics, BarcodeElement element, RectangleF bounds)
    {
        var encoding = ParseBarcodeFormat(element.Symbology);
        var margin = 0;
        var requestedFontSize = ConvertPointSizeToPixels(element.HumanReadableFontSize);
        var layout = GetCodeElementLayout(bounds, element.ShowHumanReadable, element.TextPosition, requestedFontSize, squareCode: false);
        var barcodeBitmap = new BarcodeWriterPixelData
        {
            Format = encoding,
            Options = new EncodingOptions
            {
                Width = Math.Max(16, (int)Math.Ceiling(layout.Code.Width)),
                Height = Math.Max(16, (int)Math.Ceiling(layout.Code.Height)),
                Margin = margin,
                PureBarcode = true
            }
        }.Write(element.Value);

        using var bitmap = PixelDataToBitmap(barcodeBitmap);
        graphics.DrawImage(bitmap, layout.Code.Left, layout.Code.Top, layout.Code.Width, layout.Code.Height);

        if (layout.Text is null)
        {
            return;
        }

        using var brush = new SolidBrush(Color.Black);
        using var humanReadableFont = CreateTextFontFromPixels(layout.FontSize, bold: false, element.HumanReadableFontFamily);
        DrawFittedText(graphics, element.Value, humanReadableFont, brush, layout.Text.Value, "center");
    }

    private static void DrawQrCode(Graphics graphics, QrCodeElement element, RectangleF bounds)
    {
        var layout = GetCodeElementLayout(bounds, element.ShowHumanReadable, element.TextPosition, ConvertPointSizeToPixels(element.HumanReadableFontSize), squareCode: true);
        var qrSize = Math.Max(16, (int)Math.Ceiling(layout.Code.Width));
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
        graphics.DrawImage(bitmap, layout.Code.Left, layout.Code.Top, layout.Code.Width, layout.Code.Height);

        if (layout.Text is null)
        {
            return;
        }

        using var brush = new SolidBrush(Color.Black);
        using var font = CreateTextFontFromPixels(layout.FontSize, bold: false, element.HumanReadableFontFamily);
        DrawFittedText(graphics, element.Value, font, brush, layout.Text.Value, "center");
    }

    private static void DrawLine(Graphics graphics, LineElement element, RectangleF bounds)
    {
        using var brush = new SolidBrush(Color.Black);
        var strokeHeight = Math.Min(
            bounds.Height,
            Math.Max(1f, (float)(element.Thickness * DotsPerMillimeter * 0.2)));
        var y = bounds.Top + ((bounds.Height - strokeHeight) / 2f);
        graphics.FillRectangle(brush, bounds.Left, y, bounds.Width, strokeHeight);
    }

    private static void DrawRectangle(Graphics graphics, RectangleElement element, RectangleF bounds)
    {
        var penWidth = Math.Max(1f, (float)(element.Thickness * DotsPerMillimeter * 0.12));
        using var pen = new Pen(Color.Black, penWidth);
        var inset = penWidth / 2f;
        graphics.DrawRectangle(
            pen,
            bounds.X + inset,
            bounds.Y + inset,
            Math.Max(1f, bounds.Width - penWidth),
            Math.Max(1f, bounds.Height - penWidth));
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

    private static (double WidthMm, double HeightMm) GetPrintSurfaceSize(LabelDocument document)
    {
        var normalizedRotation = ((document.PrintRotation % 360) + 360) % 360;
        return normalizedRotation is 90 or 270
            ? (document.HeightMm, document.WidthMm)
            : (document.WidthMm, document.HeightMm);
    }

    private static CodeElementLayout GetCodeElementLayout(RectangleF bounds, bool showText, string? textPosition, float requestedFontSize, bool squareCode)
    {
        if (!showText)
        {
            return new CodeElementLayout(FitCodeRect(bounds, squareCode), null, requestedFontSize);
        }

        var verticalPadding = 2f;
        var gap = 0f;
        var naturalTextBlockHeight = (requestedFontSize * 1.18f) + (verticalPadding * 2f);
        var textBlockHeight = Math.Min(bounds.Height, naturalTextBlockHeight);
        var remainingHeight = Math.Max(1f, bounds.Height - textBlockHeight - gap);
        var isTopText = string.Equals(textPosition, "top", StringComparison.OrdinalIgnoreCase);
        var codeBounds = isTopText
            ? new RectangleF(bounds.Left, bounds.Top + textBlockHeight + gap, bounds.Width, remainingHeight)
            : new RectangleF(bounds.Left, bounds.Top, bounds.Width, remainingHeight);
        var textBounds = isTopText
            ? new RectangleF(bounds.Left, bounds.Top, bounds.Width, textBlockHeight)
            : new RectangleF(bounds.Left, bounds.Bottom - textBlockHeight, bounds.Width, textBlockHeight);

        return new CodeElementLayout(FitCodeRect(codeBounds, squareCode), textBounds, requestedFontSize);
    }

    private static RectangleF FitCodeRect(RectangleF bounds, bool squareCode)
    {
        if (!squareCode)
        {
            return bounds;
        }

        var size = Math.Max(1f, Math.Min(bounds.Width, bounds.Height));
        return new RectangleF(
            bounds.Left + ((bounds.Width - size) / 2f),
            bounds.Top + ((bounds.Height - size) / 2f),
            size,
            size);
    }

    private static void DrawFittedText(Graphics graphics, string text, Font font, Brush brush, RectangleF bounds, string? align)
    {
        text ??= string.Empty;
        using var measureFormat = new StringFormat(StringFormat.GenericTypographic)
        {
            FormatFlags = StringFormatFlags.NoWrap | StringFormatFlags.FitBlackBox
        };

        var measured = graphics.MeasureString(string.IsNullOrEmpty(text) ? " " : text, font, SizeF.Empty, measureFormat);
        var availableWidth = Math.Max(1f, bounds.Width - 4f);
        var fitScale = Clamp(availableWidth / Math.Max(1f, measured.Width), 0.55f, 1f);
        var scaledWidth = measured.Width * fitScale;
        var drawX = align switch
        {
            "right" => bounds.Right - scaledWidth,
            "center" => bounds.Left + ((bounds.Width - scaledWidth) / 2f),
            _ => bounds.Left
        };

        var state = graphics.Save();
        try
        {
            graphics.SetClip(bounds);
            graphics.TranslateTransform(drawX, bounds.Top);
            graphics.ScaleTransform(fitScale, 1f);
            graphics.DrawString(string.IsNullOrEmpty(text) ? " " : text, font, brush, 0, 0, measureFormat);
        }
        finally
        {
            graphics.Restore(state);
        }
    }

    private static float Clamp(float value, float min, float max) => Math.Min(Math.Max(value, min), max);

    private static Font CreateTextFont(int fontSize, bool bold, string? preferredFamily = null)
    {
        var emSize = Math.Max(1f, ConvertPointSizeToPixels(fontSize));
        return CreateTextFontFromPixels(emSize, bold, preferredFamily);
    }

    private static Font CreateTextFontFromPixels(float emSize, bool bold, string? preferredFamily = null)
    {
        emSize = Math.Max(1f, emSize);
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

    private sealed record CodeElementLayout(RectangleF Code, RectangleF? Text, float FontSize);
}
