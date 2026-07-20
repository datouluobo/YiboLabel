using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using YiboLabel.App.Models;

namespace YiboLabel.App.Services;

public sealed class PrinterCalibrationStore
{
    private const int CurrentSchemaVersion = 1;

    private readonly JsonSerializerOptions serializerOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly TemplateStore templateStore;

    public PrinterCalibrationStore(TemplateStore templateStore)
    {
        this.templateStore = templateStore;
        Directory.CreateDirectory(CalibrationDirectory);
    }

    public string RootDirectory => templateStore.RootDirectory;

    public string CalibrationDirectory => Path.Combine(RootDirectory, "printer-calibrations");

    public async Task<IReadOnlyList<PrinterCalibrationRecord>> ListAsync(string devicePath, CancellationToken cancellationToken)
    {
        var printerDirectory = GetPrinterDirectory(devicePath);
        if (!Directory.Exists(printerDirectory))
        {
            return [];
        }

        var records = new List<PrinterCalibrationRecord>();
        foreach (var filePath in Directory.GetFiles(printerDirectory, "*.json", SearchOption.TopDirectoryOnly))
        {
            var payload = await File.ReadAllTextAsync(filePath, cancellationToken);
            var record = JsonSerializer.Deserialize<PrinterCalibrationRecord>(payload, serializerOptions);
            if (record is null || record.SchemaVersion != CurrentSchemaVersion)
            {
                throw new InvalidOperationException($"Unsupported printer calibration schema in {filePath}.");
            }

            records.Add(record);
        }

        return records
            .OrderByDescending(item => item.IsDefault)
            .ThenByDescending(item => item.UpdatedAt)
            .ThenBy(item => item.Label, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    public async Task<PrinterCalibrationRecord> SaveAsync(SavePrinterCalibrationRequest request, CancellationToken cancellationToken)
    {
        var calibrationId = string.IsNullOrWhiteSpace(request.Id) ? CreateCalibrationId() : request.Id.Trim();
        var existingRecords = (await ListAsync(request.DevicePath, cancellationToken)).ToList();
        var markAsDefault = request.IsDefault || existingRecords.Count == 0;

        if (markAsDefault)
        {
            foreach (var existing in existingRecords.Where(item => item.IsDefault && item.Id != calibrationId))
            {
                var demoted = new PrinterCalibrationRecord
                {
                    SchemaVersion = existing.SchemaVersion,
                    Id = existing.Id,
                    DevicePath = existing.DevicePath,
                    PrinterName = existing.PrinterName,
                    IsDefault = false,
                    State = existing.State,
                    Label = existing.Label,
                    PrintOffsetXMm = existing.PrintOffsetXMm,
                    PrintOffsetYMm = existing.PrintOffsetYMm,
                    PrintRotation = existing.PrintRotation,
                    Darkness = existing.Darkness,
                    PrintInvert = existing.PrintInvert,
                    UpdatedAt = existing.UpdatedAt,
                };

                await SaveRecordAsync(demoted, cancellationToken);
            }
        }

        var record = new PrinterCalibrationRecord
        {
            SchemaVersion = CurrentSchemaVersion,
            Id = calibrationId,
            DevicePath = request.DevicePath,
            PrinterName = request.PrinterName.Trim(),
            IsDefault = markAsDefault,
            State = request.State.Trim(),
            Label = request.Label.Trim(),
            PrintOffsetXMm = request.PrintOffsetXMm,
            PrintOffsetYMm = request.PrintOffsetYMm,
            PrintRotation = request.PrintRotation,
            Darkness = request.Darkness,
            PrintInvert = request.PrintInvert,
            UpdatedAt = DateTimeOffset.Now,
        };

        await SaveRecordAsync(record, cancellationToken);
        return record;
    }

    public Task<bool> DeleteAsync(string devicePath, string calibrationId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var path = GetCalibrationPath(devicePath, calibrationId);
        if (!File.Exists(path))
        {
            return Task.FromResult(false);
        }

        File.Delete(path);
        return Task.FromResult(true);
    }

    private string GetPrinterDirectory(string devicePath)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(devicePath))).ToLowerInvariant();
        return Path.Combine(CalibrationDirectory, hash);
    }

    private string GetCalibrationPath(string devicePath, string calibrationId) => Path.Combine(GetPrinterDirectory(devicePath), $"{calibrationId}.json");

    private static string CreateCalibrationId() => $"calibration-{DateTimeOffset.Now:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}";

    private async Task SaveRecordAsync(PrinterCalibrationRecord record, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(record, serializerOptions);
        var targetPath = GetCalibrationPath(record.DevicePath, record.Id);
        var tempPath = $"{targetPath}.{Guid.NewGuid():N}.tmp";
        Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
        await File.WriteAllTextAsync(tempPath, payload, cancellationToken);
        File.Move(tempPath, targetPath, true);
    }
}
