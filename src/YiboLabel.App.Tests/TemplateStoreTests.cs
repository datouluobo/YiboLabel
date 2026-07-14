using YiboLabel.App.Models;
using YiboLabel.App.Services;
using Xunit;

namespace YiboLabel.App.Tests;

public sealed class TemplateStoreTests : IDisposable
{
    private readonly string rootDirectory = Path.Combine(Path.GetTempPath(), "YiboLabel.Tests", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(rootDirectory))
        {
            Directory.Delete(rootDirectory, true);
        }
    }

    [Fact]
    public async Task CreateAsync_WritesV1TemplateFile()
    {
        var store = CreateStore();

        var created = await store.CreateAsync(new SaveTemplateRequest
        {
            Name = "Alpha Label",
            Document = CreateDocument("Alpha Label")
        }, CancellationToken.None);

        var savedPath = Path.Combine(rootDirectory, "templates", $"{created.Id}.json");
        var payload = await File.ReadAllTextAsync(savedPath);

        Assert.Contains("\"schemaVersion\": 1", payload);
        Assert.Contains("\"name\": \"Alpha Label\"", payload);
        Assert.DoesNotContain("\"description\"", payload);
        Assert.DoesNotContain("\"tags\"", payload);
        Assert.StartsWith("template-", created.Id);
    }

    [Fact]
    public async Task SaveAsync_UpdatesDocumentAndKeepsCreatedAt()
    {
        var store = CreateStore();
        var created = await store.CreateAsync(new SaveTemplateRequest
        {
            Name = "Alpha Label",
            Document = CreateDocument("Alpha Label")
        }, CancellationToken.None);

        var saved = await store.SaveAsync(created.Id, new SaveTemplateRequest
        {
            Name = "Beta Label",
            Document = CreateDocument("Beta Label", widthMm: 50)
        }, CancellationToken.None);

        Assert.NotNull(saved);
        Assert.Equal(created.CreatedAt, saved.CreatedAt);
        Assert.Equal("Beta Label", saved.Name);
        Assert.Equal(50, saved.Document.WidthMm);
        Assert.True(saved.UpdatedAt >= created.UpdatedAt);
    }

    [Fact]
    public async Task RenameAsync_UpdatesTemplateNameOnly()
    {
        var store = CreateStore();
        var created = await store.CreateAsync(new SaveTemplateRequest
        {
            Name = "Alpha Label",
            Document = CreateDocument("Alpha Label", widthMm: 42)
        }, CancellationToken.None);

        var renamed = await store.RenameAsync(created.Id, new RenameTemplateRequest
        {
            Name = "Renamed Label"
        }, CancellationToken.None);

        Assert.NotNull(renamed);
        Assert.Equal("Renamed Label", renamed.Name);
        Assert.Equal("Renamed Label", renamed.Document.Name);
        Assert.Equal(42, renamed.Document.WidthMm);
    }

    [Fact]
    public async Task ListAsync_IgnoresUnsupportedTemplateFiles()
    {
        var store = CreateStore();
        await store.CreateAsync(new SaveTemplateRequest
        {
            Name = "Alpha Label",
            Document = CreateDocument("Alpha Label")
        }, CancellationToken.None);

        var invalidPath = Path.Combine(rootDirectory, "templates", "legacy.json");
        await File.WriteAllTextAsync(invalidPath, """
        {
          "id": "legacy",
          "name": "Legacy",
          "document": {}
        }
        """);

        var templates = await store.ListAsync(null, null, CancellationToken.None);

        Assert.Single(templates);
        Assert.Equal("Alpha Label", templates[0].Name);
    }

    [Fact]
    public async Task DuplicateAndDeleteAsync_WorkAsExpected()
    {
        var store = CreateStore();
        var created = await store.CreateAsync(new SaveTemplateRequest
        {
            Name = "Alpha Label",
            Document = CreateDocument("Alpha Label")
        }, CancellationToken.None);

        var duplicate = await store.DuplicateAsync(created.Id, "Alpha Copy", CancellationToken.None);
        var deleted = await store.DeleteAsync(created.Id, CancellationToken.None);
        var templates = await store.ListAsync(null, null, CancellationToken.None);

        Assert.NotNull(duplicate);
        Assert.True(deleted);
        Assert.Single(templates);
        Assert.Equal("Alpha Copy", templates[0].Name);
    }

    private TemplateStore CreateStore()
    {
        Directory.CreateDirectory(rootDirectory);
        return new TemplateStore(rootDirectory, false);
    }

    private static LabelDocument CreateDocument(string name, double widthMm = 40)
    {
        return new LabelDocument
        {
            Name = name,
            WidthMm = widthMm,
            HeightMm = 30,
            Copies = 1,
            Darkness = 8,
            GapMm = 2,
            Elements =
            [
                new TextElement
                {
                    Id = "title",
                    X = 3,
                    Y = 3,
                    Width = 20,
                    Height = 6,
                    Text = "Hello",
                    FontSize = 24,
                    Bold = false,
                    Align = "left"
                }
            ]
        };
    }
}
