using Microsoft.Extensions.FileProviders;
using YiboLabel.App.Endpoints;
using YiboLabel.App.Services;

var resolvedWebRoot = ResolveWebRoot();
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<TemplateStore>();
builder.Services.AddSingleton<DocumentSpecPresetStore>();
builder.Services.AddSingleton<LexiconStore>();
builder.Services.AddSingleton<PrinterDiscoveryService>();
builder.Services.AddSingleton<PrintDiagnosticsService>();
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

app.MapYiboLabelApi();

app.MapGet("/", SendIndexOrNotFound);
app.MapFallback(SendIndexOrNotFound);

app.Run();

async Task SendIndexOrNotFound(HttpContext context)
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
}

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
