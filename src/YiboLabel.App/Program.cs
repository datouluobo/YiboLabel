using YiboLabel.App.Models;
using YiboLabel.App.Services;
using Microsoft.Extensions.FileProviders;
using System.Reflection;

var resolvedWebRoot = ResolveWebRoot();
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<TemplateStore>();
builder.Services.AddSingleton<DocumentSpecPresetStore>();
builder.Services.AddSingleton<LexiconStore>();
builder.Services.AddSingleton<PrinterDiscoveryService>();
builder.Services.AddSingleton<PrinterCalibrationStore>();
builder.Services.AddSingleton<DataManagementService>();
builder.Services.AddSingleton<TsplBuilder>();
builder.Services.AddSingleton<PrintAgentClient>();
builder.Services.AddEndpointsApiExplorer();

var app = builder.Build();

app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (Exception ex) when (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.StatusCode = 500;
        context.Response.ContentType = "application/json; charset=utf-8";
        await context.Response.WriteAsJsonAsync(new
        {
            error = ex.Message
        });
    }
});

if (resolvedWebRoot is not null)
{
    var fileProvider = new PhysicalFileProvider(resolvedWebRoot);
    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = fileProvider
    });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = fileProvider
    });
}

app.MapGet("/api/app-state", async (PrinterDiscoveryService discoveryService, PrintAgentClient printAgentClient, CancellationToken cancellationToken) =>
{
    return Results.Ok(new
    {
        appName = "YiboLabel",
        appVersion = GetAppVersion(),
        printers = await discoveryService.GetKnownPrintersAsync(printAgentClient, cancellationToken),
        defaultWidthMm = 40,
        defaultHeightMm = 30,
        dpi = 203
    });
});

app.MapGet("/api/printers", async (PrinterDiscoveryService discoveryService, PrintAgentClient printAgentClient, CancellationToken cancellationToken) =>
{
    return Results.Ok(await discoveryService.GetKnownPrintersAsync(printAgentClient, cancellationToken));
});

app.MapGet("/api/data-management/directory", (DataManagementService dataManagementService) =>
{
    return Results.Ok(dataManagementService.GetDataDirectoryInfo());
});

app.MapPost("/api/data-management/backup", async (DataManagementService dataManagementService, CancellationToken cancellationToken) =>
{
    return Results.Ok(await dataManagementService.CreateBackupAsync(null, cancellationToken));
});

app.MapPost("/api/data-management/restore", async (HttpRequest request, DataManagementService dataManagementService, CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
    {
        return Results.BadRequest(new { error = "请选择一个 YiboLabel 备份文件。" });
    }

    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files.GetFile("backup");
    if (file is null || file.Length == 0)
    {
        return Results.BadRequest(new { error = "备份文件为空。" });
    }

    await using var stream = file.OpenReadStream();
    return Results.Ok(await dataManagementService.RestoreBackupAsync(stream, file.FileName, cancellationToken));
});

app.MapPost("/api/data-management/open-directory", (DataManagementService dataManagementService) =>
{
    dataManagementService.OpenDataDirectory();
    return Results.Ok(new { opened = true });
});

app.MapGet("/api/templates", async (string? q, string? sort, TemplateStore templateStore, CancellationToken cancellationToken) =>
{
    return Results.Ok(await templateStore.ListAsync(q, sort, cancellationToken));
});

app.MapGet("/api/templates/{id}", async (string id, TemplateStore templateStore, CancellationToken cancellationToken) =>
{
    var template = await templateStore.GetAsync(id, cancellationToken);
    return template is null ? Results.NotFound() : Results.Ok(template);
});

app.MapGet("/api/document-spec-presets", async (bool includeHidden, DocumentSpecPresetStore presetStore, CancellationToken cancellationToken) =>
{
    return Results.Ok(await presetStore.ListAsync(includeHidden, cancellationToken));
});

app.MapPost("/api/document-spec-presets", async (SaveDocumentSpecPresetRequest request, DocumentSpecPresetStore presetStore, CancellationToken cancellationToken) =>
{
    var validationError = ValidateDocumentSpecPresetRequest(request);
    if (validationError is not null)
    {
        return Results.BadRequest(new { error = validationError });
    }

    return Results.Ok(await presetStore.CreateAsync(request, cancellationToken));
});

app.MapPut("/api/document-spec-presets/{id}", async (string id, UpdateDocumentSpecPresetRequest request, DocumentSpecPresetStore presetStore, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "Spec preset name is required." });
    }

    var updated = await presetStore.UpdateMetadataAsync(id, request, cancellationToken);
    return updated is null ? Results.NotFound() : Results.Ok(updated);
});

app.MapDelete("/api/document-spec-presets/{id}", async (string id, DocumentSpecPresetStore presetStore, CancellationToken cancellationToken) =>
{
    var deleted = await presetStore.DeleteAsync(id, cancellationToken);
    return deleted ? Results.NoContent() : Results.NotFound();
});

app.MapGet("/api/lexicons", async (LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    return Results.Ok(await lexiconStore.GetLibraryAsync(cancellationToken));
});

app.MapGet("/api/lexicon-groups", async (LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    return Results.Ok(await lexiconStore.ListGroupsAsync(cancellationToken));
});

app.MapGet("/api/lexicon-suggestions", async (string? groups, string? q, LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    var groupIds = groups?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) ?? [];
    return Results.Ok(await lexiconStore.GetSuggestionsAsync(groupIds, q, cancellationToken));
});

app.MapPost("/api/lexicons", async (CreateLexiconRequest request, LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "Lexicon name is required." });
    }

    return Results.Ok(await lexiconStore.CreateLexiconAsync(request, cancellationToken));
});

app.MapPut("/api/lexicons/{lexiconId}", async (string lexiconId, UpdateLexiconRequest request, LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "Lexicon name is required." });
    }

    var saved = await lexiconStore.UpdateLexiconAsync(lexiconId, request, cancellationToken);
    return saved is null ? Results.NotFound() : Results.Ok(saved);
});

app.MapDelete("/api/lexicons/{lexiconId}", async (string lexiconId, LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    var deleted = await lexiconStore.DeleteLexiconAsync(lexiconId, cancellationToken);
    return deleted ? Results.NoContent() : Results.NotFound();
});

app.MapPost("/api/lexicons/{lexiconId}/groups", async (string lexiconId, CreateLexiconGroupRequest request, LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "Group name is required." });
    }

    var saved = await lexiconStore.CreateGroupAsync(lexiconId, request, cancellationToken);
    return saved is null ? Results.NotFound() : Results.Ok(saved);
});

app.MapPut("/api/lexicons/{lexiconId}/groups/{groupId}", async (string lexiconId, string groupId, UpdateLexiconGroupRequest request, LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "Group name is required." });
    }

    var saved = await lexiconStore.UpdateGroupAsync(lexiconId, groupId, request, cancellationToken);
    return saved is null ? Results.NotFound() : Results.Ok(saved);
});

app.MapDelete("/api/lexicons/{lexiconId}/groups/{groupId}", async (string lexiconId, string groupId, LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    var deleted = await lexiconStore.DeleteGroupAsync(lexiconId, groupId, cancellationToken);
    return deleted ? Results.NoContent() : Results.NotFound();
});

app.MapPost("/api/lexicons/{lexiconId}/groups/{groupId}/move", async (string lexiconId, string groupId, MoveLexiconItemRequest request, LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.AnchorId) || (request.Placement is not "before" and not "after"))
    {
        return Results.BadRequest(new { error = "Move target is required." });
    }

    var moved = await lexiconStore.MoveGroupAsync(lexiconId, groupId, request, cancellationToken);
    return moved ? Results.Ok(new { moved = true }) : Results.NotFound();
});

app.MapPost("/api/lexicons/{lexiconId}/groups/{groupId}/entries", async (string lexiconId, string groupId, CreateLexiconEntryRequest request, LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Text))
    {
        return Results.BadRequest(new { error = "Entry text is required." });
    }

    var saved = await lexiconStore.CreateEntryAsync(lexiconId, groupId, request, cancellationToken);
    return saved is null ? Results.NotFound() : Results.Ok(saved);
});

app.MapPut("/api/lexicons/{lexiconId}/groups/{groupId}/entries/{entryId}", async (string lexiconId, string groupId, string entryId, UpdateLexiconEntryRequest request, LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Text))
    {
        return Results.BadRequest(new { error = "Entry text is required." });
    }

    var saved = await lexiconStore.UpdateEntryAsync(lexiconId, groupId, entryId, request, cancellationToken);
    return saved is null ? Results.NotFound() : Results.Ok(saved);
});

app.MapDelete("/api/lexicons/{lexiconId}/groups/{groupId}/entries/{entryId}", async (string lexiconId, string groupId, string entryId, LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    var deleted = await lexiconStore.DeleteEntryAsync(lexiconId, groupId, entryId, cancellationToken);
    return deleted ? Results.NoContent() : Results.NotFound();
});

app.MapPost("/api/lexicons/{lexiconId}/groups/{groupId}/entries/{entryId}/move", async (string lexiconId, string groupId, string entryId, MoveLexiconItemRequest request, LexiconStore lexiconStore, CancellationToken cancellationToken) =>
{
    if (request.Placement is not "before" and not "after")
    {
        return Results.BadRequest(new { error = "Move target is required." });
    }

    var moved = await lexiconStore.MoveEntryAsync(lexiconId, groupId, entryId, request, cancellationToken);
    return moved ? Results.Ok(new { moved = true }) : Results.NotFound();
});

app.MapPost("/api/templates", async (SaveTemplateRequest request, TemplateStore templateStore, CancellationToken cancellationToken) =>
{
    var validationError = ValidateTemplateRequest(request);
    if (validationError is not null)
    {
        return Results.BadRequest(new { error = validationError });
    }

    var saved = await templateStore.CreateAsync(request, cancellationToken);
    return Results.Ok(saved);
});

app.MapPut("/api/templates/{id}", async (string id, SaveTemplateRequest request, TemplateStore templateStore, CancellationToken cancellationToken) =>
{
    var validationError = ValidateTemplateRequest(request);
    if (validationError is not null)
    {
        return Results.BadRequest(new { error = validationError });
    }

    var saved = await templateStore.SaveAsync(id, request, cancellationToken);
    return saved is null ? Results.NotFound() : Results.Ok(saved);
});

app.MapPatch("/api/templates/{id}/name", async (string id, RenameTemplateRequest request, TemplateStore templateStore, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return Results.BadRequest(new { error = "Template name is required." });
    }

    var saved = await templateStore.RenameAsync(id, request, cancellationToken);
    return saved is null ? Results.NotFound() : Results.Ok(saved);
});

app.MapPost("/api/templates/{id}/duplicate", async (string id, DuplicateTemplateRequest request, TemplateStore templateStore, CancellationToken cancellationToken) =>
{
    var duplicate = await templateStore.DuplicateAsync(id, request.Name, cancellationToken);
    return duplicate is null ? Results.NotFound() : Results.Ok(duplicate);
});

app.MapPost("/api/templates/{id}/move", async (string id, MoveTemplateRequest request, TemplateStore templateStore, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.AnchorId) ||
        (request.Placement is not "before" && request.Placement is not "after"))
    {
        return Results.BadRequest(new { error = "Valid template move request is required." });
    }

    var moved = await templateStore.MoveAsync(id, request, cancellationToken);
    return moved is null ? Results.NotFound() : Results.Ok(moved);
});

app.MapDelete("/api/templates/{id}", async (string id, TemplateStore templateStore, CancellationToken cancellationToken) =>
{
    var deleted = await templateStore.DeleteAsync(id, cancellationToken);
    return deleted ? Results.NoContent() : Results.NotFound();
});

app.MapGet("/api/printer-calibrations", async (string? devicePath, PrinterCalibrationStore calibrationStore, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(devicePath))
    {
        return Results.BadRequest(new { error = "Printer device path is required." });
    }

    return Results.Ok(await calibrationStore.ListAsync(devicePath, cancellationToken));
});

app.MapPut("/api/printer-calibrations", async (SavePrinterCalibrationRequest request, PrinterCalibrationStore calibrationStore, CancellationToken cancellationToken) =>
{
    var validationError = ValidatePrinterCalibrationRequest(request);
    if (validationError is not null)
    {
        return Results.BadRequest(new { error = validationError });
    }

    return Results.Ok(await calibrationStore.SaveAsync(request, cancellationToken));
});

app.MapDelete("/api/printer-calibrations/{calibrationId}", async (string calibrationId, string? devicePath, PrinterCalibrationStore calibrationStore, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(devicePath))
    {
        return Results.BadRequest(new { error = "Printer device path is required." });
    }

    var deleted = await calibrationStore.DeleteAsync(devicePath, calibrationId, cancellationToken);
    return deleted ? Results.NoContent() : Results.NotFound();
});

app.MapPost("/api/print", async (PrintRequest request, PrinterDiscoveryService discoveryService, PrintAgentClient printAgentClient, CancellationToken cancellationToken) =>
{
    var printers = await discoveryService.GetKnownPrintersAsync(printAgentClient, cancellationToken);
    var devicePath = request.DevicePathOverride
        ?? request.Document.PrinterDevicePath
        ?? printers.FirstOrDefault()?.DevicePath;

    if (string.IsNullOrWhiteSpace(devicePath))
    {
        return Results.BadRequest(new { error = "No printer device path is available." });
    }

    var selectedPrinter = printers.FirstOrDefault(printer => string.Equals(printer.DevicePath, devicePath, StringComparison.OrdinalIgnoreCase));
    if (selectedPrinter is not null && !selectedPrinter.IsAvailable)
    {
        return Results.BadRequest(new { error = $"打印机“{selectedPrinter.DisplayName}”当前离线：{selectedPrinter.StatusMessage}" });
    }

    var result = await printAgentClient.PrintAsync(request.Document, devicePath, cancellationToken);
    return Results.Ok(result);
});

app.MapGet("/", async context =>
{
    var indexPath = resolvedWebRoot is null ? null : Path.Combine(resolvedWebRoot, "index.html");
    if (!string.IsNullOrWhiteSpace(indexPath) && File.Exists(indexPath))
    {
        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.SendFileAsync(indexPath);
        return;
    }

    context.Response.StatusCode = 404;
    await context.Response.WriteAsync("Frontend build was not found. Run the client build first.");
});

app.MapFallback(async context =>
{
    var indexPath = resolvedWebRoot is null ? null : Path.Combine(resolvedWebRoot, "index.html");
    if (!string.IsNullOrWhiteSpace(indexPath) && File.Exists(indexPath))
    {
        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.SendFileAsync(indexPath);
        return;
    }

    context.Response.StatusCode = 404;
    await context.Response.WriteAsync("Frontend build was not found. Run the client build first.");
});

app.Run();

static string? ResolveWebRoot()
{
    var candidates = new[]
    {
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "wwwroot")),
        Path.Combine(AppContext.BaseDirectory, "wwwroot"),
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "YiboLabel.App", "wwwroot")),
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "YiboLabel.App", "wwwroot")),
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "YiboLabel.App", "bin", "Debug", "net10.0-windows", "wwwroot")),
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "YiboLabel.App", "bin", "Debug", "net10.0-windows", "wwwroot"))
    };

    return candidates.FirstOrDefault(Directory.Exists);
}

static string? ValidateTemplateRequest(SaveTemplateRequest request)
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return "Template name is required.";
    }

    if (request.Document.Elements.Count == 0)
    {
        return "Template must include at least one element.";
    }

    return null;
}

static string? ValidateDocumentSpecPresetRequest(SaveDocumentSpecPresetRequest request)
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        return "Spec preset name is required.";
    }

    if (request.WidthMm <= 0 || request.HeightMm <= 0)
    {
        return "Spec preset size must be greater than zero.";
    }

    if (request.GapMm < 0)
    {
        return "Spec preset gap cannot be negative.";
    }

    return null;
}

static string? ValidatePrinterCalibrationRequest(SavePrinterCalibrationRequest request)
{
    if (string.IsNullOrWhiteSpace(request.DevicePath))
    {
        return "Printer device path is required.";
    }

    if (string.IsNullOrWhiteSpace(request.PrinterName))
    {
        return "Printer name is required.";
    }

    if (string.IsNullOrWhiteSpace(request.State))
    {
        return "Calibration state is required.";
    }

    if (string.IsNullOrWhiteSpace(request.Label))
    {
        return "Calibration label is required.";
    }

    return null;
}

static string GetAppVersion()
{
    var assembly = Assembly.GetEntryAssembly() ?? Assembly.GetExecutingAssembly();
    return assembly
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
        .InformationalVersion
        ?? assembly.GetName().Version?.ToString()
        ?? "dev";
}
