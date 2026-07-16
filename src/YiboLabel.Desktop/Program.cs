using System.Diagnostics;
using System.Net.Http;
using System.Text.Json;
using System.Runtime.InteropServices;
using System.Reflection;
using System.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace YiboLabel.Desktop;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

internal sealed class MainForm : Form
{
    private const string AppUrl = "http://127.0.0.1:5076";
    private const int ResizeBorderThickness = 8;
    private const int WmNchittest = 0x84;
    private const int WmNclbuttondown = 0xA1;
    private const int HtClient = 1;
    private const int HtCaption = 2;
    private const int HtLeft = 10;
    private const int HtRight = 11;
    private const int HtTop = 12;
    private const int HtTopLeft = 13;
    private const int HtTopRight = 14;
    private const int HtBottom = 15;
    private const int HtBottomLeft = 16;
    private const int HtBottomRight = 17;
    private static readonly string WindowStateFilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "YiboLabel",
        "window-state.json");

    private readonly WebView2 webView;
    private Process? backendProcess;

    public MainForm()
    {
        Text = $"YiboLabel {GetDesktopVersion()}";
        Width = 1600;
        Height = 980;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(1200, 760);
        FormBorderStyle = FormBorderStyle.None;
        BackColor = Color.FromArgb(243, 247, 252);
        ApplyWindowState();
        MaximizedBounds = Screen.FromPoint(Location).WorkingArea;

        webView = new WebView2
        {
            Dock = DockStyle.Fill
        };

        Controls.Add(webView);

        Load += OnLoadAsync;
        FormClosed += OnClosed;
    }

    private async void OnLoadAsync(object? sender, EventArgs eventArgs)
    {
        try
        {
            backendProcess = StartBackend();
            await WaitForBackendAsync();
            await EnsureFrontendAsync();
            await webView.EnsureCoreWebView2Async();
            webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            webView.Source = new Uri(AppUrl);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "YiboLabel 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private void OnClosed(object? sender, FormClosedEventArgs eventArgs)
    {
        try
        {
            SaveWindowState();

            if (backendProcess is { HasExited: false })
            {
                backendProcess.Kill(true);
            }
        }
        catch
        {
            // Ignore cleanup failures on close.
        }
    }

    private static Process StartBackend()
    {
        var backendExe = ResolveBackendExePath();
        var startInfo = new ProcessStartInfo
        {
            FileName = backendExe,
            Arguments = $"--urls {AppUrl}",
            WorkingDirectory = Path.GetDirectoryName(backendExe) ?? AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        return Process.Start(startInfo) ?? throw new InvalidOperationException("无法启动 YiboLabel 后端。");
    }

    private static string ResolveBackendExePath()
    {
        var candidates = new[]
        {
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "YiboLabel.App", "bin", "Debug", "net10.0-windows", "YiboLabel.App.exe")),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "YiboLabel.App", "bin", "Debug", "net10.0-windows", "YiboLabel.App.exe")),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "YiboLabel.App.exe"))
        };

        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException(
            "未找到 YiboLabel.App.exe，请先完成构建。候选路径：" + Environment.NewLine + string.Join(Environment.NewLine, candidates),
            candidates[0]);
    }

    private static async Task WaitForBackendAsync()
    {
        using var client = new HttpClient();

        for (var index = 0; index < 30; index++)
        {
            try
            {
                using var response = await client.GetAsync($"{AppUrl}/api/app-state");
                if (response.IsSuccessStatusCode)
                {
                    return;
                }
            }
            catch
            {
                // Retry until timeout below.
            }

            await Task.Delay(1000);
        }

        throw new TimeoutException("YiboLabel 后端启动超时。");
    }

    private static async Task EnsureFrontendAsync()
    {
        using var client = new HttpClient();
        using var response = await client.GetAsync(AppUrl);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"前端首页加载失败，HTTP {(int)response.StatusCode}。");
        }

        var html = await response.Content.ReadAsStringAsync();
        if (!html.Contains("<!doctype html>", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("前端首页内容异常，未检测到有效的 HTML 入口页。请先重新执行启动脚本完成前端构建。");
        }
    }

    private void ApplyWindowState()
    {
        var state = LoadWindowState();
        if (state is null)
        {
            return;
        }

        var bounds = new Rectangle(state.Left, state.Top, state.Width, state.Height);
        if (!IsUsableBounds(bounds))
        {
            return;
        }

        StartPosition = FormStartPosition.Manual;
        Bounds = bounds;
        if (state.IsMaximized)
        {
            WindowState = FormWindowState.Maximized;
        }
    }

    private void SaveWindowState()
    {
        try
        {
            var bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            var state = new WindowStateSnapshot
            {
                Left = bounds.Left,
                Top = bounds.Top,
                Width = bounds.Width,
                Height = bounds.Height,
                IsMaximized = WindowState == FormWindowState.Maximized
            };

            var directory = Path.GetDirectoryName(WindowStateFilePath);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
            }

            File.WriteAllText(WindowStateFilePath, JsonSerializer.Serialize(state));
        }
        catch
        {
            // Ignore persistence failures on close.
        }
    }

    private static WindowStateSnapshot? LoadWindowState()
    {
        try
        {
            if (!File.Exists(WindowStateFilePath))
            {
                return null;
            }

            return JsonSerializer.Deserialize<WindowStateSnapshot>(File.ReadAllText(WindowStateFilePath));
        }
        catch
        {
            return null;
        }
    }

    private static bool IsUsableBounds(Rectangle bounds)
    {
        if (bounds.Width < 1200 || bounds.Height < 760)
        {
            return false;
        }

        return Screen.AllScreens.Any(screen => screen.WorkingArea.IntersectsWith(bounds));
    }

    private static string GetDesktopVersion()
    {
        var assembly = Assembly.GetExecutingAssembly();
        return assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion
            ?? assembly.GetName().Version?.ToString()
            ?? "dev";
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        try
        {
            using var payload = JsonDocument.Parse(eventArgs.WebMessageAsJson);
            if (!payload.RootElement.TryGetProperty("type", out var typeElement))
            {
                return;
            }

            var type = typeElement.GetString();
            if (type is "export-save-dialog" or "export-write-file" or "export-print-pdf")
            {
                await HandleExportMessageAsync(type, payload.RootElement);
                return;
            }

            if (type != "window-chrome")
            {
                return;
            }

            var command = payload.RootElement.TryGetProperty("command", out var commandElement) ? commandElement.GetString() : null;
            switch (command)
            {
                case "drag":
                    BeginWindowDrag();
                    break;
                case "toggle-maximize":
                    WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
                    break;
                case "minimize":
                    WindowState = FormWindowState.Minimized;
                    break;
                case "close":
                    Close();
                    break;
            }
        }
        catch
        {
            // Ignore malformed bridge messages from the web surface.
        }
    }

    private async Task HandleExportMessageAsync(string type, JsonElement payload)
    {
        var requestId = payload.TryGetProperty("requestId", out var requestIdElement)
            ? requestIdElement.GetString()
            : null;
        if (string.IsNullOrWhiteSpace(requestId))
        {
            return;
        }

        try
        {
            switch (type)
            {
                case "export-save-dialog":
                    SendExportResponse("export-save-dialog-result", requestId, ShowExportSaveDialog(payload));
                    break;
                case "export-write-file":
                    WriteExportFile(payload);
                    SendExportResponse("export-write-file-result", requestId, new { success = true });
                    break;
                case "export-print-pdf":
                    await PrintExportPdfAsync(payload);
                    SendExportResponse("export-print-pdf-result", requestId, new { success = true });
                    break;
            }
        }
        catch (Exception ex)
        {
            SendExportResponse(
                type switch
                {
                    "export-save-dialog" => "export-save-dialog-result",
                    "export-write-file" => "export-write-file-result",
                    "export-print-pdf" => "export-print-pdf-result",
                    _ => "export-result"
                },
                requestId,
                new
                {
                    success = false,
                    error = ex.Message
                });
        }
    }

    private object ShowExportSaveDialog(JsonElement payload)
    {
        var format = payload.TryGetProperty("format", out var formatElement)
            ? formatElement.GetString()
            : null;
        var suggestedName = payload.TryGetProperty("suggestedName", out var suggestedNameElement)
            ? suggestedNameElement.GetString()
            : null;

        var options = GetExportDialogOptions(format);
        using var dialog = new SaveFileDialog
        {
            Title = "导出标签",
            FileName = SanitizeFileName(string.IsNullOrWhiteSpace(suggestedName) ? "未命名标签" : suggestedName, options.Extension),
            Filter = options.Filter,
            DefaultExt = options.Extension.TrimStart('.'),
            AddExtension = true,
            OverwritePrompt = true,
            RestoreDirectory = true
        };

        if (dialog.ShowDialog(this) != DialogResult.OK)
        {
            return new
            {
                success = true,
                cancelled = true
            };
        }

        return new
        {
            success = true,
            cancelled = false,
            path = dialog.FileName,
            fileName = Path.GetFileName(dialog.FileName)
        };
    }

    private static (string Filter, string Extension) GetExportDialogOptions(string? format)
    {
        return format switch
        {
            "template" => ("YiboLabel template (*.yblabel.json)|*.yblabel.json", ".yblabel.json"),
            "png" => ("PNG image (*.png)|*.png", ".png"),
            "jpg" => ("JPEG image (*.jpg)|*.jpg;*.jpeg", ".jpg"),
            "pdf" => ("PDF document (*.pdf)|*.pdf", ".pdf"),
            _ => throw new InvalidOperationException("未知导出格式。")
        };
    }

    private static string SanitizeFileName(string fileName, string extension)
    {
        var invalidChars = Path.GetInvalidFileNameChars();
        var sanitized = new string(fileName.Select(character => invalidChars.Contains(character) ? '_' : character).ToArray()).Trim();
        if (string.IsNullOrWhiteSpace(sanitized))
        {
            sanitized = "未命名标签";
        }

        return sanitized.EndsWith(extension, StringComparison.OrdinalIgnoreCase)
            ? sanitized
            : sanitized + extension;
    }

    private static void WriteExportFile(JsonElement payload)
    {
        var path = payload.GetProperty("path").GetString();
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new InvalidOperationException("缺少导出路径。");
        }

        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var contentKind = payload.TryGetProperty("contentKind", out var contentKindElement)
            ? contentKindElement.GetString()
            : "text";

        if (contentKind == "base64")
        {
            var base64 = payload.GetProperty("contentBase64").GetString() ?? string.Empty;
            File.WriteAllBytes(path, Convert.FromBase64String(base64));
            return;
        }

        var text = payload.GetProperty("contentText").GetString() ?? string.Empty;
        File.WriteAllText(path, text, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    private async Task PrintExportPdfAsync(JsonElement payload)
    {
        var path = payload.GetProperty("path").GetString();
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new InvalidOperationException("缺少 PDF 导出路径。");
        }

        var widthMm = payload.TryGetProperty("pageWidthMm", out var widthElement) ? widthElement.GetDouble() : 210d;
        var heightMm = payload.TryGetProperty("pageHeightMm", out var heightElement) ? heightElement.GetDouble() : 297d;
        var orientation = payload.TryGetProperty("orientation", out var orientationElement)
            ? orientationElement.GetString()
            : (widthMm > heightMm ? "landscape" : "portrait");
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var settings = webView.CoreWebView2.Environment.CreatePrintSettings();
        settings.PageWidth = MillimetersToInches(widthMm);
        settings.PageHeight = MillimetersToInches(heightMm);
        settings.Orientation = string.Equals(orientation, "landscape", StringComparison.OrdinalIgnoreCase)
            ? CoreWebView2PrintOrientation.Landscape
            : CoreWebView2PrintOrientation.Portrait;
        settings.MarginTop = 0;
        settings.MarginBottom = 0;
        settings.MarginLeft = 0;
        settings.MarginRight = 0;
        settings.ShouldPrintBackgrounds = true;
        settings.ShouldPrintHeaderAndFooter = false;
        settings.MediaSize = CoreWebView2PrintMediaSize.Custom;

        var printed = await webView.CoreWebView2.PrintToPdfAsync(path, settings);
        if (!printed)
        {
            throw new InvalidOperationException("WebView2 未能生成 PDF。");
        }
    }

    private static double MillimetersToInches(double millimeters) => Math.Max(1, millimeters) / 25.4d;

    private void SendExportResponse(string type, string requestId, object payload)
    {
        var json = JsonSerializer.Serialize(new
        {
            type,
            requestId,
            payload
        });
        webView.CoreWebView2.PostWebMessageAsJson(json);
    }

    private void BeginWindowDrag()
    {
        ReleaseCapture();
        SendMessage(Handle, WmNclbuttondown, HtCaption, 0);
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == WmNchittest)
        {
            base.WndProc(ref message);
            if ((int)message.Result == HtClient)
            {
                var point = PointToClient(Cursor.Position);
                var hitTest = GetChromeHitTest(point);
                if (hitTest != HtClient)
                {
                    message.Result = (IntPtr)hitTest;
                }
            }

            return;
        }

        base.WndProc(ref message);
    }

    private int GetChromeHitTest(Point point)
    {
        if (WindowState == FormWindowState.Normal)
        {
            var left = point.X <= ResizeBorderThickness;
            var right = point.X >= Width - ResizeBorderThickness;
            var top = point.Y <= ResizeBorderThickness;
            var bottom = point.Y >= Height - ResizeBorderThickness;

            if (left && top)
            {
                return HtTopLeft;
            }

            if (right && top)
            {
                return HtTopRight;
            }

            if (left && bottom)
            {
                return HtBottomLeft;
            }

            if (right && bottom)
            {
                return HtBottomRight;
            }

            if (left)
            {
                return HtLeft;
            }

            if (right)
            {
                return HtRight;
            }

            if (top)
            {
                return HtTop;
            }

            if (bottom)
            {
                return HtBottom;
            }
        }

        return HtClient;
    }

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);

    private sealed class WindowStateSnapshot
    {
        public int Left { get; init; }

        public int Top { get; init; }

        public int Width { get; init; }

        public int Height { get; init; }

        public bool IsMaximized { get; init; }
    }
}
