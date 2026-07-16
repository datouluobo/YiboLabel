using System.Text;
using YiboLabel.App.Models;
using YiboLabel.App.Services;
using Xunit;

namespace YiboLabel.App.Tests;

public sealed class TsplBuilderTests
{
    [Fact]
    public void ConvertPointSizeToPixels_UsesPrinterDpi()
    {
        var pixels = TsplBuilder.ConvertPointSizeToPixels(24);

        Assert.Equal(67.67f, pixels, 2);
    }

    [Fact]
    public void Build_ImageElement_EmbedsBinaryBitmapPayload()
    {
        var builder = new TsplBuilder();
        var document = new LabelDocument
        {
            Name = "Bitmap Label",
            WidthMm = 40,
            HeightMm = 30,
            Copies = 1,
            Darkness = 8,
            GapMm = 2,
            PrintRotation = 0,
            PrintInvert = false,
            PrintOffsetXMm = 0,
            PrintOffsetYMm = 0,
            Elements =
            [
                new ImageElement
                {
                    Id = "image",
                    X = 2,
                    Y = 2,
                    Width = 10,
                    Height = 10,
                    DataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
                }
            ]
        };

        var payload = builder.Build(document);
        var ascii = Encoding.ASCII.GetString(payload);
        const string bitmapCommandPrefix = "BITMAP 0,0,40,240,0,";
        var bitmapOffset = FindSequence(payload, Encoding.ASCII.GetBytes(bitmapCommandPrefix));
        var printOffset = FindSequence(payload, Encoding.ASCII.GetBytes("PRINT 1,1"));

        Assert.True(bitmapOffset >= 0);
        Assert.True(printOffset > bitmapOffset);
        Assert.Contains("PRINT 1,1", ascii);
 
        var bitmapPayloadStart = bitmapOffset + Encoding.ASCII.GetByteCount(bitmapCommandPrefix);
        var bitmapPayloadLength = printOffset - 2 - bitmapPayloadStart;
        Assert.True(bitmapPayloadLength > 0);
    }

    [Fact]
    public void Build_PrintOffset_ChangesRasterizedOutput()
    {
        var builder = new TsplBuilder();
        var baseDocument = new LabelDocument
        {
            Name = "Offset Label",
            WidthMm = 40,
            HeightMm = 30,
            Copies = 1,
            Darkness = 8,
            GapMm = 2,
            PrintRotation = 0,
            PrintInvert = false,
            PrintOffsetXMm = 0,
            PrintOffsetYMm = 0,
            Elements =
            [
                new RectangleElement
                {
                    Id = "box",
                    X = 0,
                    Y = 0,
                    Width = 8,
                    Height = 8,
                    Thickness = 1
                }
            ]
        };

        var shiftedDocument = new LabelDocument
        {
            Name = baseDocument.Name,
            WidthMm = baseDocument.WidthMm,
            HeightMm = baseDocument.HeightMm,
            Copies = baseDocument.Copies,
            Darkness = baseDocument.Darkness,
            GapMm = baseDocument.GapMm,
            PrintRotation = baseDocument.PrintRotation,
            PrintInvert = baseDocument.PrintInvert,
            PrintOffsetXMm = 2,
            PrintOffsetYMm = 1,
            Elements = baseDocument.Elements
        };

        var basePayload = builder.Build(baseDocument);
        var shiftedPayload = builder.Build(shiftedDocument);

        Assert.NotEqual(basePayload, shiftedPayload);
    }

    [Fact]
    public void Build_RotatedDocument_SwapsSizeToMatchBitmapSurface()
    {
        var builder = new TsplBuilder();
        var document = new LabelDocument
        {
            Name = "Rotated Label",
            WidthMm = 70,
            HeightMm = 50,
            Copies = 1,
            Darkness = 8,
            GapMm = 2,
            PrintRotation = 90,
            PrintInvert = false,
            PrintOffsetXMm = 0,
            PrintOffsetYMm = 0,
            Elements =
            [
                new TextElement
                {
                    Id = "title",
                    X = 2,
                    Y = 2,
                    Width = 30,
                    Height = 6,
                    Text = "Rotation",
                    FontSize = 12,
                    FontFamily = "Microsoft YaHei",
                    Align = "left"
                }
            ]
        };

        var payload = builder.Build(document);
        var ascii = Encoding.ASCII.GetString(payload);

        Assert.Contains("SIZE 50 mm,70 mm", ascii);
        Assert.Contains("BITMAP 0,0,", ascii);
    }

    private static int FindSequence(byte[] haystack, byte[] needle, int startIndex = 0)
    {
        for (var index = startIndex; index <= haystack.Length - needle.Length; index++)
        {
            var matched = true;
            for (var offset = 0; offset < needle.Length; offset++)
            {
                if (haystack[index + offset] == needle[offset])
                {
                    continue;
                }

                matched = false;
                break;
            }

            if (matched)
            {
                return index;
            }
        }

        return -1;
    }
}
