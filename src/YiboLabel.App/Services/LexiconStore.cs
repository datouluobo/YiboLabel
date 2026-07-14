using System.Text.Json;
using YiboLabel.App.Models;

namespace YiboLabel.App.Services;

public sealed class LexiconStore
{
    private readonly JsonSerializerOptions serializerOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public LexiconStore()
    {
        Directory.CreateDirectory(RootDirectory);
        SeedIfMissing();
    }

    public string RootDirectory { get; } = ResolveDataRoot();

    private string LexiconPath => Path.Combine(RootDirectory, "lexicons.json");

    public async Task<LexiconLibrary> GetLibraryAsync(CancellationToken cancellationToken)
    {
        return await LoadAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<LexiconGroupSummary>> ListGroupsAsync(CancellationToken cancellationToken)
    {
        var library = await LoadAsync(cancellationToken);
        return library.Lexicons
            .SelectMany(lexicon => lexicon.Groups.Select(group => new LexiconGroupSummary
            {
                Id = group.Id,
                LexiconId = lexicon.Id,
                LexiconName = lexicon.Name,
                Name = group.Name,
                EntryCount = group.Entries.Count
            }))
            .OrderBy(group => group.LexiconName, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(group => group.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    public async Task<IReadOnlyList<LexiconSuggestion>> GetSuggestionsAsync(IEnumerable<string>? groupIds, string? query, CancellationToken cancellationToken)
    {
        var selectedGroupIds = groupIds?
            .Select(id => id.Trim())
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet(StringComparer.OrdinalIgnoreCase)
            ?? [];

        if (selectedGroupIds.Count == 0)
        {
            return [];
        }

        var term = query?.Trim() ?? string.Empty;
        var library = await LoadAsync(cancellationToken);
        return library.Lexicons
            .SelectMany(lexicon => lexicon.Groups
                .Where(group => selectedGroupIds.Contains(group.Id))
                .SelectMany(group => group.Entries
                    .Where(entry => term.Length == 0 || entry.Text.Contains(term, StringComparison.OrdinalIgnoreCase))
                    .Select(entry => new LexiconSuggestion
                    {
                        EntryId = entry.Id,
                        Text = entry.Text,
                        GroupId = group.Id,
                        GroupName = group.Name,
                        LexiconId = lexicon.Id,
                        LexiconName = lexicon.Name
                    })))
            .DistinctBy(suggestion => $"{suggestion.GroupId}:{suggestion.Text}", StringComparer.OrdinalIgnoreCase)
            .Take(60)
            .ToList();
    }

    public async Task<Lexicon> CreateLexiconAsync(CreateLexiconRequest request, CancellationToken cancellationToken)
    {
        var name = NormalizeName(request.Name, "新词库");
        var now = DateTimeOffset.Now;
        var library = await LoadAsync(cancellationToken);
        var lexicon = new Lexicon
        {
            Id = CreateId(name),
            Name = name,
            CreatedAt = now,
            UpdatedAt = now,
            Groups = []
        };

        library.Lexicons.Add(lexicon);
        await SaveAsync(library, cancellationToken);
        return lexicon;
    }

    public async Task<Lexicon?> UpdateLexiconAsync(string lexiconId, UpdateLexiconRequest request, CancellationToken cancellationToken)
    {
        var library = await LoadAsync(cancellationToken);
        var index = library.Lexicons.FindIndex(lexicon => string.Equals(lexicon.Id, lexiconId, StringComparison.OrdinalIgnoreCase));
        if (index < 0)
        {
            return null;
        }

        var existing = library.Lexicons[index];
        var updated = new Lexicon
        {
            Id = existing.Id,
            Name = NormalizeName(request.Name, existing.Name),
            CreatedAt = existing.CreatedAt,
            UpdatedAt = DateTimeOffset.Now,
            Groups = existing.Groups
        };
        library.Lexicons[index] = updated;
        await SaveAsync(library, cancellationToken);
        return updated;
    }

    public async Task<bool> DeleteLexiconAsync(string lexiconId, CancellationToken cancellationToken)
    {
        var library = await LoadAsync(cancellationToken);
        var removed = library.Lexicons.RemoveAll(lexicon => string.Equals(lexicon.Id, lexiconId, StringComparison.OrdinalIgnoreCase)) > 0;
        if (removed)
        {
            await SaveAsync(library, cancellationToken);
        }

        return removed;
    }

    public async Task<LexiconGroup?> CreateGroupAsync(string lexiconId, CreateLexiconGroupRequest request, CancellationToken cancellationToken)
    {
        var library = await LoadAsync(cancellationToken);
        var lexicon = library.Lexicons.FirstOrDefault(item => string.Equals(item.Id, lexiconId, StringComparison.OrdinalIgnoreCase));
        if (lexicon is null)
        {
            return null;
        }

        var now = DateTimeOffset.Now;
        var group = new LexiconGroup
        {
            Id = CreateId(request.Name),
            LexiconId = lexicon.Id,
            Name = NormalizeName(request.Name, "新分组"),
            CreatedAt = now,
            UpdatedAt = now,
            Entries = []
        };

        lexicon.Groups.Add(group);
        await TouchAndSaveAsync(library, lexicon, cancellationToken);
        return group;
    }

    public async Task<LexiconGroup?> UpdateGroupAsync(string lexiconId, string groupId, UpdateLexiconGroupRequest request, CancellationToken cancellationToken)
    {
        var library = await LoadAsync(cancellationToken);
        var lexicon = library.Lexicons.FirstOrDefault(item => string.Equals(item.Id, lexiconId, StringComparison.OrdinalIgnoreCase));
        var group = lexicon?.Groups.FirstOrDefault(item => string.Equals(item.Id, groupId, StringComparison.OrdinalIgnoreCase));
        if (lexicon is null || group is null)
        {
            return null;
        }

        var index = lexicon.Groups.IndexOf(group);
        var updated = new LexiconGroup
        {
            Id = group.Id,
            LexiconId = group.LexiconId,
            Name = NormalizeName(request.Name, group.Name),
            CreatedAt = group.CreatedAt,
            UpdatedAt = DateTimeOffset.Now,
            Entries = group.Entries
        };
        lexicon.Groups[index] = updated;
        await TouchAndSaveAsync(library, lexicon, cancellationToken);
        return updated;
    }

    public async Task<bool> DeleteGroupAsync(string lexiconId, string groupId, CancellationToken cancellationToken)
    {
        var library = await LoadAsync(cancellationToken);
        var lexicon = library.Lexicons.FirstOrDefault(item => string.Equals(item.Id, lexiconId, StringComparison.OrdinalIgnoreCase));
        if (lexicon is null)
        {
            return false;
        }

        var removed = lexicon.Groups.RemoveAll(group => string.Equals(group.Id, groupId, StringComparison.OrdinalIgnoreCase)) > 0;
        if (removed)
        {
            await TouchAndSaveAsync(library, lexicon, cancellationToken);
        }

        return removed;
    }

    public async Task<LexiconEntry?> CreateEntryAsync(string lexiconId, string groupId, CreateLexiconEntryRequest request, CancellationToken cancellationToken)
    {
        var library = await LoadAsync(cancellationToken);
        var lexicon = library.Lexicons.FirstOrDefault(item => string.Equals(item.Id, lexiconId, StringComparison.OrdinalIgnoreCase));
        var group = lexicon?.Groups.FirstOrDefault(item => string.Equals(item.Id, groupId, StringComparison.OrdinalIgnoreCase));
        if (lexicon is null || group is null)
        {
            return null;
        }

        var text = NormalizeName(request.Text, string.Empty);
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var now = DateTimeOffset.Now;
        var entry = new LexiconEntry
        {
            Id = CreateId(text),
            Text = text,
            CreatedAt = now,
            UpdatedAt = now
        };

        group.Entries.Add(entry);
        await TouchAndSaveAsync(library, lexicon, group, cancellationToken);
        return entry;
    }

    public async Task<LexiconEntry?> UpdateEntryAsync(string lexiconId, string groupId, string entryId, UpdateLexiconEntryRequest request, CancellationToken cancellationToken)
    {
        var library = await LoadAsync(cancellationToken);
        var lexicon = library.Lexicons.FirstOrDefault(item => string.Equals(item.Id, lexiconId, StringComparison.OrdinalIgnoreCase));
        var group = lexicon?.Groups.FirstOrDefault(item => string.Equals(item.Id, groupId, StringComparison.OrdinalIgnoreCase));
        var entry = group?.Entries.FirstOrDefault(item => string.Equals(item.Id, entryId, StringComparison.OrdinalIgnoreCase));
        if (lexicon is null || group is null || entry is null)
        {
            return null;
        }

        var text = NormalizeName(request.Text, entry.Text);
        var index = group.Entries.IndexOf(entry);
        var updated = new LexiconEntry
        {
            Id = entry.Id,
            Text = text,
            CreatedAt = entry.CreatedAt,
            UpdatedAt = DateTimeOffset.Now
        };
        group.Entries[index] = updated;
        await TouchAndSaveAsync(library, lexicon, group, cancellationToken);
        return updated;
    }

    public async Task<bool> DeleteEntryAsync(string lexiconId, string groupId, string entryId, CancellationToken cancellationToken)
    {
        var library = await LoadAsync(cancellationToken);
        var lexicon = library.Lexicons.FirstOrDefault(item => string.Equals(item.Id, lexiconId, StringComparison.OrdinalIgnoreCase));
        var group = lexicon?.Groups.FirstOrDefault(item => string.Equals(item.Id, groupId, StringComparison.OrdinalIgnoreCase));
        if (lexicon is null || group is null)
        {
            return false;
        }

        var removed = group.Entries.RemoveAll(entry => string.Equals(entry.Id, entryId, StringComparison.OrdinalIgnoreCase)) > 0;
        if (removed)
        {
            await TouchAndSaveAsync(library, lexicon, group, cancellationToken);
        }

        return removed;
    }

    private async Task<LexiconLibrary> LoadAsync(CancellationToken cancellationToken)
    {
        var payload = await File.ReadAllTextAsync(LexiconPath, cancellationToken);
        return JsonSerializer.Deserialize<LexiconLibrary>(payload, serializerOptions)
            ?? new LexiconLibrary { Lexicons = [] };
    }

    private async Task SaveAsync(LexiconLibrary library, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(library, serializerOptions);
        await File.WriteAllTextAsync(LexiconPath, payload, cancellationToken);
    }

    private void Save(LexiconLibrary library)
    {
        var payload = JsonSerializer.Serialize(library, serializerOptions);
        File.WriteAllText(LexiconPath, payload);
    }

    private async Task TouchAndSaveAsync(LexiconLibrary library, Lexicon lexicon, CancellationToken cancellationToken)
    {
        lexicon.UpdatedAt = DateTimeOffset.Now;
        await SaveAsync(library, cancellationToken);
    }

    private async Task TouchAndSaveAsync(LexiconLibrary library, Lexicon lexicon, LexiconGroup group, CancellationToken cancellationToken)
    {
        group.UpdatedAt = DateTimeOffset.Now;
        lexicon.UpdatedAt = DateTimeOffset.Now;
        await SaveAsync(library, cancellationToken);
    }

    private void SeedIfMissing()
    {
        if (File.Exists(LexiconPath))
        {
            return;
        }

        var now = DateTimeOffset.Now;
        Save(new LexiconLibrary
        {
            Lexicons =
            [
                new Lexicon
                {
                    Id = "common-label-content",
                    Name = "常用标签内容",
                    CreatedAt = now,
                    UpdatedAt = now,
                    Groups =
                    [
                        CreateGroup("shipping-codes", "发货编码", now, ["YIBO-20260705", "PKG-000001", "SHIP-READY"]),
                        CreateGroup("shop-copy", "店铺文案", now, ["易博标签", "合格品", "请勿倒置", "易碎物品"]),
                        CreateGroup("service-links", "服务链接", now, ["https://yibo.local/hello", "https://yibo.local/support"])
                    ]
                }
            ]
        });
    }

    private static LexiconGroup CreateGroup(string id, string name, DateTimeOffset now, IEnumerable<string> entries)
    {
        return new LexiconGroup
        {
            Id = id,
            LexiconId = "common-label-content",
            Name = name,
            CreatedAt = now,
            UpdatedAt = now,
            Entries = entries.Select(text => new LexiconEntry
            {
                Id = CreateEntryId(text),
                Text = text,
                CreatedAt = now,
                UpdatedAt = now
            }).ToList()
        };
    }

    private static string CreateEntryId(string text)
    {
        var safe = string.Concat(text.ToLowerInvariant().Select(ch => char.IsLetterOrDigit(ch) ? ch : '-')).Trim('-');
        return string.IsNullOrWhiteSpace(safe) ? Guid.NewGuid().ToString("N") : safe;
    }

    private static string CreateId(string text)
    {
        var safe = string.Concat(text.Trim().ToLowerInvariant().Select(ch => char.IsLetterOrDigit(ch) ? ch : '-')).Trim('-');
        if (string.IsNullOrWhiteSpace(safe))
        {
            safe = "item";
        }

        return $"{safe}-{DateTimeOffset.Now:yyyyMMddHHmmssfff}";
    }

    private static string NormalizeName(string? name, string fallback)
    {
        var normalized = name?.Trim() ?? string.Empty;
        return string.IsNullOrWhiteSpace(normalized) ? fallback : normalized;
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
