# YiboLabel

YiboLabel is a personal offline label printing application for Windows.

Its goal is to replace bloated vendor software with a simpler local-first tool that focuses on the core workflow only:

- connect to a label printer
- create and edit labels
- save templates locally
- print reliably

## Project Positioning

This is a self-use project.

The product does not aim to reproduce vendor cloud features such as:

- account login
- membership gating
- cloud sync
- online template marketplace
- team collaboration

Instead, YiboLabel should feel like a lightweight desktop tool that opens fast, works offline, and stays out of the way.

## First Principle

If a feature does not help complete the local label printing workflow, it should be treated as optional.

## Early Documents

- [Brainstorm](E:/Program/YiboLabel/docs/brainstorm.md)
- [MVP Scope](E:/Program/YiboLabel/docs/mvp.md)
- [Initial Notes](E:/Program/YiboLabel/docs/notes/2026-07-04-init.md)
- [Printer Validation](E:/Program/YiboLabel/docs/notes/2026-07-04-printer-validation.md)

## Print Probe

The repository includes a first Windows print probe for validating the local print path.

Project:

- `src/YiboLabel.PrintProbe`
- `src/YiboLabel.DllProbe`
- `src/YiboLabel.PrintCore`

Inspect printers without sending a print job:

```powershell
dotnet run --project src\YiboLabel.PrintProbe --
```

Send a physical test label to the default target printer:

```powershell
dotnet run --project src\YiboLabel.PrintProbe -- --print-test
```

Probe the direct USB path without using the Windows print queue:

```powershell
dotnet run --project src\YiboLabel.PrintProbe -- --probe-usb
```

Send a raw direct-USB command profile:

```powershell
dotnet run --project src\YiboLabel.PrintProbe -- --raw-profile tspl-text
dotnet run --project src\YiboLabel.PrintProbe -- --raw-profile tspl-solid
dotnet run --project src\YiboLabel.PrintProbe -- --raw-profile tspl-selftest
dotnet run --project src\YiboLabel.PrintProbe -- --raw-profile cpcl-text
```

Send a test label to a named Windows printer queue:

```powershell
dotnet run --project src\YiboLabel.PrintProbe -- --printer "HB-Q2(USB)" --print-test
```

## DLL Print Core

The validated vendor DLL path now lives in:

- `src/YiboLabel.PrintCore`

Current scope:

- open the vendor USB printer channel through `DPrintCore.dll`
- send raw TSPL payloads through `USBDeviceService`
- close the USB channel

The current probe entry that reuses the formal core is:

```powershell
& 'C:\Program Files (x86)\dotnet\dotnet.exe' 'E:\Program\YiboLabel\src\YiboLabel.DllProbe\bin\x86\Debug\net10.0-windows\YiboLabel.DllProbe.dll' send-usb-file 'E:\Program\YiboLabel\docs\notes\probe-hello-40x30.tspl'
```

## Formal App

The current formal application stack now includes:

- `src/YiboLabel.App`
  - local ASP.NET Core backend
  - template storage
  - TSPL generation
  - static frontend hosting
- `src/YiboLabel.App/ClientApp`
  - React + TypeScript label editor
- `src/YiboLabel.Desktop`
  - standalone Windows desktop host
  - embedded WebView2 window for the local UI
- `src/YiboLabel.PrintAgent`
  - x86 print worker that talks to `DPrintCore.dll`

Recommended startup flow:

```powershell
dotnet build 'E:\Program\YiboLabel\src\YiboLabel.PrintAgent\YiboLabel.PrintAgent.csproj' -p:Platform=x86
cd 'E:\Program\YiboLabel\src\YiboLabel.App\ClientApp'
npm run build
dotnet build 'E:\Program\YiboLabel\src\YiboLabel.Desktop\YiboLabel.Desktop.csproj'
dotnet run --project 'E:\Program\YiboLabel\src\YiboLabel.Desktop\YiboLabel.Desktop.csproj'
```

Or use the repo helper script:

```bat
E:\Program\YiboLabel\Start-YiboLabel.cmd
```

Browser-based debugging is still available if needed:

```powershell
dotnet run --project 'E:\Program\YiboLabel\src\YiboLabel.App\YiboLabel.App.csproj' --urls http://127.0.0.1:5076
```

Then open:

- `http://127.0.0.1:5076`
