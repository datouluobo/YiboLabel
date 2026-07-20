using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;

namespace YiboLabel.App.Services;

public sealed class DataManagementService(TemplateStore templateStore)
{
    private const int CurrentBackupSchemaVersion = 1;

    private static readonly string[] ManagedDirectories =
    [
        "templates",
        "document-spec-presets",
        "printer-calibrations"
    ];

    private static readonly string[] ManagedFiles =
    [
        "lexicons.json",
        "app-settings.json"
    ];

    private readonly JsonSerializerOptions serializerOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public string RootDirectory => templateStore.RootDirectory;

    public string BackupDirectory => Path.Combine(RootDirectory, "backups");

    public async Task<DataBackupResult> CreateBackupAsync(string? reason, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(BackupDirectory);

        var createdAt = DateTimeOffset.Now;
        var prefix = string.IsNullOrWhiteSpace(reason) ? "backup" : SanitizeFileName(reason.Trim());
        var fileName = $"yibolabel-{prefix}-{createdAt:yyyyMMdd-HHmmss}.zip";
        var targetPath = Path.Combine(BackupDirectory, fileName);

        await using var stream = new FileStream(targetPath, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: false);

        var manifest = new DataBackupManifest
        {
            SchemaVersion = CurrentBackupSchemaVersion,
            Kind = "yibolabel-data-backup",
            CreatedAt = createdAt,
            Includes =
            [
                "templates",
                "lexicons",
                "document-spec-presets",
                "printer-calibrations",
                "app-settings"
            ]
        };

        var manifestEntry = archive.CreateEntry("yibolabel-backup.json", CompressionLevel.Optimal);
        await using (var entryStream = manifestEntry.Open())
        {
            await JsonSerializer.SerializeAsync(entryStream, manifest, serializerOptions, cancellationToken);
        }

        foreach (var directoryName in ManagedDirectories)
        {
            var directoryPath = Path.Combine(RootDirectory, directoryName);
            if (!Directory.Exists(directoryPath))
            {
                continue;
            }

            foreach (var filePath in Directory.GetFiles(directoryPath, "*", SearchOption.AllDirectories))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var relativePath = Path.GetRelativePath(RootDirectory, filePath);
                archive.CreateEntryFromFile(filePath, NormalizeZipPath(relativePath), CompressionLevel.Optimal);
            }
        }

        foreach (var fileNameToInclude in ManagedFiles)
        {
            var filePath = Path.Combine(RootDirectory, fileNameToInclude);
            if (File.Exists(filePath))
            {
                archive.CreateEntryFromFile(filePath, fileNameToInclude, CompressionLevel.Optimal);
            }
        }

        return new DataBackupResult
        {
            FileName = fileName,
            Path = targetPath,
            CreatedAt = createdAt
        };
    }

    public async Task<DataRestoreResult> RestoreBackupAsync(Stream backupStream, string fileName, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(RootDirectory);

        var preRestoreBackup = await CreateBackupAsync("pre-restore", cancellationToken);
        var tempDirectory = Path.Combine(Path.GetTempPath(), "YiboLabel.Restore", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDirectory);

        try
        {
            using (var archive = new ZipArchive(backupStream, ZipArchiveMode.Read, leaveOpen: true))
            {
                ValidateBackup(archive, fileName);

                foreach (var entry in archive.Entries)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (string.IsNullOrWhiteSpace(entry.Name))
                    {
                        continue;
                    }

                    var relativePath = NormalizeRestorePath(entry.FullName);
                    if (relativePath is null || !IsManagedRelativePath(relativePath))
                    {
                        continue;
                    }

                    var targetPath = Path.GetFullPath(Path.Combine(tempDirectory, relativePath));
                    if (!targetPath.StartsWith(Path.GetFullPath(tempDirectory), StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidOperationException("备份文件包含不安全的路径。");
                    }

                    Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
                    entry.ExtractToFile(targetPath, overwrite: true);
                }
            }

            ClearManagedData();
            CopyDirectoryContents(tempDirectory, RootDirectory, cancellationToken);
            EnsureManagedDirectories();

            return new DataRestoreResult
            {
                Restored = true,
                SourceFileName = fileName,
                PreRestoreBackupPath = preRestoreBackup.Path,
                PreRestoreBackupFileName = preRestoreBackup.FileName
            };
        }
        finally
        {
            if (Directory.Exists(tempDirectory))
            {
                Directory.Delete(tempDirectory, recursive: true);
            }
        }
    }

    public void OpenDataDirectory()
    {
        Directory.CreateDirectory(BackupDirectory);
        Process.Start(new ProcessStartInfo
        {
            FileName = BackupDirectory,
            UseShellExecute = true
        });
    }

    public DataDirectoryInfo GetDataDirectoryInfo()
    {
        Directory.CreateDirectory(BackupDirectory);
        return new DataDirectoryInfo
        {
            Path = BackupDirectory
        };
    }

    private void EnsureManagedDirectories()
    {
        foreach (var directoryName in ManagedDirectories)
        {
            Directory.CreateDirectory(Path.Combine(RootDirectory, directoryName));
        }
    }

    private void ClearManagedData()
    {
        foreach (var directoryName in ManagedDirectories)
        {
            var directoryPath = Path.Combine(RootDirectory, directoryName);
            if (Directory.Exists(directoryPath))
            {
                Directory.Delete(directoryPath, recursive: true);
            }
        }

        foreach (var fileName in ManagedFiles)
        {
            var filePath = Path.Combine(RootDirectory, fileName);
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }
    }

    private static void CopyDirectoryContents(string sourceDirectory, string targetDirectory, CancellationToken cancellationToken)
    {
        foreach (var directoryPath in Directory.GetDirectories(sourceDirectory, "*", SearchOption.AllDirectories))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var relativePath = Path.GetRelativePath(sourceDirectory, directoryPath);
            Directory.CreateDirectory(Path.Combine(targetDirectory, relativePath));
        }

        foreach (var filePath in Directory.GetFiles(sourceDirectory, "*", SearchOption.AllDirectories))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var relativePath = Path.GetRelativePath(sourceDirectory, filePath);
            var targetPath = Path.Combine(targetDirectory, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
            File.Copy(filePath, targetPath, overwrite: true);
        }
    }

    private static void ValidateBackup(ZipArchive archive, string fileName)
    {
        var manifestEntry = archive.GetEntry("yibolabel-backup.json");
        if (manifestEntry is null)
        {
            throw new InvalidOperationException($"“{fileName}”不是有效的 YiboLabel 数据备份。");
        }

        using var stream = manifestEntry.Open();
        var manifest = JsonSerializer.Deserialize<DataBackupManifest>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        if (manifest is null ||
            manifest.SchemaVersion != CurrentBackupSchemaVersion ||
            !string.Equals(manifest.Kind, "yibolabel-data-backup", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("备份文件版本不受支持。");
        }
    }

    private static string? NormalizeRestorePath(string entryPath)
    {
        var normalized = entryPath.Replace('\\', '/').TrimStart('/');
        if (normalized.Equals("yibolabel-backup.json", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (normalized.StartsWith("data/", StringComparison.OrdinalIgnoreCase))
        {
            normalized = normalized["data/".Length..];
        }

        return normalized.Contains("..", StringComparison.Ordinal) ? null : normalized;
    }

    private static bool IsManagedRelativePath(string relativePath)
    {
        return ManagedDirectories.Any(directoryName =>
                relativePath.Equals(directoryName, StringComparison.OrdinalIgnoreCase) ||
                relativePath.StartsWith($"{directoryName}/", StringComparison.OrdinalIgnoreCase)) ||
            ManagedFiles.Any(fileName => relativePath.Equals(fileName, StringComparison.OrdinalIgnoreCase));
    }

    private static string NormalizeZipPath(string path) => path.Replace(Path.DirectorySeparatorChar, '/');

    private static string SanitizeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var sanitized = new string(value.Select(character => invalid.Contains(character) ? '-' : character).ToArray()).Trim('-', ' ');
        return string.IsNullOrWhiteSpace(sanitized) ? "backup" : sanitized;
    }
}

public sealed class DataBackupResult
{
    public required string FileName { get; init; }

    public required string Path { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }
}

public sealed class DataRestoreResult
{
    public bool Restored { get; init; }

    public required string SourceFileName { get; init; }

    public required string PreRestoreBackupPath { get; init; }

    public required string PreRestoreBackupFileName { get; init; }
}

public sealed class DataDirectoryInfo
{
    public required string Path { get; init; }
}

internal sealed class DataBackupManifest
{
    public int SchemaVersion { get; init; }

    public string Kind { get; init; } = string.Empty;

    public DateTimeOffset CreatedAt { get; init; }

    public IReadOnlyList<string> Includes { get; init; } = [];
}
