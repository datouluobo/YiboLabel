using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace YiboLabel.PrintCore;

public sealed class VendorDllPrinterChannel : IDisposable
{
    private const int UsbServiceOffset = 0x2C;
    private readonly IntPtr moduleHandle;
    private readonly IntPtr commandService;
    private readonly IntPtr usbService;
    private bool disposed;

    private VendorDllPrinterChannel(string vendorDllDirectory, IntPtr moduleHandle, IntPtr commandService, IntPtr usbService, string devicePath)
    {
        VendorDllDirectory = vendorDllDirectory;
        DevicePath = devicePath;
        this.moduleHandle = moduleHandle;
        this.commandService = commandService;
        this.usbService = usbService;
    }

    public string VendorDllDirectory { get; }

    public string DevicePath { get; }

    public static VendorDllPrinterChannel Open(string devicePath, string? vendorDllDirectory = null)
    {
        if (string.IsNullOrWhiteSpace(devicePath))
        {
            throw new ArgumentException("Device path is required.", nameof(devicePath));
        }

        var resolvedVendorDllDirectory = string.IsNullOrWhiteSpace(vendorDllDirectory) ? VendorDllDefaults.InstallDirectory : vendorDllDirectory;
        if (!Directory.Exists(resolvedVendorDllDirectory))
        {
            throw new DirectoryNotFoundException($"Vendor DLL directory was not found: {resolvedVendorDllDirectory}");
        }

        if (!NativeMethods.SetDllDirectory(resolvedVendorDllDirectory))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), $"Failed to set DLL directory: {resolvedVendorDllDirectory}");
        }

        var dllPath = Path.Combine(resolvedVendorDllDirectory, "DPrintCore.dll");
        var moduleHandle = NativeMethods.LoadLibrary(dllPath);
        if (moduleHandle == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), $"Failed to load library: {dllPath}");
        }

        try
        {
            var createProc = NativeMethods.GetProcAddress(moduleHandle, "getCommandPrintServiceInterface");
            if (createProc == IntPtr.Zero)
            {
                throw new MissingMethodException("DPrintCore.dll", "getCommandPrintServiceInterface");
            }

            var create = Marshal.GetDelegateForFunctionPointer<CreateInterfaceFn>(createProc);
            var createResult = create(out var commandService);
            if (createResult != 0 || commandService == IntPtr.Zero)
            {
                throw new InvalidOperationException($"Creating CommandPrintService failed. result={createResult}");
            }

            var serviceVtable = Marshal.ReadIntPtr(commandService);
            var initSlot = Marshal.ReadIntPtr(serviceVtable, 0);
            var init = Marshal.GetDelegateForFunctionPointer<ThisCallIntPtrArgFn>(initSlot);
            var initResult = init(commandService, IntPtr.Zero);
            if (initResult != 1)
            {
                throw new InvalidOperationException($"Initializing CommandPrintService failed. result={initResult}");
            }

            var usbService = Marshal.ReadIntPtr(commandService, UsbServiceOffset);
            if (usbService == IntPtr.Zero)
            {
                throw new InvalidOperationException("USBDeviceService pointer was not initialized.");
            }

            var usbVtable = Marshal.ReadIntPtr(usbService);
            var openSlot = Marshal.ReadIntPtr(usbVtable, IntPtr.Size * 6);
            var open = Marshal.GetDelegateForFunctionPointer<ThisCallStringArgFn>(openSlot);
            var openResult = open(usbService, devicePath);
            if (openResult != 0)
            {
                throw new InvalidOperationException($"Opening USB device failed. result={openResult}");
            }

            return new VendorDllPrinterChannel(resolvedVendorDllDirectory, moduleHandle, commandService, usbService, devicePath);
        }
        catch
        {
            NativeMethods.FreeLibrary(moduleHandle);
            throw;
        }
    }

    public void SendRaw(string text)
    {
        ObjectDisposedException.ThrowIf(disposed, this);

        if (text is null)
        {
            throw new ArgumentNullException(nameof(text));
        }

        SendRaw(Encoding.ASCII.GetBytes(NormalizeLineEndings(text)));
    }

    public void SendRaw(byte[] payload)
    {
        ObjectDisposedException.ThrowIf(disposed, this);

        if (payload is null)
        {
            throw new ArgumentNullException(nameof(payload));
        }

        if (payload.Length == 0)
        {
            throw new ArgumentException("Payload cannot be empty.", nameof(payload));
        }

        var usbVtable = Marshal.ReadIntPtr(usbService);
        var sendSlot = Marshal.ReadIntPtr(usbVtable, IntPtr.Size * 12);
        var send = Marshal.GetDelegateForFunctionPointer<ThisCallBufferIntFn>(sendSlot);
        var handle = GCHandle.Alloc(payload, GCHandleType.Pinned);

        try
        {
            var result = send(usbService, handle.AddrOfPinnedObject(), payload.Length);
            if (result != 0)
            {
                throw new InvalidOperationException($"Sending USB payload failed. result={result}");
            }
        }
        finally
        {
            handle.Free();
        }
    }

    public void Dispose()
    {
        if (disposed)
        {
            return;
        }

        disposed = true;

        try
        {
            if (usbService != IntPtr.Zero)
            {
                var usbVtable = Marshal.ReadIntPtr(usbService);
                var closeSlot = Marshal.ReadIntPtr(usbVtable, IntPtr.Size * 9);
                var close = Marshal.GetDelegateForFunctionPointer<ThisCallNoArgIntFn>(closeSlot);
                close(usbService);
            }
        }
        catch
        {
            // Best-effort cleanup. We still unload the module below.
        }

        if (moduleHandle != IntPtr.Zero)
        {
            NativeMethods.FreeLibrary(moduleHandle);
        }
    }

    private static string NormalizeLineEndings(string text)
    {
        var normalizedText = text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace("\r", "\n", StringComparison.Ordinal);
        return normalizedText.EndsWith('\n')
            ? normalizedText.Replace("\n", "\r\n", StringComparison.Ordinal)
            : normalizedText.Replace("\n", "\r\n", StringComparison.Ordinal) + "\r\n";
    }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int CreateInterfaceFn(out IntPtr instance);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    private delegate int ThisCallIntPtrArgFn(IntPtr @this, IntPtr arg1);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall, CharSet = CharSet.Ansi)]
    private delegate int ThisCallStringArgFn(IntPtr @this, string text);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    private delegate int ThisCallBufferIntFn(IntPtr @this, IntPtr buffer, int size);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    private delegate int ThisCallNoArgIntFn(IntPtr @this);

    private static class NativeMethods
    {
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool SetDllDirectory(string lpPathName);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern IntPtr LoadLibrary(string lpFileName);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool FreeLibrary(IntPtr hModule);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Ansi)]
        public static extern IntPtr GetProcAddress(IntPtr hModule, string lpProcName);
    }
}
