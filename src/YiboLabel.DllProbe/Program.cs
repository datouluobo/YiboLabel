using System.Runtime.InteropServices;
using System.Text;
using YiboLabel.PrintCore;

var vendorDllDir = @"C:\Program Files (x86)\Dlabel";
var exportFilter = args.Length > 0 ? args[0] : null;

if (string.Equals(exportFilter, "test-command-init", StringComparison.Ordinal))
{
    NativeMethods.SetDllDirectory(vendorDllDir);
    RunCommandInitExperiment(Path.Combine(vendorDllDir, "DPrintCore.dll"));
    return;
}

if (string.Equals(exportFilter, "test-command-open-usb", StringComparison.Ordinal))
{
    NativeMethods.SetDllDirectory(vendorDllDir);
    RunCommandOpenUsbExperiment(Path.Combine(vendorDllDir, "DPrintCore.dll"));
    return;
}

if (string.Equals(exportFilter, "dump-usb-vtable", StringComparison.Ordinal))
{
    NativeMethods.SetDllDirectory(vendorDllDir);
    DumpUsbVtableExperiment(Path.Combine(vendorDllDir, "DPrintCore.dll"));
    return;
}

if (string.Equals(exportFilter, "dump-usb-command-slots", StringComparison.Ordinal))
{
    NativeMethods.SetDllDirectory(vendorDllDir);
    DumpUsbCommandSlotsExperiment(Path.Combine(vendorDllDir, "DPrintCore.dll"));
    return;
}

if (string.Equals(exportFilter, "send-usb-text", StringComparison.Ordinal))
{
    if (args.Length < 2)
    {
        Console.WriteLine("Usage: send-usb-text <text>");
        return;
    }

    NativeMethods.SetDllDirectory(vendorDllDir);
    SendUsbTextExperiment(Path.Combine(vendorDllDir, "DPrintCore.dll"), args[1]);
    return;
}

if (string.Equals(exportFilter, "send-usb-file", StringComparison.Ordinal))
{
    if (args.Length < 2)
    {
        Console.WriteLine("Usage: send-usb-file <path>");
        return;
    }

    var filePath = args[1];
    if (!File.Exists(filePath))
    {
        Console.WriteLine($"Missing file: {filePath}");
        return;
    }

    NativeMethods.SetDllDirectory(vendorDllDir);
    SendUsbTextExperiment(Path.Combine(vendorDllDir, "DPrintCore.dll"), File.ReadAllText(filePath, Encoding.ASCII));
    return;
}

if (string.Equals(exportFilter, "invoke-usb-slot", StringComparison.Ordinal))
{
    if (args.Length < 2 || !int.TryParse(args[1], out var slotIndex))
    {
        Console.WriteLine("Usage: invoke-usb-slot <slotIndex>");
        return;
    }

    NativeMethods.SetDllDirectory(vendorDllDir);
    InvokeUsbSlotExperiment(Path.Combine(vendorDllDir, "DPrintCore.dll"), slotIndex);
    return;
}

var dlls = new[]
{
    Path.Combine(vendorDllDir, "USBApi.dll"),
    Path.Combine(vendorDllDir, "DPrintCore.dll")
};

foreach (var dll in dlls)
{
    if (!File.Exists(dll))
    {
        Console.WriteLine($"Missing DLL: {dll}");
        return;
    }
}

Console.WriteLine("YiboLabel DLL Probe");
Console.WriteLine($"Bitness: {(Environment.Is64BitProcess ? "x64" : "x86")}");
Console.WriteLine();

NativeMethods.SetDllDirectory(vendorDllDir);

foreach (var dll in dlls)
{
    ProbeLibrary(dll, exportFilter);
    Console.WriteLine();
}

static void ProbeLibrary(string dllPath, string? exportFilter)
{
    Console.WriteLine($"Library: {dllPath}");

    var module = NativeMethods.LoadLibrary(dllPath);
    if (module == IntPtr.Zero)
    {
        PrintLastError("LoadLibrary failed");
        return;
    }

    Console.WriteLine($"  moduleBase: 0x{module.ToInt32():X8}");

    try
    {
        foreach (var exportName in GetKnownExports(Path.GetFileName(dllPath)))
        {
            if (exportFilter is not null && !string.Equals(exportFilter, exportName, StringComparison.Ordinal))
            {
                continue;
            }

            ProbeExport(module, exportName);
        }
    }
    finally
    {
        NativeMethods.FreeLibrary(module);
    }
}

static void RunCommandInitExperiment(string dllPath)
{
    Console.WriteLine("YiboLabel DLL Probe");
    Console.WriteLine($"Bitness: {(Environment.Is64BitProcess ? "x64" : "x86")}");
    Console.WriteLine("Experiment: CommandPrintService.Init");
    Console.WriteLine();

    var module = NativeMethods.LoadLibrary(dllPath);
    if (module == IntPtr.Zero)
    {
        PrintLastError("LoadLibrary failed");
        return;
    }

    try
    {
        Console.WriteLine($"moduleBase: 0x{module.ToInt32():X8}");
        var proc = NativeMethods.GetProcAddress(module, "getCommandPrintServiceInterface");
        if (proc == IntPtr.Zero)
        {
            Console.WriteLine("getCommandPrintServiceInterface not found");
            return;
        }

        var create = Marshal.GetDelegateForFunctionPointer<CreateInterfaceFn>(proc);
        var result = create(out var service);
        Console.WriteLine($"create result: {result}");
        Console.WriteLine($"service: 0x{service.ToInt32():X8}");
        if (service == IntPtr.Zero)
        {
            return;
        }

        var vtable = Marshal.ReadIntPtr(service);
        Console.WriteLine($"vtable: 0x{vtable.ToInt32():X8}");
        var slot0 = Marshal.ReadIntPtr(vtable, 0);
        var slot2 = Marshal.ReadIntPtr(vtable, IntPtr.Size * 2);
        Console.WriteLine($"slot0: 0x{slot0.ToInt32():X8}");
        Console.WriteLine($"slot2: 0x{slot2.ToInt32():X8}");

        var init = Marshal.GetDelegateForFunctionPointer<ThisCallIntPtrArgFn>(slot0);
        var isInit = Marshal.GetDelegateForFunctionPointer<ThisCallByteFn>(slot2);

        Console.WriteLine($"before init flag: {isInit(service)}");
        Console.WriteLine($"before [+0x28]: 0x{Marshal.ReadIntPtr(service, 0x28).ToInt32():X8}");
        Console.WriteLine($"before [+0x2C]: 0x{Marshal.ReadIntPtr(service, 0x2C).ToInt32():X8}");

        var initResult = init(service, IntPtr.Zero);
        Console.WriteLine($"init result: {initResult}");

        Console.WriteLine($"after init flag: {isInit(service)}");
        Console.WriteLine($"after [+0x28]: 0x{Marshal.ReadIntPtr(service, 0x28).ToInt32():X8}");
        Console.WriteLine($"after [+0x2C]: 0x{Marshal.ReadIntPtr(service, 0x2C).ToInt32():X8}");
    }
    finally
    {
        NativeMethods.FreeLibrary(module);
    }
}

static void RunCommandOpenUsbExperiment(string dllPath)
{
    const string devicePath = @"\\?\usb#vid_28e9&pid_0285#00000000011a#{a5dcbf10-6530-11d2-901f-00c04fb951ed}";

    Console.WriteLine("YiboLabel DLL Probe");
    Console.WriteLine($"Bitness: {(Environment.Is64BitProcess ? "x64" : "x86")}");
    Console.WriteLine("Experiment: CommandPrintService -> USBDeviceService -> OpenUSBDevice");
    Console.WriteLine();

    var module = NativeMethods.LoadLibrary(dllPath);
    if (module == IntPtr.Zero)
    {
        PrintLastError("LoadLibrary failed");
        return;
    }

    try
    {
        var proc = NativeMethods.GetProcAddress(module, "getCommandPrintServiceInterface");
        if (proc == IntPtr.Zero)
        {
            Console.WriteLine("getCommandPrintServiceInterface not found");
            return;
        }

        var create = Marshal.GetDelegateForFunctionPointer<CreateInterfaceFn>(proc);
        var createResult = create(out var service);
        Console.WriteLine($"create result: {createResult}");
        Console.WriteLine($"service: 0x{service.ToInt32():X8}");
        if (service == IntPtr.Zero)
        {
            return;
        }

        var serviceVtable = Marshal.ReadIntPtr(service);
        var initSlot = Marshal.ReadIntPtr(serviceVtable, 0);
        var init = Marshal.GetDelegateForFunctionPointer<ThisCallIntPtrArgFn>(initSlot);
        var initResult = init(service, IntPtr.Zero);
        Console.WriteLine($"init result: {initResult}");

        var usbService = Marshal.ReadIntPtr(service, 0x2C);
        Console.WriteLine($"usb service: 0x{usbService.ToInt32():X8}");
        if (usbService == IntPtr.Zero)
        {
            return;
        }

        var usbVtable = Marshal.ReadIntPtr(usbService);
        var openSlot = Marshal.ReadIntPtr(usbVtable, IntPtr.Size * 6);
        Console.WriteLine($"usb slot6: 0x{openSlot.ToInt32():X8}");

        var open = Marshal.GetDelegateForFunctionPointer<ThisCallStringArgFn>(openSlot);
        var openResult = open(usbService, devicePath);
        Console.WriteLine($"open result: {openResult}");
    }
    finally
    {
        NativeMethods.FreeLibrary(module);
    }
}

static void DumpUsbVtableExperiment(string dllPath)
{
    Console.WriteLine("YiboLabel DLL Probe");
    Console.WriteLine($"Bitness: {(Environment.Is64BitProcess ? "x64" : "x86")}");
    Console.WriteLine("Experiment: Dump USBDeviceService vtable");
    Console.WriteLine();

    var module = NativeMethods.LoadLibrary(dllPath);
    if (module == IntPtr.Zero)
    {
        PrintLastError("LoadLibrary failed");
        return;
    }

    try
    {
        var proc = NativeMethods.GetProcAddress(module, "getCommandPrintServiceInterface");
        if (proc == IntPtr.Zero)
        {
            Console.WriteLine("getCommandPrintServiceInterface not found");
            return;
        }

        var create = Marshal.GetDelegateForFunctionPointer<CreateInterfaceFn>(proc);
        var createResult = create(out var service);
        Console.WriteLine($"create result: {createResult}");
        Console.WriteLine($"service: 0x{service.ToInt32():X8}");
        if (service == IntPtr.Zero)
        {
            return;
        }

        var serviceVtable = Marshal.ReadIntPtr(service);
        var initSlot = Marshal.ReadIntPtr(serviceVtable, 0);
        var init = Marshal.GetDelegateForFunctionPointer<ThisCallIntPtrArgFn>(initSlot);
        var initResult = init(service, IntPtr.Zero);
        Console.WriteLine($"init result: {initResult}");

        var usbService = Marshal.ReadIntPtr(service, 0x2C);
        Console.WriteLine($"usb service: 0x{usbService.ToInt32():X8}");
        if (usbService == IntPtr.Zero)
        {
            return;
        }

        var usbVtable = Marshal.ReadIntPtr(usbService);
        Console.WriteLine($"usb vtable: 0x{usbVtable.ToInt32():X8}");
        for (var index = 0; index < 44; index++)
        {
            var slot = Marshal.ReadIntPtr(usbVtable, index * IntPtr.Size);
            Console.WriteLine($"  [{index,2}] 0x{slot.ToInt32():X8}");
        }
    }
    finally
    {
        NativeMethods.FreeLibrary(module);
    }
}

static void DumpUsbCommandSlotsExperiment(string dllPath)
{
    Console.WriteLine("YiboLabel DLL Probe");
    Console.WriteLine($"Bitness: {(Environment.Is64BitProcess ? "x64" : "x86")}");
    Console.WriteLine("Experiment: Dump USBDeviceService command slots");
    Console.WriteLine();

    var module = NativeMethods.LoadLibrary(dllPath);
    if (module == IntPtr.Zero)
    {
        PrintLastError("LoadLibrary failed");
        return;
    }

    try
    {
        if (!TryCreateOpenedUsbService(module, out var usbService))
        {
            return;
        }

        var usbVtable = Marshal.ReadIntPtr(usbService);
        var slots = new (int Index, string Label)[]
        {
            (15, "slot15"),
            (16, "slot16"),
            (28, "slot28"),
            (30, "slot30"),
            (31, "slot31")
        };

        foreach (var slotInfo in slots)
        {
            var slot = Marshal.ReadIntPtr(usbVtable, slotInfo.Index * IntPtr.Size);
            var getText = Marshal.GetDelegateForFunctionPointer<ThisCallStringResultFn>(slot);
            var text = Marshal.PtrToStringAnsi(getText(usbService)) ?? "<null>";
            Console.WriteLine($"{slotInfo.Label}: 0x{slot.ToInt32():X8} => {text}");
        }
    }
    finally
    {
        NativeMethods.FreeLibrary(module);
    }
}

static void SendUsbTextExperiment(string dllPath, string text)
{
    Console.WriteLine("YiboLabel DLL Probe");
    Console.WriteLine($"Bitness: {(Environment.Is64BitProcess ? "x64" : "x86")}");
    Console.WriteLine("Experiment: USBDeviceService.SendDataPacket");
    Console.WriteLine();

    try
    {
        using var channel = VendorDllPrinterChannel.Open(@"\\?\usb#vid_28e9&pid_0285#00000000011a#{a5dcbf10-6530-11d2-901f-00c04fb951ed}", Path.GetDirectoryName(dllPath));
        var normalizedText = text.Replace("\r", "\\r", StringComparison.Ordinal).Replace("\n", "\\n", StringComparison.Ordinal);
        Console.WriteLine($"device path: {channel.DevicePath}");
        Console.WriteLine($"payload: {normalizedText}");
        channel.SendRaw(text);
        Console.WriteLine("send result: 0");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"send failed: {ex.GetType().Name}: {ex.Message}");
    }
}

static void InvokeUsbSlotExperiment(string dllPath, int slotIndex)
{
    Console.WriteLine("YiboLabel DLL Probe");
    Console.WriteLine($"Bitness: {(Environment.Is64BitProcess ? "x64" : "x86")}");
    Console.WriteLine("Experiment: Invoke USBDeviceService fixed command slot");
    Console.WriteLine();

    var module = NativeMethods.LoadLibrary(dllPath);
    if (module == IntPtr.Zero)
    {
        PrintLastError("LoadLibrary failed");
        return;
    }

    try
    {
        if (!TryCreateOpenedUsbService(module, out var usbService))
        {
            return;
        }

        var usbVtable = Marshal.ReadIntPtr(usbService);
        var slot = Marshal.ReadIntPtr(usbVtable, slotIndex * IntPtr.Size);
        var invoke = Marshal.GetDelegateForFunctionPointer<ThisCallNoArgIntFn>(slot);
        Console.WriteLine($"slot[{slotIndex}]: 0x{slot.ToInt32():X8}");
        var result = invoke(usbService);
        Console.WriteLine($"result: {result}");
    }
    finally
    {
        NativeMethods.FreeLibrary(module);
    }
}

static bool TryCreateOpenedUsbService(IntPtr module, out IntPtr usbService)
{
    const string devicePath = @"\\?\usb#vid_28e9&pid_0285#00000000011a#{a5dcbf10-6530-11d2-901f-00c04fb951ed}";

    usbService = IntPtr.Zero;

    var proc = NativeMethods.GetProcAddress(module, "getCommandPrintServiceInterface");
    if (proc == IntPtr.Zero)
    {
        Console.WriteLine("getCommandPrintServiceInterface not found");
        return false;
    }

    var create = Marshal.GetDelegateForFunctionPointer<CreateInterfaceFn>(proc);
    var createResult = create(out var service);
    Console.WriteLine($"create result: {createResult}");
    Console.WriteLine($"service: 0x{service.ToInt32():X8}");
    if (service == IntPtr.Zero)
    {
        return false;
    }

    var serviceVtable = Marshal.ReadIntPtr(service);
    var initSlot = Marshal.ReadIntPtr(serviceVtable, 0);
    var init = Marshal.GetDelegateForFunctionPointer<ThisCallIntPtrArgFn>(initSlot);
    var initResult = init(service, IntPtr.Zero);
    Console.WriteLine($"init result: {initResult}");

    usbService = Marshal.ReadIntPtr(service, 0x2C);
    Console.WriteLine($"usb service: 0x{usbService.ToInt32():X8}");
    if (usbService == IntPtr.Zero)
    {
        return false;
    }

    var usbVtable = Marshal.ReadIntPtr(usbService);
    var openSlot = Marshal.ReadIntPtr(usbVtable, IntPtr.Size * 6);
    var open = Marshal.GetDelegateForFunctionPointer<ThisCallStringArgFn>(openSlot);
    var openResult = open(usbService, devicePath);
    Console.WriteLine($"open result: {openResult}");
    return openResult == 0;
}

static IEnumerable<string> GetKnownExports(string fileName)
{
    return fileName switch
    {
        "USBApi.dll" => new[] { "GetUSBDeviceInterface", "ReleaseUSBDeviceInterface" },
        "DPrintCore.dll" => new[]
        {
            "GetModuleObject",
            "getCommandPrintServiceInterface",
            "getPrintServiceInterface",
            "releaseCommandPrintServiceInterface",
            "releasePrintServiceInterface"
        },
        _ => Array.Empty<string>()
    };
}

static void ProbeExport(IntPtr module, string exportName)
{
    var proc = NativeMethods.GetProcAddress(module, exportName);
    if (proc == IntPtr.Zero)
    {
        Console.WriteLine($"- {exportName}: export not found");
        return;
    }

    Console.WriteLine($"- {exportName}: {proc}");

    if (exportName.StartsWith("release", StringComparison.OrdinalIgnoreCase) || exportName == "ReleaseUSBDeviceInterface")
    {
        Console.WriteLine("  release export skipped");
        return;
    }

    if (exportName == "GetModuleObject")
    {
        var zeroArg = Marshal.GetDelegateForFunctionPointer<ZeroArgFn>(proc);
        IntPtr instance;

        try
        {
            instance = zeroArg();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  call failed: {ex.GetType().Name}: {ex.Message}");
            return;
        }

        Console.WriteLine($"  returned: 0x{instance.ToInt32():X8}");

        if (instance == IntPtr.Zero)
        {
            Console.WriteLine("  null pointer");
            return;
        }

        DescribeObject(instance);
        return;
    }

    if (exportName == "GetUSBDeviceInterface")
    {
        var createUsb = Marshal.GetDelegateForFunctionPointer<CreateInterfaceFn>(proc);
        IntPtr usbOut = IntPtr.Zero;
        int usbResult;

        try
        {
            usbResult = createUsb(out usbOut);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  call failed: {ex.GetType().Name}: {ex.Message}");
            return;
        }

        Console.WriteLine($"  result: {usbResult}");
        Console.WriteLine($"  out: 0x{usbOut.ToInt32():X8}");

        if (usbOut == IntPtr.Zero)
        {
            Console.WriteLine("  null pointer");
            return;
        }

        DescribeObject(usbOut);
        return;
    }

    var create = Marshal.GetDelegateForFunctionPointer<CreateInterfaceFn>(proc);
    IntPtr instanceOut = IntPtr.Zero;
    int result;

    try
    {
        result = create(out instanceOut);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"  call failed: {ex.GetType().Name}: {ex.Message}");
        return;
    }

    Console.WriteLine($"  result: {result}");
    Console.WriteLine($"  out: 0x{instanceOut.ToInt32():X8}");

    if (instanceOut == IntPtr.Zero)
    {
        Console.WriteLine("  null pointer");
        return;
    }

    DescribeObject(instanceOut);
}

static unsafe void DescribeObject(IntPtr instance)
{
    try
    {
        var vtable = Marshal.ReadIntPtr(instance);
        Console.WriteLine($"  vtable: 0x{vtable.ToInt32():X8}");

        // MSVC x86 RTTI layout: [vftable - 4] points to CompleteObjectLocator
        var colPtr = Marshal.ReadIntPtr(vtable, -4);
        Console.WriteLine($"  col: 0x{colPtr.ToInt32():X8}");

        if (colPtr == IntPtr.Zero)
        {
            Console.WriteLine("  no RTTI locator");
            return;
        }

        var typeDescriptor = Marshal.ReadIntPtr(colPtr, 12);
        Console.WriteLine($"  typeDescriptor: 0x{typeDescriptor.ToInt32():X8}");

        if (typeDescriptor == IntPtr.Zero)
        {
            Console.WriteLine("  no type descriptor");
            return;
        }

        var mangledName = ReadAsciiZ(typeDescriptor + 8, 256);
        Console.WriteLine($"  rtti: {mangledName}");

        Console.WriteLine("  vtable slots:");
        for (var index = 0; index < 12; index++)
        {
            var slot = Marshal.ReadIntPtr(vtable, index * IntPtr.Size);
            Console.WriteLine($"    [{index,2}] 0x{slot.ToInt32():X8}");
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"  RTTI read failed: {ex.GetType().Name}: {ex.Message}");
    }
}

static string ReadAsciiZ(IntPtr address, int maxLength)
{
    var bytes = new List<byte>(maxLength);

    for (var index = 0; index < maxLength; index++)
    {
        var value = Marshal.ReadByte(address, index);
        if (value == 0)
        {
            break;
        }

        bytes.Add(value);
    }

    return Encoding.ASCII.GetString(bytes.ToArray());
}

static void PrintLastError(string prefix)
{
    var error = Marshal.GetLastWin32Error();
    Console.WriteLine($"{prefix}: {error} ({new System.ComponentModel.Win32Exception(error).Message})");
}

[UnmanagedFunctionPointer(CallingConvention.Cdecl)]
delegate IntPtr ZeroArgFn();

[UnmanagedFunctionPointer(CallingConvention.Cdecl)]
delegate int CreateInterfaceFn(out IntPtr instance);

[UnmanagedFunctionPointer(CallingConvention.ThisCall)]
delegate int ThisCallIntPtrArgFn(IntPtr @this, IntPtr arg1);

[UnmanagedFunctionPointer(CallingConvention.ThisCall)]
delegate byte ThisCallByteFn(IntPtr @this);

[UnmanagedFunctionPointer(CallingConvention.ThisCall, CharSet = CharSet.Ansi)]
delegate int ThisCallStringArgFn(IntPtr @this, string text);

[UnmanagedFunctionPointer(CallingConvention.ThisCall)]
delegate IntPtr ThisCallStringResultFn(IntPtr @this);

[UnmanagedFunctionPointer(CallingConvention.ThisCall)]
delegate int ThisCallNoArgIntFn(IntPtr @this);

static class NativeMethods
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
