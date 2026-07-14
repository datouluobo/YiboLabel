using System.Diagnostics;
using System.Text;
using YiboLabel.App.Models;

namespace YiboLabel.App.Services;

public sealed class PrintAgentClient
{
    private readonly TsplBuilder tsplBuilder;
    private readonly TemplateStore templateStore;

    public PrintAgentClient(TsplBuilder tsplBuilder, TemplateStore templateStore)
    {
        this.tsplBuilder = tsplBuilder;
        this.templateStore = templateStore;
    }

    public async Task<PrintResult> PrintAsync(LabelDocument document, string devicePath, CancellationToken cancellationToken)
    {
        var jobDirectory = Path.Combine(templateStore.RootDirectory, "jobs");
        Directory.CreateDirectory(jobDirectory);

        var tsplPath = Path.Combine(jobDirectory, $"job-{DateTimeOffset.Now:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}.tspl");
        await File.WriteAllBytesAsync(tsplPath, tsplBuilder.Build(document), cancellationToken);

        var agentLaunch = ResolveAgentLaunch();
        var startInfo = new ProcessStartInfo
        {
            FileName = agentLaunch.FileName,
            Arguments = agentLaunch.BuildArguments(tsplPath, devicePath),
            WorkingDirectory = agentLaunch.WorkingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Failed to start print agent.");
        var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);

        await process.WaitForExitAsync(cancellationToken);

        var combinedOutput = new StringBuilder();
        combinedOutput.AppendLine((await outputTask).Trim());

        var error = (await errorTask).Trim();
        if (!string.IsNullOrWhiteSpace(error))
        {
            combinedOutput.AppendLine(error);
        }

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"Print agent failed with code {process.ExitCode}:{Environment.NewLine}{combinedOutput.ToString().Trim()}");
        }

        return new PrintResult
        {
            DevicePath = devicePath,
            Copies = document.Copies,
            TsplPath = tsplPath,
            AgentOutput = combinedOutput.ToString().Trim()
        };
    }

    public async Task<PrinterProbeResult> ProbeAsync(string devicePath, CancellationToken cancellationToken)
    {
        try
        {
            var agentLaunch = ResolveAgentLaunch();
            var startInfo = new ProcessStartInfo
            {
                FileName = agentLaunch.FileName,
                Arguments = agentLaunch.BuildProbeArguments(devicePath),
                WorkingDirectory = agentLaunch.WorkingDirectory,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Failed to start print agent.");
            var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);

            var output = (await outputTask).Trim();
            var error = (await errorTask).Trim();
            var message = string.IsNullOrWhiteSpace(error) ? output : error;
            return new PrinterProbeResult(process.ExitCode == 0, string.IsNullOrWhiteSpace(message) ? "打印机无响应。" : message);
        }
        catch (Exception ex)
        {
            return new PrinterProbeResult(false, ex.Message);
        }
    }

    private static AgentLaunch ResolveAgentLaunch()
    {
        var directExe = Path.Combine(AppContext.BaseDirectory, "YiboLabel.PrintAgent.exe");
        if (File.Exists(directExe))
        {
            return new AgentLaunch(directExe, Path.GetDirectoryName(directExe) ?? AppContext.BaseDirectory);
        }

        var repoExe = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "YiboLabel.PrintAgent", "bin", "x86", "Debug", "net10.0-windows", "YiboLabel.PrintAgent.exe"));
        if (File.Exists(repoExe))
        {
            return new AgentLaunch(repoExe, Path.GetDirectoryName(repoExe) ?? AppContext.BaseDirectory);
        }

        var repoDll = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "YiboLabel.PrintAgent", "bin", "x86", "Debug", "net10.0-windows", "YiboLabel.PrintAgent.dll"));
        var x86Dotnet = @"C:\Program Files (x86)\dotnet\dotnet.exe";
        if (File.Exists(repoDll) && File.Exists(x86Dotnet))
        {
            return new AgentLaunch(x86Dotnet, Path.GetDirectoryName(repoDll) ?? AppContext.BaseDirectory, repoDll);
        }

        throw new FileNotFoundException("未找到打印代理，请先构建 YiboLabel.PrintAgent。");
    }

    private sealed record AgentLaunch(string FileName, string WorkingDirectory, string? ManagedAssemblyPath = null)
    {
        public string BuildArguments(string tsplPath, string devicePath)
        {
            return ManagedAssemblyPath is null
                ? $"print-file \"{tsplPath}\" \"{devicePath}\""
                : $"\"{ManagedAssemblyPath}\" print-file \"{tsplPath}\" \"{devicePath}\"";
        }

        public string BuildProbeArguments(string devicePath)
        {
            return ManagedAssemblyPath is null
                ? $"probe \"{devicePath}\""
                : $"\"{ManagedAssemblyPath}\" probe \"{devicePath}\"";
        }
    }
}

public sealed record PrinterProbeResult(bool IsAvailable, string Message);
