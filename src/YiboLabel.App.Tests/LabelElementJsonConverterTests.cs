using System.Text.Json;
using YiboLabel.App.Models;
using Xunit;

namespace YiboLabel.App.Tests;

public sealed class LabelElementJsonConverterTests
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    [Fact]
    public void Deserialize_MissingType_InfersTextElement()
    {
        var json = """
        {
          "name": "Legacy",
          "widthMm": 40,
          "heightMm": 30,
          "copies": 1,
          "darkness": 8,
          "gapMm": 2,
          "elements": [
            {
              "id": "title",
              "x": 3,
              "y": 3,
              "width": 20,
              "height": 6,
              "text": "Hello",
              "fontSize": 24,
              "bold": true,
              "align": "left"
            }
          ]
        }
        """;

        var document = JsonSerializer.Deserialize<LabelDocument>(json, SerializerOptions);

        Assert.NotNull(document);
        Assert.Single(document.Elements);
        Assert.IsType<TextElement>(document.Elements[0]);
    }

    [Fact]
    public void Deserialize_MissingType_InfersBarcodeElement()
    {
        var json = """
        {
          "name": "Legacy",
          "widthMm": 40,
          "heightMm": 30,
          "copies": 1,
          "darkness": 8,
          "gapMm": 2,
          "elements": [
            {
              "id": "barcode",
              "x": 3,
              "y": 10,
              "width": 28,
              "height": 8,
              "value": "123456",
              "symbology": "CODE128",
              "showHumanReadable": true,
              "textPosition": "bottom",
              "humanReadableFontSize": 12
            }
          ]
        }
        """;

        var document = JsonSerializer.Deserialize<LabelDocument>(json, SerializerOptions);

        Assert.NotNull(document);
        Assert.Single(document.Elements);
        Assert.IsType<BarcodeElement>(document.Elements[0]);
    }
}
