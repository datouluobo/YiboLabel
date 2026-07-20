using YiboLabel.App.Models;
using YiboLabel.App.Services;
using Xunit;

namespace YiboLabel.App.Tests;

public sealed class PrintWorkflowStoreTests : IDisposable
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
    public async Task DocumentSpecPresetStore_DeleteAsync_BlocksReferencedPreset()
    {
        var templateStore = CreateTemplateStore();
        var presetStore = new DocumentSpecPresetStore(templateStore);

        var preset = await presetStore.CreateAsync(new SaveDocumentSpecPresetRequest
        {
            Name = "40 x 30",
            WidthMm = 40,
            HeightMm = 30,
            GapMm = 2
        }, CancellationToken.None);

        await templateStore.CreateAsync(new SaveTemplateRequest
        {
            Name = "Alpha Label",
            Document = CreateDocument("Alpha Label", preset.Id, preset.Name)
        }, CancellationToken.None);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => presetStore.DeleteAsync(preset.Id, CancellationToken.None));
        Assert.Contains("不能物理删除", error.Message);
    }

    [Fact]
    public async Task PrinterCalibrationStore_SaveListAndDeleteAsync_RoundTripsProfiles()
    {
        var calibrationStore = new PrinterCalibrationStore(CreateTemplateStore());
        var devicePath = @"\\?\usb#vid_28e9&pid_0285#test";

        var first = await calibrationStore.SaveAsync(new SavePrinterCalibrationRequest
        {
            DevicePath = devicePath,
            PrinterName = "HB-Q2",
            State = "calibrated",
            Label = "当前打印机校准",
            PrintOffsetXMm = 1.2,
            PrintOffsetYMm = -0.4,
            PrintRotation = 90,
            Darkness = 10,
            PrintInvert = true
        }, CancellationToken.None);

        var second = await calibrationStore.SaveAsync(new SavePrinterCalibrationRequest
        {
            DevicePath = devicePath,
            PrinterName = "HB-Q2",
            State = "calibrated",
            Label = "备用方案",
            PrintOffsetXMm = 0.5,
            PrintOffsetYMm = 0.2,
            PrintRotation = 0,
            Darkness = 8,
            PrintInvert = false
        }, CancellationToken.None);

        var saved = await calibrationStore.ListAsync(devicePath, CancellationToken.None);
        Assert.Equal(2, saved.Count);
        Assert.Contains(saved, item => item.Id == first.Id && item.Label == "当前打印机校准");
        Assert.Contains(saved, item => item.Id == second.Id && item.Label == "备用方案");

        var deleted = await calibrationStore.DeleteAsync(devicePath, first.Id, CancellationToken.None);
        Assert.True(deleted);
        var remaining = await calibrationStore.ListAsync(devicePath, CancellationToken.None);
        Assert.Single(remaining);
        Assert.Equal(second.Id, remaining[0].Id);
    }

    private TemplateStore CreateTemplateStore()
    {
        Directory.CreateDirectory(rootDirectory);
        return new TemplateStore(rootDirectory, false);
    }

    private static LabelDocument CreateDocument(string name, string specId, string specName)
    {
        return new LabelDocument
        {
            Name = name,
            WidthMm = 40,
            HeightMm = 30,
            SourceSpecId = specId,
            SourceSpecName = specName,
            Copies = 1,
            Darkness = 8,
            GapMm = 2,
            PrintRotation = 0,
            PrintInvert = false,
            PrintOffsetXMm = 0,
            PrintOffsetYMm = 0,
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
