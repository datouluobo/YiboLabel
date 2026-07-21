# YiboLabel

> 状态：当前项目入口。
> 范围：项目定位、核心工作流、启动命令、打印探针和详细文档入口。

YiboLabel 是一个面向 Windows 的个人离线标签打印工具。

项目目标是替代臃肿的厂商打印软件，只保留本地标签打印所需的核心流程：

- 连接标签打印机
- 创建和编辑标签
- 本地保存模板
- 稳定打印

## 项目定位

这是一个自用项目。

YiboLabel 不追求复刻厂商软件里的云端能力，例如：

- 账号登录
- 会员限制
- 云同步
- 在线模板市场
- 团队协作

它应该像一个轻量的本地桌面工具：打开快、离线可用、流程直接，不打扰用户完成打印任务。

## 第一原则

如果一个功能不能帮助完成本地标签打印流程，就应视为可选能力。

## 核心工作流

YiboLabel 区分“半一次性设置”和“当次打印操作”。

半一次性设置包括：

- 模板
- 词库
- 文档规格
- 打印机选择
- 打印校准

日常打印路径应尽量短：

- 打开模板
- 修改本次打印内容
- 调整份数
- 立即打印

`份数` 属于当次输出参数，应靠近快速打印控制，而不是藏在设置弹窗中。

## 文档

- [文档索引](E:/Program/YiboLabel/docs/README.md)
- [打印验证记录](E:/Program/YiboLabel/docs/notes/2026-07-04-printer-validation.md)

## 打印探针

仓库保留了 Windows 打印探针，用于验证本机打印链路。

相关项目：

- `src/YiboLabel.PrintProbe`
- `src/YiboLabel.DllProbe`
- `src/YiboLabel.PrintCore`

只查看系统打印机，不发送打印任务：

```powershell
dotnet run --project src\YiboLabel.PrintProbe --
```

向默认目标打印机发送物理测试标签：

```powershell
dotnet run --project src\YiboLabel.PrintProbe -- --print-test
```

验证不经过 Windows 打印队列的直连 USB 路径：

```powershell
dotnet run --project src\YiboLabel.PrintProbe -- --probe-usb
```

发送原始直连 USB 命令：

```powershell
dotnet run --project src\YiboLabel.PrintProbe -- --raw-profile tspl-text
dotnet run --project src\YiboLabel.PrintProbe -- --raw-profile tspl-solid
dotnet run --project src\YiboLabel.PrintProbe -- --raw-profile tspl-selftest
dotnet run --project src\YiboLabel.PrintProbe -- --raw-profile cpcl-text
```

向指定 Windows 打印队列发送测试标签：

```powershell
dotnet run --project src\YiboLabel.PrintProbe -- --printer "HB-Q2(USB)" --print-test
```

## 厂商 DLL 打印核心

已验证的厂商 DLL 打印路径位于：

- `src/YiboLabel.PrintCore`

当前职责：

- 通过 `DPrintCore.dll` 打开厂商 USB 打印通道
- 通过 `USBDeviceService` 发送原始 TSPL 数据
- 关闭 USB 通道

复用正式打印核心的探针入口：

```powershell
& 'C:\Program Files (x86)\dotnet\dotnet.exe' 'E:\Program\YiboLabel\src\YiboLabel.DllProbe\bin\x86\Debug\net10.0-windows\YiboLabel.DllProbe.dll' send-usb-file 'E:\Program\YiboLabel\docs\notes\probe-hello-40x30.tspl'
```

## 正式应用

当前正式应用结构：

- `src/YiboLabel.App`
  - 本地 ASP.NET Core 后端
  - 模板存储
  - TSPL 生成
  - 前端静态文件托管
- `src/YiboLabel.App/ClientApp`
  - React + TypeScript 标签编辑器
- `src/YiboLabel.Desktop`
  - Windows 桌面宿主
  - 内嵌 WebView2 窗口
- `src/YiboLabel.PrintAgent`
  - x86 打印工作进程
  - 调用 `DPrintCore.dll` 与本地打印机通信

推荐启动流程：

```powershell
dotnet build 'E:\Program\YiboLabel\src\YiboLabel.PrintAgent\YiboLabel.PrintAgent.csproj' -p:Platform=x86
cd 'E:\Program\YiboLabel\src\YiboLabel.App\ClientApp'
npm run build
dotnet build 'E:\Program\YiboLabel\src\YiboLabel.Desktop\YiboLabel.Desktop.csproj'
dotnet run --project 'E:\Program\YiboLabel\src\YiboLabel.Desktop\YiboLabel.Desktop.csproj'
```

也可以使用仓库脚本：

```bat
E:\Program\YiboLabel\Start-YiboLabel.cmd
```

如需浏览器调试：

```powershell
dotnet run --project 'E:\Program\YiboLabel\src\YiboLabel.App\YiboLabel.App.csproj' --urls http://127.0.0.1:5076
```

然后打开：

- `http://127.0.0.1:5076`
