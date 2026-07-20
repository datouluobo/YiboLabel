using System.IO.Compression;
using YiboLabel.App.Services;
using Xunit;

namespace YiboLabel.App.Tests;

public sealed class DataManagementServiceTests : IDisposable
{
    private readonly string rootDirectory = Path.Combine(Path.GetTempPath(), "YiboLabel.DataManagement.Tests", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(rootDirectory))
        {
            Directory.Delete(rootDirectory, true);
        }
    }

    [Fact]
    public async Task CreateBackupAsync_IncludesManagedDataOnly()
    {
        var service = CreateService();
        await File.WriteAllTextAsync(Path.Combine(rootDirectory, "lexicons.json"), "{}");
        await File.WriteAllTextAsync(Path.Combine(rootDirectory, "jobs", "ignore.tspl"), "temporary job");
        await File.WriteAllTextAsync(Path.Combine(rootDirectory, "templates", "alpha.json"), "{}");

        var backup = await service.CreateBackupAsync(null, CancellationToken.None);

        using var archive = ZipFile.OpenRead(backup.Path);
        Assert.NotNull(archive.GetEntry("yibolabel-backup.json"));
        Assert.NotNull(archive.GetEntry("lexicons.json"));
        Assert.NotNull(archive.GetEntry("templates/alpha.json"));
        Assert.Null(archive.GetEntry("jobs/ignore.tspl"));
    }

    [Fact]
    public async Task RestoreBackupAsync_RestoresManagedFilesAndCreatesPreRestoreBackup()
    {
        var service = CreateService();
        var lexiconPath = Path.Combine(rootDirectory, "lexicons.json");
        await File.WriteAllTextAsync(lexiconPath, """{"before":true}""");
        await File.WriteAllTextAsync(Path.Combine(rootDirectory, "templates", "old.json"), """{"old":true}""");
        var backupPath = Path.Combine(rootDirectory, "incoming.zip");

        using (var archive = ZipFile.Open(backupPath, ZipArchiveMode.Create))
        {
            var manifest = archive.CreateEntry("yibolabel-backup.json");
            await using (var stream = new StreamWriter(manifest.Open()))
            {
                await stream.WriteAsync("""
                {
                  "schemaVersion": 1,
                  "kind": "yibolabel-data-backup",
                  "createdAt": "2026-07-20T00:00:00+08:00",
                  "includes": []
                }
                """);
            }

            var lexicons = archive.CreateEntry("lexicons.json");
            await using (var stream = new StreamWriter(lexicons.Open()))
            {
                await stream.WriteAsync("""{"after":true}""");
            }

            var template = archive.CreateEntry("templates/new.json");
            await using (var stream = new StreamWriter(template.Open()))
            {
                await stream.WriteAsync("""{"new":true}""");
            }
        }

        await using var input = File.OpenRead(backupPath);
        var result = await service.RestoreBackupAsync(input, "incoming.zip", CancellationToken.None);

        Assert.True(result.Restored);
        Assert.True(File.Exists(result.PreRestoreBackupPath));
        Assert.Equal("""{"after":true}""", await File.ReadAllTextAsync(lexiconPath));
        Assert.True(File.Exists(Path.Combine(rootDirectory, "templates", "new.json")));
        Assert.False(File.Exists(Path.Combine(rootDirectory, "templates", "old.json")));
    }

    [Fact]
    public void GetDataDirectoryInfo_ReturnsBackupDirectory()
    {
        var service = CreateService();

        var info = service.GetDataDirectoryInfo();

        Assert.Equal(Path.Combine(rootDirectory, "backups"), info.Path);
        Assert.True(Directory.Exists(info.Path));
    }

    private DataManagementService CreateService()
    {
        Directory.CreateDirectory(rootDirectory);
        Directory.CreateDirectory(Path.Combine(rootDirectory, "templates"));
        Directory.CreateDirectory(Path.Combine(rootDirectory, "jobs"));
        return new DataManagementService(new TemplateStore(rootDirectory, false));
    }
}
