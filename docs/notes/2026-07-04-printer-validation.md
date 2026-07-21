# Printer Validation - 2026-07-04

> Status: current validation record with historical test evidence.
> Current use: keep for printer queue, direct USB, vendor DLL, and print-agent validation context.

## Goal

Validate how the current label printer is connected and represented in Windows before building the first print proof of concept.

Target printer:

- `HB-Q2(USB)`

## Current Conclusion

The current printer is connected over USB and is registered in Windows as a local printer queue.

It is not currently being used through Bluetooth.

However, the latest validation shows that Windows queue visibility does not mean ordinary Windows printing is actually usable for this device.

The practical situation now looks like this:

1. Windows exposes a local queue `HB-Q2(USB)`
2. that queue uses driver `HB-Q2(USB) Driver`
3. the queue is bound to port `HB-Q2 USB:`
4. the port uses `USB Printer Monitor`
5. the underlying USB device is exposed through Microsoft `usbprint`
6. ordinary application print jobs can enter the queue but remain stuck without physical printing
7. the vendor software can still print successfully through a separate USB path

This means the first successful YiboLabel print path for `HB-Q2` should no longer assume that standard Windows queue printing is sufficient.

## Evidence

### Printer queue

`Get-Printer` reported:

- `Name`: `HB-Q2(USB)`
- `DriverName`: `HB-Q2(USB) Driver`
- `PortName`: `HB-Q2 USB:`
- `Type`: `Local`

### Printer port

`Get-PrinterPort` reported:

- `Name`: `HB-Q2 USB:`
- `Description`: `USB Printer Port`
- `PortMonitor`: `USB Printer Monitor`

This indicates the queue is attached to a USB printer monitor, not a TCP/IP port and not a Bluetooth transport.

### PnP / USB device

Windows reported these matching device identities:

- print queue: `HB-Q2(USB)`
- USB device friendly name: `HB- Q2`
- USB hardware id: `USB\\VID_28E9&PID_0285`
- service: `usbprint`

The driver data also exposed:

- `DevicePath`: `\\?\usb#vid_28e9&pid_0285#00000000011a#{28d78fad-5a12-11d1-ae5b-0000f803a8c2}`
- `VidAndPid`: `vid_28E9&pid_0285`
- `Port`: `USB`

### Driver shape

The installed driver is not a network-only shell.

Observed spool driver files:

- `HB-Q2.gpd`
- `HB-Q2Drv.dll`
- `HB-Q2UI.dll`
- `HB-Q2RES.dll`
- `HB-Q2.BUD`

The GPD file shows:

- resolution `203 x 203 dpi`
- monochrome output
- default label size `40mm x 30mm`
- support for custom size

This suggests Windows is using a printer driver layered on top of the normal print subsystem, with vendor-specific behavior provided by OEM driver files.

## Additional Findings After Print Probe

The custom print probe was able to:

- enumerate the printer
- target `HB-Q2(USB)`
- submit a print job into the Windows spool queue

But the printer did not physically print.

Observed symptoms:

- Windows queue retained the job
- job state appeared as unknown
- pages printed stayed at `0`
- the printer showed offline state in Windows
- another non-vendor job also remained stuck in the same way

At the same time, the vendor software was still able to print normally.

## Evidence From Vendor Software

The installed vendor software includes clear USB-specific printing components:

- `DPrintCore.dll`
- `USBApi.dll`
- `Qt5SerialPort.dll`

Its debug log shows vendor-side USB printing behavior rather than ordinary queue-only printing. Notable log lines included:

- `USBDeviceService::SearchUSBDevice`
- `strDevService = usbprint`
- `PrintService::startPrint|\\?\usb#vid_28e9&pid_0285#00000000011a#{a5dcbf10-6530-11d2-901f-00c04fb951ed}`
- `CommandPrintService::loadUSBApiModule|load ok.`
- `USBDeviceService::StartPrint|Send cmd =====> PRINT 1,2`

The vendor local config also stores device information instead of only relying on the Windows queue:

- `printer.ini` uses `printername=HB-Q2`
- `printmethod=1`
- `PrinterDefaultProperty.json` stores:
  - `printModel = HB-Q2`
  - `devicePath = \\?\usb#vid_28e9&pid_0285#00000000011a#{a5dcbf10-6530-11d2-901f-00c04fb951ed}`
  - `sdkId = 1`

These signals strongly suggest the vendor software uses a dedicated USB print path for this device family.

## What This Means For YiboLabel

For `HB-Q2`, the current lowest-risk route is now:

1. treat Windows printer enumeration as optional or secondary
2. treat direct USB device discovery as a first-class path
3. investigate the vendor command path or compatible protocol
4. only keep the Windows queue route as a fallback or compatibility layer

## Recommended Next Step

Shift the next technical validation to direct USB printing:

- identify how `HB-Q2` is opened by the vendor path
- inspect whether the device accepts raw command streams
- determine whether `USBApi.dll` can be called or whether its protocol can be reproduced
- capture the minimum command set needed for one printed label

## DLL Reuse Branch Note

At this point the investigation split into two viable reverse-engineering directions:

1. `PrintCoreModule` initialization path
2. reverse trace from the vendor executable into `DPrintCore.dll`, then reconstruct the service initialization order

The current active branch is route 1.

### Current DLL Findings

The vendor DLL route is now confirmed to be technically usable.

Observed facts:

- `DPrintCore.dll` exports:
  - `GetModuleObject`
  - `getCommandPrintServiceInterface`
  - `getPrintServiceInterface`
- `USBApi.dll` exports:
  - `GetUSBDeviceInterface`
  - `ReleaseUSBDeviceInterface`
- both DLLs are `x86`, so any direct integration probe must run as a 32-bit process

Validated object creation:

- `GetModuleObject` returns a real `PrintCoreModule` object
- `getCommandPrintServiceInterface` returns a real `CommandPrintService` object when called with an output pointer parameter
- `getPrintServiceInterface` returns a real `PrintService` object when called with an output pointer parameter
- `GetUSBDeviceInterface` returns a real `USBDeviceService` object when called with an output pointer parameter

Important correction:

- the service getters are not zero-argument functions
- they behave like C-style factory exports using an output pointer argument and returning a status code

### Current Initialization Finding

The first virtual function on `CommandPrintService` appears to be an initialization method.

Calling that slot with a null argument produced:

- `before init flag = 0`
- `init result = 1`
- `after init flag = 1`

This strongly suggests the object can be initialized in-process without launching the full vendor application.

### Current Fixed-Command Finding

The `USBDeviceService` vtable path is now stronger than earlier raw USB text tests suggested.

Refined understanding:

- slots such as `SELFTEST`, `INITIALPRINTER`, `EOJ`, and `CLS` are not simple string getters
- they are fixed-command methods that directly route into the vendor USB send path
- those wrappers call into the same internal send helper used by other printable commands

Validated runtime behavior:

- invoking slot `16` succeeds with return value `0`
- static analysis maps slot `16` to `INITIALPRINTER`
- invoking slot `15` succeeds with return value `0`
- static analysis maps slot `15` to `SELFTEST`

This means the active branch has moved past object creation and USB open validation.

We now have confirmed access to real vendor command entry points inside `USBDeviceService`.

## Active Branch Status

The active branch remains:

1. `PrintCoreModule` / `CommandPrintService` / `USBDeviceService`

The reserved alternative branch remains:

2. reverse trace from the vendor executable into `DPrintCore.dll`, then reconstruct who initializes which module first and how the service interface is fetched

The current evidence supports staying on branch 1 for now.
