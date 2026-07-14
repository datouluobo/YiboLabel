using System.Text.Json;
using System.Text.Json.Serialization;

namespace YiboLabel.App.Models;

internal sealed class LabelElementJsonConverter : JsonConverter<LabelElement>
{
    public override LabelElement? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var document = JsonDocument.ParseValue(ref reader);
        var elementType = ResolveElementType(document.RootElement);
        var json = document.RootElement.GetRawText();

        return (LabelElement?)JsonSerializer.Deserialize(json, elementType, options);
    }

    public override void Write(Utf8JsonWriter writer, LabelElement value, JsonSerializerOptions options)
    {
        JsonSerializer.Serialize(writer, (object)value, value.GetType(), options);
    }

    private static Type ResolveElementType(JsonElement element)
    {
        if (element.TryGetProperty("type", out var typeProperty))
        {
            var normalized = typeProperty.GetString()?.Trim().ToLowerInvariant();
            var explicitType = normalized switch
            {
                "text" => typeof(TextElement),
                "barcode" => typeof(BarcodeElement),
                "qrcode" => typeof(QrCodeElement),
                "line" => typeof(LineElement),
                "rectangle" => typeof(RectangleElement),
                "image" => typeof(ImageElement),
                _ => null,
            };

            if (explicitType is not null)
            {
                return explicitType;
            }
        }

        if (element.TryGetProperty("text", out _))
        {
            return typeof(TextElement);
        }

        if (element.TryGetProperty("dataUrl", out _))
        {
            return typeof(ImageElement);
        }

        if (element.TryGetProperty("value", out _))
        {
            return element.TryGetProperty("symbology", out _) ? typeof(BarcodeElement) : typeof(QrCodeElement);
        }

        if (element.TryGetProperty("thickness", out _))
        {
            var width = ReadNumber(element, "width");
            var height = ReadNumber(element, "height");
            return width <= 1.5 || height <= 1.5 ? typeof(LineElement) : typeof(RectangleElement);
        }

        throw new JsonException("Label element type could not be determined.");
    }

    private static double ReadNumber(JsonElement element, string propertyName)
    {
        if (element.TryGetProperty(propertyName, out var value) && value.TryGetDouble(out var number))
        {
            return number;
        }

        return 0;
    }
}
