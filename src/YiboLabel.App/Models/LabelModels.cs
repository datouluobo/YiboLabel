using System.Text.Json.Serialization;

namespace YiboLabel.App.Models;

public sealed class LabelTemplateSummary
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; init; }

    public required double WidthMm { get; init; }

    public required double HeightMm { get; init; }

    public required int ElementCount { get; init; }
}

public sealed class LabelTemplateRecord
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public int SchemaVersion { get; init; } = 1;

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; init; }

    public required LabelDocument Document { get; init; }
}

public sealed class LabelDocument
{
    public required string Name { get; init; }

    public required double WidthMm { get; init; }

    public required double HeightMm { get; init; }

    public string? PrinterDevicePath { get; init; }

    public int Copies { get; init; } = 1;

    public double Darkness { get; init; } = 8;

    public double GapMm { get; init; } = 2;

    public int PrintRotation { get; init; }

    public bool PrintInvert { get; init; }

    public double PrintOffsetXMm { get; init; }

    public double PrintOffsetYMm { get; init; }

    public required List<LabelElement> Elements { get; init; }
}

[JsonConverter(typeof(LabelElementJsonConverter))]
public abstract class LabelElement
{
    public required string Id { get; init; }

    public string? Name { get; init; }

    public required double X { get; init; }

    public required double Y { get; init; }

    public required double Width { get; init; }

    public required double Height { get; init; }

    public double Rotation { get; init; }

    public bool Locked { get; init; }

    public bool Hidden { get; init; }

    public int? ZIndex { get; init; }

    public List<string> LexiconGroupIds { get; init; } = [];

    public string? DefaultLexiconGroupId { get; init; }
}

public sealed class TextElement : LabelElement
{
    public required string Text { get; init; }

    public int FontSize { get; init; } = 24;

    public string FontFamily { get; init; } = "Microsoft YaHei";

    public bool Bold { get; init; }

    public string Align { get; init; } = "left";
}

public sealed class BarcodeElement : LabelElement
{
    public required string Value { get; init; }

    public string Symbology { get; init; } = "CODE128";

    public bool ShowHumanReadable { get; init; } = true;

    public string TextPosition { get; init; } = "bottom";

    public int HumanReadableFontSize { get; init; } = 12;

    public string HumanReadableFontFamily { get; init; } = "Microsoft YaHei";
}

public sealed class QrCodeElement : LabelElement
{
    public required string Value { get; init; }

    public bool ShowHumanReadable { get; init; }

    public string TextPosition { get; init; } = "bottom";

    public int HumanReadableFontSize { get; init; } = 12;

    public string HumanReadableFontFamily { get; init; } = "Microsoft YaHei";
}

public sealed class LineElement : LabelElement
{
    public int Thickness { get; init; } = 1;
}

public sealed class RectangleElement : LabelElement
{
    public int Thickness { get; init; } = 1;
}

public sealed class ImageElement : LabelElement
{
    public required string DataUrl { get; init; }

    public bool Invert { get; init; }
}

public sealed class PrinterEndpoint
{
    public required string Id { get; init; }

    public required string DisplayName { get; init; }

    public required string DevicePath { get; init; }

    public string DriverName { get; init; } = "Dlabel USB";

    public bool IsAvailable { get; init; }

    public string StatusMessage { get; init; } = "状态未知";
}

public sealed class SaveTemplateRequest
{
    public required string Name { get; init; }

    public required LabelDocument Document { get; init; }
}

public sealed class RenameTemplateRequest
{
    public required string Name { get; init; }
}

public sealed class DuplicateTemplateRequest
{
    public string? Name { get; init; }
}

public sealed class PrintRequest
{
    public required LabelDocument Document { get; init; }

    public string? DevicePathOverride { get; init; }
}

public sealed class PrintResult
{
    public required string DevicePath { get; init; }

    public required int Copies { get; init; }

    public required string TsplPath { get; init; }

    public required string AgentOutput { get; init; }
}

public sealed class LexiconLibrary
{
    public int SchemaVersion { get; init; } = 1;

    public required List<Lexicon> Lexicons { get; init; }
}

public sealed class Lexicon
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; set; }

    public required List<LexiconGroup> Groups { get; init; }
}

public sealed class LexiconGroup
{
    public required string Id { get; init; }

    public required string LexiconId { get; init; }

    public required string Name { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; set; }

    public required List<LexiconEntry> Entries { get; init; }
}

public sealed class LexiconEntry
{
    public required string Id { get; init; }

    public required string Text { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; init; }
}

public sealed class LexiconGroupSummary
{
    public required string Id { get; init; }

    public required string LexiconId { get; init; }

    public required string LexiconName { get; init; }

    public required string Name { get; init; }

    public required int EntryCount { get; init; }
}

public sealed class LexiconSuggestion
{
    public required string EntryId { get; init; }

    public required string Text { get; init; }

    public required string GroupId { get; init; }

    public required string GroupName { get; init; }

    public required string LexiconId { get; init; }

    public required string LexiconName { get; init; }
}

public sealed class CreateLexiconRequest
{
    public required string Name { get; init; }
}

public sealed class UpdateLexiconRequest
{
    public required string Name { get; init; }
}

public sealed class CreateLexiconGroupRequest
{
    public required string Name { get; init; }
}

public sealed class UpdateLexiconGroupRequest
{
    public required string Name { get; init; }
}

public sealed class CreateLexiconEntryRequest
{
    public required string Text { get; init; }
}

public sealed class UpdateLexiconEntryRequest
{
    public required string Text { get; init; }
}
