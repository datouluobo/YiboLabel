using System.Text.Json;
using YiboLabel.App.Models;

namespace YiboLabel.App.Services;

public sealed class TemplateStore
{
    private const int CurrentSchemaVersion = 1;

    private readonly JsonSerializerOptions serializerOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public TemplateStore()
        : this(null)
    {
    }

    internal TemplateStore(string? rootDirectory)
        : this(rootDirectory, true)
    {
    }

    internal TemplateStore(string? rootDirectory, bool seedIfEmpty)
    {
        RootDirectory = string.IsNullOrWhiteSpace(rootDirectory) ? ResolveDataRoot() : rootDirectory;
        Directory.CreateDirectory(TemplateDirectory);
        if (seedIfEmpty)
        {
            SeedIfEmpty();
        }
    }

    public string RootDirectory { get; }

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
                // Ignore malformed template files so the library remains usable.
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
        var normalizedName = request.Name.Trim();
        var id = CreateTemplateId();

        while (File.Exists(GetTemplatePath(id)))
        {
            id = CreateTemplateId();
        }

        var record = new LabelTemplateRecord
        {
            Id = id,
            SchemaVersion = CurrentSchemaVersion,
            Name = normalizedName,
            CreatedAt = now,
            UpdatedAt = now,
            Document = request.Document.WithName(normalizedName)
        };

        await SaveRecordAsync(record, cancellationToken);
        return record;
    }

    public async Task<LabelTemplateRecord?> SaveAsync(string id, SaveTemplateRequest request, CancellationToken cancellationToken)
    {
        var existing = await GetAsync(id, cancellationToken);
        if (existing is null)
        {
            return null;
        }

        var normalizedName = request.Name.Trim();
        var record = new LabelTemplateRecord
        {
            Id = existing.Id,
            SchemaVersion = CurrentSchemaVersion,
            Name = normalizedName,
            CreatedAt = existing.CreatedAt,
            UpdatedAt = DateTimeOffset.Now,
            Document = request.Document.WithName(normalizedName)
        };

        await SaveRecordAsync(record, cancellationToken);
        return record;
    }

    public async Task<LabelTemplateRecord?> RenameAsync(string id, RenameTemplateRequest request, CancellationToken cancellationToken)
    {
        var existing = await GetAsync(id, cancellationToken);
        if (existing is null)
        {
            return null;
        }

        var normalizedName = request.Name.Trim();
        var record = new LabelTemplateRecord
        {
            Id = existing.Id,
            SchemaVersion = CurrentSchemaVersion,
            Name = normalizedName,
            CreatedAt = existing.CreatedAt,
            UpdatedAt = DateTimeOffset.Now,
            Document = existing.Document.WithName(normalizedName)
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

        return await CreateAsync(new SaveTemplateRequest
        {
            Name = string.IsNullOrWhiteSpace(newName) ? $"{existing.Name} 副本" : newName.Trim(),
            Document = existing.Document.WithName(string.IsNullOrWhiteSpace(newName) ? $"{existing.Name} 副本" : newName.Trim())
        }, cancellationToken);
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
            record.Name.Contains(term, StringComparison.OrdinalIgnoreCase));
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
        var targetPath = GetTemplatePath(record.Id);
        var tempPath = $"{targetPath}.{Guid.NewGuid():N}.tmp";

        await File.WriteAllTextAsync(tempPath, payload, cancellationToken);
        File.Move(tempPath, targetPath, true);
    }

    private async Task<LabelTemplateRecord> LoadRecordAsync(string filePath, CancellationToken cancellationToken)
    {
        var payload = await File.ReadAllTextAsync(filePath, cancellationToken);

        var current = JsonSerializer.Deserialize<TemplateFileRecord>(payload, serializerOptions);
        if (current is null || current.SchemaVersion != CurrentSchemaVersion)
        {
            throw new InvalidOperationException($"Unsupported template schema in {filePath}.");
        }
        return FromFileRecord(current);
    }

    private static TemplateFileRecord ToFileRecord(LabelTemplateRecord record)
    {
        return new TemplateFileRecord
        {
            SchemaVersion = CurrentSchemaVersion,
            Id = record.Id,
            Name = record.Name,
            CreatedAt = record.CreatedAt,
            UpdatedAt = record.UpdatedAt,
            Document = record.Document.WithName(record.Name)
        };
    }

    private static LabelTemplateRecord FromFileRecord(TemplateFileRecord record)
    {
        return new LabelTemplateRecord
        {
            Id = record.Id,
            SchemaVersion = record.SchemaVersion,
            Name = record.Name,
            CreatedAt = record.CreatedAt,
            UpdatedAt = record.UpdatedAt,
            Document = record.Document.WithName(record.Name)
        };
    }

    private static LabelTemplateSummary ToSummary(LabelTemplateRecord record)
    {
        return new LabelTemplateSummary
        {
            Id = record.Id,
            Name = record.Name,
            CreatedAt = record.CreatedAt,
            UpdatedAt = record.UpdatedAt,
            WidthMm = record.Document.WidthMm,
            HeightMm = record.Document.HeightMm,
            ElementCount = record.Document.Elements.Count
        };
    }

    private string GetTemplatePath(string id) => Path.Combine(TemplateDirectory, $"{id}.json");

    private static string CreateTemplateId()
    {
        return $"template-{DateTimeOffset.Now:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}";
    }

    private void SeedIfEmpty()
    {
        if (Directory.EnumerateFiles(TemplateDirectory, "*.json", SearchOption.TopDirectoryOnly).Any())
        {
            return;
        }

        CreateAsync(new SaveTemplateRequest
        {
            Name = "Shipping Hello",
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
        }, CancellationToken.None).GetAwaiter().GetResult();
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
    public int SchemaVersion { get; init; } = 1;

    public required string Id { get; init; }

    public required string Name { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; init; }

    public required LabelDocument Document { get; init; }
}
