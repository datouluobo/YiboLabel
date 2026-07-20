using System.Text.Json;
using YiboLabel.App.Models;

namespace YiboLabel.App.Services;

public sealed class DocumentSpecPresetStore
{
    private const int CurrentSchemaVersion = 1;

    private readonly JsonSerializerOptions serializerOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly TemplateStore templateStore;

    public DocumentSpecPresetStore(TemplateStore templateStore)
    {
        this.templateStore = templateStore;
        Directory.CreateDirectory(PresetDirectory);
        SeedIfEmpty();
    }

    public string RootDirectory => templateStore.RootDirectory;

    public string PresetDirectory => Path.Combine(RootDirectory, "document-spec-presets");

    public async Task<IReadOnlyList<DocumentSpecPresetSummary>> ListAsync(bool includeHidden, CancellationToken cancellationToken)
    {
        var referenceCounts = await templateStore.GetSpecReferenceCountsAsync(cancellationToken);
        var records = new List<DocumentSpecPresetSummary>();

        foreach (var filePath in Directory.GetFiles(PresetDirectory, "*.json", SearchOption.TopDirectoryOnly))
        {
            try
            {
                var record = await LoadRecordAsync(filePath, cancellationToken);
                if (!includeHidden && (record.IsHidden || record.IsArchived))
                {
                    continue;
                }

                referenceCounts.TryGetValue(record.Id, out var referenceCount);
                records.Add(ToSummary(record, referenceCount));
            }
            catch
            {
                // Ignore malformed preset files to keep the app usable.
            }
        }

        return records
            .OrderBy(item => item.IsArchived)
            .ThenBy(item => item.IsHidden)
            .ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    public async Task<DocumentSpecPresetRecord?> GetAsync(string id, CancellationToken cancellationToken)
    {
        var filePath = GetPresetPath(id);
        return File.Exists(filePath) ? await LoadRecordAsync(filePath, cancellationToken) : null;
    }

    public async Task<DocumentSpecPresetRecord> CreateAsync(SaveDocumentSpecPresetRequest request, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.Now;
        var id = CreatePresetId();
        while (File.Exists(GetPresetPath(id)))
        {
            id = CreatePresetId();
        }

        var record = new DocumentSpecPresetRecord
        {
            Id = id,
            SchemaVersion = CurrentSchemaVersion,
            Name = request.Name.Trim(),
            WidthMm = request.WidthMm,
            HeightMm = request.HeightMm,
            GapMm = request.GapMm,
            Notes = request.Notes?.Trim(),
            IsHidden = false,
            IsArchived = false,
            CreatedAt = now,
            UpdatedAt = now,
        };

        await SaveRecordAsync(record, cancellationToken);
        return record;
    }

    public async Task<DocumentSpecPresetRecord?> UpdateMetadataAsync(string id, UpdateDocumentSpecPresetRequest request, CancellationToken cancellationToken)
    {
        var existing = await GetAsync(id, cancellationToken);
        if (existing is null)
        {
            return null;
        }

        var record = new DocumentSpecPresetRecord
        {
            Id = existing.Id,
            SchemaVersion = existing.SchemaVersion,
            Name = request.Name.Trim(),
            WidthMm = existing.WidthMm,
            HeightMm = existing.HeightMm,
            GapMm = existing.GapMm,
            Notes = request.Notes?.Trim(),
            IsHidden = request.IsHidden,
            IsArchived = request.IsArchived,
            CreatedAt = existing.CreatedAt,
            UpdatedAt = DateTimeOffset.Now,
        };

        await SaveRecordAsync(record, cancellationToken);
        return record;
    }

    public async Task<bool> DeleteAsync(string id, CancellationToken cancellationToken)
    {
        var referenceCounts = await templateStore.GetSpecReferenceCountsAsync(cancellationToken);
        if (referenceCounts.TryGetValue(id, out var referenceCount) && referenceCount > 0)
        {
            throw new InvalidOperationException($"此规格已有 {referenceCount} 个模板使用，不能物理删除。请改为隐藏或归档。");
        }

        var filePath = GetPresetPath(id);
        if (!File.Exists(filePath))
        {
            return false;
        }

        File.Delete(filePath);
        return true;
    }

    private async Task SaveRecordAsync(DocumentSpecPresetRecord record, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(record, serializerOptions);
        var targetPath = GetPresetPath(record.Id);
        var tempPath = $"{targetPath}.{Guid.NewGuid():N}.tmp";
        await File.WriteAllTextAsync(tempPath, payload, cancellationToken);
        File.Move(tempPath, targetPath, true);
    }

    private async Task<DocumentSpecPresetRecord> LoadRecordAsync(string filePath, CancellationToken cancellationToken)
    {
        var payload = await File.ReadAllTextAsync(filePath, cancellationToken);
        var record = JsonSerializer.Deserialize<DocumentSpecPresetRecord>(payload, serializerOptions);
        if (record is null || record.SchemaVersion != CurrentSchemaVersion)
        {
            throw new InvalidOperationException($"Unsupported document spec preset schema in {filePath}.");
        }

        return record;
    }

    private static DocumentSpecPresetSummary ToSummary(DocumentSpecPresetRecord record, int referenceCount)
    {
        return new DocumentSpecPresetSummary
        {
            Id = record.Id,
            Name = record.Name,
            WidthMm = record.WidthMm,
            HeightMm = record.HeightMm,
            GapMm = record.GapMm,
            Notes = record.Notes,
            IsHidden = record.IsHidden,
            IsArchived = record.IsArchived,
            CreatedAt = record.CreatedAt,
            UpdatedAt = record.UpdatedAt,
            ReferenceCount = referenceCount,
        };
    }

    private string GetPresetPath(string id) => Path.Combine(PresetDirectory, $"{id}.json");

    private static string CreatePresetId() => $"spec-{DateTimeOffset.Now:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}";

    private void SeedIfEmpty()
    {
        if (Directory.EnumerateFiles(PresetDirectory, "*.json", SearchOption.TopDirectoryOnly).Any())
        {
            return;
        }

        CreateAsync(new SaveDocumentSpecPresetRequest
        {
            Name = "默认 40 x 30 mm",
            WidthMm = 40,
            HeightMm = 30,
            GapMm = 2,
            Notes = "默认标签规格"
        }, CancellationToken.None).GetAwaiter().GetResult();
    }
}
