using System.Text.Json;
using YiboLabel.App.Models;

namespace YiboLabel.App.Services;

public sealed class TemplateStore
{
    private const int CurrentSchemaVersion = 3;

    private readonly JsonSerializerOptions serializerOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public TemplateStore()
    {
        Directory.CreateDirectory(TemplateDirectory);
        SeedIfEmpty();
    }

    public string RootDirectory { get; } = ResolveDataRoot();

    public string TemplateDirectory => Path.Combine(RootDirectory, "templates");

    public async Task<IReadOnlyList<LabelTemplateSummary>> ListAsync(string? query, string? sort, CancellationToken cancellationToken)
    {
        var records = new List<LabelTemplateSummary>();

        foreach (var filePath in Directory.GetFiles(TemplateDirectory, "*.json", SearchOption.TopDirectoryOnly))
        {
            try
            {
                var record = await LoadRecordAsync(filePath, cancellationToken);
                records.Add(ToSummary(record));
            }
            catch
            {
                // Skip unreadable templates so one bad file does not break the whole library.
            }
        }

        var filtered = ApplyQuery(records, query);
        return ApplySort(filtered, sort).ToList();
    }

    public async Task<LabelTemplateRecord?> GetAsync(string id, CancellationToken cancellationToken)
    {
        var filePath = GetTemplatePath(id);
        return File.Exists(filePath) ? await LoadRecordAsync(filePath, cancellationToken) : null;
    }

    public async Task<LabelTemplateRecord> CreateAsync(SaveTemplateRequest request, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.Now;
        var id = CreateTemplateId(request.Name);
        while (File.Exists(GetTemplatePath(id)))
        {
            id = CreateTemplateId(request.Name);
        }

        var record = new LabelTemplateRecord
        {
            Id = id,
            SchemaVersion = CurrentSchemaVersion,
            Name = request.Name.Trim(),
            Description = request.Description?.Trim() ?? string.Empty,
            Tags = NormalizeTags(request.Tags),
            Source = NormalizeSource(request.Source, "manual"),
            CreatedAt = now,
            UpdatedAt = now,
            LastUsedAt = null,
            Document = request.Document.WithName(request.Name.Trim())
        };

        await SaveRecordAsync(record, cancellationToken);
        return record;
    }

    public async Task<LabelTemplateRecord?> UpdateAsync(string id, SaveTemplateRequest request, CancellationToken cancellationToken)
    {
        var existing = await GetAsync(id, cancellationToken);
        if (existing is null)
        {
            return null;
        }

        var record = new LabelTemplateRecord
        {
            Id = existing.Id,
            SchemaVersion = CurrentSchemaVersion,
            Name = request.Name.Trim(),
            Description = request.Description?.Trim() ?? existing.Description,
            Tags = request.Tags is null ? existing.Tags : NormalizeTags(request.Tags),
            Source = NormalizeSource(request.Source, existing.Source),
            CreatedAt = existing.CreatedAt,
            UpdatedAt = DateTimeOffset.Now,
            LastUsedAt = existing.LastUsedAt,
            Document = request.Document.WithName(request.Name.Trim())
        };

        await SaveRecordAsync(record, cancellationToken);
        return record;
    }

    public async Task<LabelTemplateRecord?> UpdateMetaAsync(string id, UpdateTemplateMetaRequest request, CancellationToken cancellationToken)
    {
        var existing = await GetAsync(id, cancellationToken);
        if (existing is null)
        {
            return null;
        }

        var record = new LabelTemplateRecord
        {
            Id = existing.Id,
            SchemaVersion = CurrentSchemaVersion,
            Name = request.Name.Trim(),
            Description = request.Description?.Trim() ?? string.Empty,
            Tags = NormalizeTags(request.Tags),
            Source = existing.Source,
            CreatedAt = existing.CreatedAt,
            UpdatedAt = DateTimeOffset.Now,
            LastUsedAt = existing.LastUsedAt,
            Document = existing.Document.WithName(request.Name.Trim())
        };

        await SaveRecordAsync(record, cancellationToken);
        return record;
    }

    public async Task<LabelTemplateRecord?> DuplicateAsync(string id, string? newName, CancellationToken cancellationToken)
    {
        var existing = await GetAsync(id, cancellationToken);
        if (existing is null)
        {
            return null;
        }

        var duplicateName = string.IsNullOrWhiteSpace(newName) ? $"{existing.Name} 副本" : newName.Trim();
        var request = new SaveTemplateRequest
        {
            Name = duplicateName,
            Description = existing.Description,
            Tags = existing.Tags,
            Source = "duplicate",
            Document = existing.Document.WithName(duplicateName)
        };

        return await CreateAsync(request, cancellationToken);
    }

    public Task<bool> DeleteAsync(string id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var filePath = GetTemplatePath(id);
        if (!File.Exists(filePath))
        {
            return Task.FromResult(false);
        }

        File.Delete(filePath);
        return Task.FromResult(true);
    }

    private static IEnumerable<LabelTemplateSummary> ApplyQuery(IEnumerable<LabelTemplateSummary> records, string? query)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return records;
        }

        var term = query.Trim();
        return records.Where(record =>
            record.Name.Contains(term, StringComparison.OrdinalIgnoreCase)
            || record.Description.Contains(term, StringComparison.OrdinalIgnoreCase)
            || record.Tags.Any(tag => tag.Contains(term, StringComparison.OrdinalIgnoreCase)));
    }

    private static IEnumerable<LabelTemplateSummary> ApplySort(IEnumerable<LabelTemplateSummary> records, string? sort)
    {
        return (sort ?? "updated-desc").ToLowerInvariant() switch
        {
            "name-asc" => records.OrderBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase),
            "name-desc" => records.OrderByDescending(item => item.Name, StringComparer.CurrentCultureIgnoreCase),
            "created-asc" => records.OrderBy(item => item.CreatedAt),
            "created-desc" => records.OrderByDescending(item => item.CreatedAt),
            "updated-asc" => records.OrderBy(item => item.UpdatedAt),
            _ => records.OrderByDescending(item => item.UpdatedAt)
        };
    }

    private async Task SaveRecordAsync(LabelTemplateRecord record, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(ToFileRecord(record), serializerOptions);
        await File.WriteAllTextAsync(GetTemplatePath(record.Id), payload, cancellationToken);
    }

    private async Task<LabelTemplateRecord> LoadRecordAsync(string filePath, CancellationToken cancellationToken)
    {
        var payload = await File.ReadAllTextAsync(filePath, cancellationToken);

        var fileRecord = JsonSerializer.Deserialize<TemplateFileRecord>(payload, serializerOptions);
        if (fileRecord is not null && fileRecord.SchemaVersion >= CurrentSchemaVersion && fileRecord.Meta is not null)
        {
            return FromFileRecord(fileRecord);
        }

        var legacyRecord = JsonSerializer.Deserialize<LegacyLabelTemplateRecord>(payload, serializerOptions)
            ?? throw new InvalidOperationException($"Failed to deserialize template: {filePath}");

        return FromLegacyRecord(legacyRecord);
    }

    private static TemplateFileRecord ToFileRecord(LabelTemplateRecord record)
    {
        return new TemplateFileRecord
        {
            SchemaVersion = CurrentSchemaVersion,
            Id = record.Id,
            Meta = new TemplateFileMeta
            {
                Name = record.Name,
                Description = record.Description,
                Tags = record.Tags,
                Source = record.Source,
                CreatedAt = record.CreatedAt,
                UpdatedAt = record.UpdatedAt,
                LastUsedAt = record.LastUsedAt
            },
            Document = record.Document.WithName(record.Name)
        };
    }

    private static LabelTemplateRecord FromFileRecord(TemplateFileRecord record)
    {
        return new LabelTemplateRecord
        {
            Id = record.Id,
            SchemaVersion = record.SchemaVersion,
            Name = record.Meta.Name,
            Description = record.Meta.Description,
            Tags = NormalizeTags(record.Meta.Tags),
            Source = NormalizeSource(record.Meta.Source, "manual"),
            CreatedAt = record.Meta.CreatedAt,
            UpdatedAt = record.Meta.UpdatedAt,
            LastUsedAt = record.Meta.LastUsedAt,
            Document = record.Document.WithName(record.Meta.Name)
        };
    }

    private static LabelTemplateRecord FromLegacyRecord(LegacyLabelTemplateRecord record)
    {
        return new LabelTemplateRecord
        {
            Id = record.Id,
            SchemaVersion = CurrentSchemaVersion,
            Name = record.Name,
            Description = string.Empty,
            Tags = [],
            Source = "manual",
            CreatedAt = record.CreatedAt,
            UpdatedAt = record.UpdatedAt,
            LastUsedAt = null,
            Document = record.Document.WithName(record.Name)
        };
    }

    private static LabelTemplateSummary ToSummary(LabelTemplateRecord record)
    {
        return new LabelTemplateSummary
        {
            Id = record.Id,
            Name = record.Name,
            Description = record.Description,
            Tags = record.Tags,
            Source = record.Source,
            CreatedAt = record.CreatedAt,
            UpdatedAt = record.UpdatedAt,
            LastUsedAt = record.LastUsedAt,
            WidthMm = record.Document.WidthMm,
            HeightMm = record.Document.HeightMm,
            ElementCount = record.Document.Elements.Count
        };
    }

    private string GetTemplatePath(string id) => Path.Combine(TemplateDirectory, $"{id}.json");

    private static string CreateTemplateId(string name)
    {
        var safeName = string.Concat(name.Trim().ToLowerInvariant().Select(ch => char.IsLetterOrDigit(ch) ? ch : '-')).Trim('-');
        if (string.IsNullOrWhiteSpace(safeName))
        {
            safeName = "label";
        }

        return $"{safeName}-{DateTimeOffset.Now:yyyyMMddHHmmssfff}";
    }

    private static List<string> NormalizeTags(IEnumerable<string>? tags)
    {
        return tags?
            .Select(tag => tag.Trim())
            .Where(tag => !string.IsNullOrWhiteSpace(tag))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList()
            ?? [];
    }

    private static string NormalizeSource(string? source, string fallback)
    {
        return string.IsNullOrWhiteSpace(source) ? fallback : source.Trim().ToLowerInvariant();
    }

    private void SeedIfEmpty()
    {
        if (Directory.EnumerateFiles(TemplateDirectory, "*.json", SearchOption.TopDirectoryOnly).Any())
        {
            return;
        }

        var sample = new SaveTemplateRequest
        {
            Name = "Shipping Hello",
            Source = "seed",
            Document = new LabelDocument
            {
                Name = "Shipping Hello",
                WidthMm = 40,
                HeightMm = 30,
                Copies = 1,
                GapMm = 2,
                Darkness = 8,
                Elements =
                [
                    new TextElement
                    {
                        Id = "title",
                        X = 3,
                        Y = 3,
                        Width = 30,
                        Height = 6,
                        Text = "YiboLabel",
                        FontSize = 24,
                        Bold = true,
                        Align = "left"
                    },
                    new BarcodeElement
                    {
                        Id = "barcode",
                        X = 3,
                        Y = 11,
                        Width = 32,
                        Height = 8,
                        Value = "YIBO-20260705",
                        Symbology = "CODE128",
                        ShowHumanReadable = true
                    },
                    new QrCodeElement
                    {
                        Id = "qrcode",
                        X = 31,
                        Y = 3,
                        Width = 8,
                        Height = 8,
                        Value = "https://yibo.local/hello"
                    },
                    new RectangleElement
                    {
                        Id = "box",
                        X = 2,
                        Y = 2,
                        Width = 36,
                        Height = 25,
                        Thickness = 1
                    },
                    new TextElement
                    {
                        Id = "footer",
                        X = 3,
                        Y = 22,
                        Width = 30,
                        Height = 4,
                        Text = "HELLO LABEL",
                        FontSize = 20,
                        Align = "left"
                    }
                ]
            }
        };

        CreateAsync(sample, CancellationToken.None).GetAwaiter().GetResult();
    }

    private static string ResolveDataRoot()
    {
        var repoData = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "data"));
        if (Directory.Exists(Path.GetDirectoryName(repoData) ?? string.Empty))
        {
            return repoData;
        }

        return Path.Combine(AppContext.BaseDirectory, "data");
    }
}

file static class LabelDocumentExtensions
{
    public static LabelDocument WithName(this LabelDocument document, string name)
    {
        return new LabelDocument
        {
            Name = name,
            WidthMm = document.WidthMm,
            HeightMm = document.HeightMm,
            PrinterDevicePath = document.PrinterDevicePath,
            Copies = document.Copies,
            Darkness = document.Darkness,
            GapMm = document.GapMm,
            Elements = document.Elements
        };
    }
}

internal sealed class TemplateFileRecord
{
    public int SchemaVersion { get; init; } = 3;

    public required string Id { get; init; }

    public required TemplateFileMeta Meta { get; init; }

    public required LabelDocument Document { get; init; }
}

internal sealed class TemplateFileMeta
{
    public required string Name { get; init; }

    public string Description { get; init; } = string.Empty;

    public required List<string> Tags { get; init; }

    public string Source { get; init; } = "manual";

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; init; }

    public DateTimeOffset? LastUsedAt { get; init; }
}

internal sealed class LegacyLabelTemplateRecord
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; init; }

    public required LabelDocument Document { get; init; }
}
