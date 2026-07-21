# 模板 / 草稿 / 退出确认设计规则

> 状态：当前设计参考。
> 日期：2026-07-16
> 当前用途：保留模板、草稿、保存、关闭 tab 和退出确认的产品语义。

## 1. 背景

当前项目已经具备一部分正确方向：

- 打开模板会进入编辑 tab，而不是直接改模板文件
- 新建和导入默认都是 `templateId: null`
- 已经有 tab 脏状态判断
- 已经有浏览器层 `beforeunload` 兜底

但当前仍有几个明显混淆点：

- `模板库` 页面里同时承载了 `新建` 和 `导入`
- `保存` 在 UI 上仍像一个多义词
- 当前只区分了 `是否绑定模板`，没区分 `空白草稿` 和 `导入草稿`
- 关闭单个 tab 与关闭程序时，保存确认不够细

这份文档的目标不是重写编辑器，而是在现有结构上完成语义收敛。

## 2. 最终产品规则

### 2.1 核心原则

只有一条总规则：

`新建` 和 `导入` 产生的都先是草稿；只有明确执行 `另存为模板`，内容才进入模板库。

### 2.2 三类对象

#### Template

模板是模板库中的持久化文件。

用户可对模板做：

- 打开
- 复制
- 重命名
- 删除

模板库不负责：

- 当前 tab 是否脏
- 多 tab 编辑状态
- 当前文档是否应自动保存

#### Draft

草稿是当前正在编辑的工作副本。

草稿承担：

- 画布编辑
- 撤销重做
- 选中状态
- dirty 判断
- 关闭前确认

#### Import

导入是“把外部文件转换成一个草稿”的动作。

导入后结果：

- 直接进入编辑器
- 默认不进入模板库
- 默认没有 `templateId`

## 3. 状态模型

## 3.1 EditorTab 新字段

在现有 `EditorTab` 基础上增加来源字段。

文件：

- `src/YiboLabel.App/ClientApp/src/domain/workspace.ts`

建议定义：

```ts
export type EditorTabOrigin = 'blank' | 'imported' | 'template'
```

并在 `EditorTab` 中增加：

```ts
origin: EditorTabOrigin
```

`ClosedTabSnapshot` 与 `WorkspaceSnapshot.tabs[]` 也同步增加 `origin`。

### 3.2 origin 语义

- `blank`
  由 `新建` 产生的未绑定草稿
- `imported`
  由 `导入` 产生的未绑定草稿
- `template`
  由 `打开模板` 或 `另存为模板成功后` 产生的模板草稿

### 3.3 为什么不能只靠 templateId

仅靠 `templateId === null` 只能判断“未绑定模板”，但还无法区分：

- 这是从空白新建来的
- 这是从外部导入来的

而这两者在文案、状态条、关闭提示里都应该有不同表达。

### 3.4 删除已绑定模板后的 origin 处理

删除模板后，当前已打开内容应保留为未绑定草稿。

此处有两个实现方案：

#### 方案 A：最小改动

- `templateId = null`
- `origin` 保持 `template`

优点：

- 改动最小

缺点：

- UI 文案需要特判，否则会出现“模板草稿但没有模板”的怪状态

#### 方案 B：推荐

扩展为：

```ts
export type EditorTabOrigin = 'blank' | 'imported' | 'template' | 'detached'
```

其中 `detached` 表示：

- 原本来自模板
- 当前模板已被删除或解绑
- 现内容仍保留为一个未绑定草稿

推荐采用方案 B，因为它能把删除模板后的状态表达清楚，避免到处写例外判断。

如果本轮想严格控范围，也可以先用方案 A，但要在文案函数里统一兜住。

## 4. 状态显示规格

## 4.1 显示位置

当前代码里有两处状态展示候选：

- `WorkspaceTopbar.tsx`
- `EditorCanvasPanel.tsx`

建议：

- 顶部 `WorkspaceTopbar` 继续显示全局 badge
- `EditorCanvasPanel` 保留编辑区内局部状态

但两处都不要各自拼文案，应该统一走一个小函数。

### 4.2 统一展示函数

建议在 `editorTabs.ts` 或 `workspace.ts` 中新增：

```ts
export function getTabKindLabel(tab: Pick<EditorTab, 'origin' | 'templateId'>): string
export function getTabStatusLabel(tab: Pick<EditorTab, 'document' | 'lastSavedSnapshot'>): string
```

推荐输出：

- `blank` -> `空白草稿`
- `imported` -> `导入草稿`
- `template` + `templateId !== null` -> `模板草稿`
- `template` + `templateId === null` -> `未绑定草稿`
- `detached` -> `已解绑草稿`

状态输出：

- dirty -> `未保存修改`
- clean -> `已保存`

### 4.3 文档名称显示

顶部继续展示当前文档名称：

- 模板草稿：显示模板名 / 文档名
- 导入草稿：显示导入后的文件名
- 空白草稿：显示默认文档名，如 `快速标签`

## 5. 操作规则

### 5.1 新建

入口：

- 顶部主操作
- 空工作区按钮
- 模板库页可保留次要入口，但文案要明确

行为：

- 创建新 tab
- `templateId = null`
- `origin = 'blank'`

涉及函数：

- `createFreshDocument()` in `App.tsx`

### 5.2 打开模板

入口：

- 模板库卡片

行为：

- 读取模板
- 如果该模板已有打开 tab，则切换到已有 tab
- 否则创建新 tab
- `templateId = template.id`
- `origin = 'template'`

涉及函数：

- `loadTemplate()` in `App.tsx`

### 5.3 导入

按钮文案统一改成：

- `导入为草稿`

行为：

- 读取外部文件
- 转成 `LabelDocument`
- 打开新 tab
- `templateId = null`
- `origin = 'imported'`

涉及函数：

- `handleDdlUpload()` in `App.tsx`

### 5.4 保存

`保存` 必须收敛成单义词。

规则：

- 当前 tab 有 `templateId`
  - 直接覆盖保存回原模板
- 当前 tab 无 `templateId`
  - 不做隐式保存
  - 直接进入 `另存为模板`

涉及函数：

- `saveCurrentTemplate()`
- `persistCurrentDocument()`

说明：

现有实现已经基本这样做了，但 UI 和后续关闭逻辑要完全对齐。

### 5.5 另存为模板

规则：

- 弹出命名输入
- 创建新模板
- 当前 tab 绑定新模板
- `templateId = saved.id`
- `origin = 'template'`

涉及函数：

- `saveAsTemplate()`

### 5.6 删除模板

模板库删除规则保持：

- 删除前二次确认
- 如果模板已在编辑器中打开，当前内容保留

删除成功后：

- 相关 tab `templateId = null`
- `lastSavedSnapshot` 更新为当前文档快照
- 若使用扩展 origin，改为 `detached`

涉及函数：

- `deleteTemplate()`

## 6. 关闭单个 tab 规格

## 6.1 触发时机

关闭 tab 时，如果：

- tab 不脏 -> 直接关闭
- tab 脏 -> 打开自定义对话框

不要继续只用 `window.confirm`，因为需要三按钮。

### 6.2 对话框按钮

- `保存`
- `不保存`
- `取消`

### 6.3 不同来源的保存行为

#### 模板草稿

文案：

- `“服装价签”有未保存修改，关闭前是否保存到原模板？`

点击 `保存`：

- 调用 `saveCurrentTemplate()`
- 成功后关闭 tab
- 失败则留在当前 tab

#### 空白草稿

文案：

- `“快速标签”有未保存修改，关闭前是否另存为模板？`

点击 `保存`：

- 进入 `saveAsTemplate()`
- 如果用户取消命名，则不关闭 tab
- 保存成功后关闭 tab

#### 导入草稿

文案：

- `“shipping.ddl”有未保存修改，它还不是模板。关闭前是否另存为模板？`

点击 `保存`：

- 同空白草稿处理

#### 已解绑草稿

文案：

- `“服装价签”对应模板已删除。关闭前是否另存为新模板？`

点击 `保存`：

- 进入 `saveAsTemplate()`

### 6.4 推荐实现方式

新增组件：

- `src/YiboLabel.App/ClientApp/src/components/UnsavedChangesDialog.tsx`

建议 props：

```ts
type UnsavedChangesDialogProps = {
  open: boolean
  title: string
  body: string
  saving: boolean
  saveLabel?: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}
```

## 7. 关闭程序前确认规格

## 7.1 目标

你提出的“关闭程序时，如有未保存模板或草稿，弹窗提示是否保存”应作为正式流程，而不是只靠浏览器原生拦截。

### 7.2 两层机制

#### 第一层：应用内汇总弹窗

当用户点击窗口关闭按钮时：

- 先统计所有 dirty tabs
- 如果没有 dirty tab，直接关闭
- 如果有 dirty tab，先显示应用内弹窗

#### 第二层：beforeunload 兜底

保留现有 `beforeunload`，防止：

- 应用内流程遗漏
- 非预期关闭
- 浏览器 / WebView 级关闭

### 7.3 汇总弹窗内容

列出所有未保存 tab，建议显示：

- 文档名称
- 草稿类型
- 是否绑定模板

示例：

- `模板草稿：服装价签`
- `导入草稿：shipping.ddl`
- `空白草稿：快速标签`

### 7.4 汇总弹窗按钮

- `全部保存`
- `逐个处理`
- `放弃并退出`
- `取消`

### 7.5 各按钮行为

#### 全部保存

- 对模板草稿：直接保存
- 对空白 / 导入 / 已解绑草稿：逐个触发命名保存
- 任意一个命名被取消：
  - 中止退出
  - 回到应用

#### 逐个处理

按 tab 顺序依次打开 `UnsavedChangesDialog`

每个 tab 都给：

- `保存`
- `不保存`
- `取消退出`

#### 放弃并退出

- 直接关闭程序

#### 取消

- 不关闭程序

### 7.6 推荐实现方式

新增组件：

- `src/YiboLabel.App/ClientApp/src/components/PendingSavesDialog.tsx`

建议 props：

```ts
type PendingSavesDialogProps = {
  open: boolean
  items: Array<{
    tabId: string
    name: string
    kindLabel: string
    dirty: boolean
  }>
  saving: boolean
  onSaveAll: () => void
  onReviewOneByOne: () => void
  onDiscardAndExit: () => void
  onCancel: () => void
}
```

## 8. 顶部按钮与文案规格

文件：

- `src/YiboLabel.App/ClientApp/src/components/WorkspaceTopbar.tsx`

### 8.1 导入按钮

按钮文本建议改成：

- `导入为草稿`

### 8.2 保存按钮

按钮文本建议改成固定 `保存`，不要根据 `activeTemplateId` 切换成 `保存为模板`。

原因：

- 当前主按钮一旦改字，会让用户误以为按钮含义在漂移
- 更稳定的方式是：
  - 按钮始终叫 `保存`
  - 未绑定草稿点它时，进入 `另存为模板`

如果担心用户看不懂，可在 tooltip 或状态条提示：

- `当前草稿未绑定模板，保存将进入另存为模板`

### 8.3 另存为按钮

建议改成：

- `另存为模板`

不要只写 `另存为`，避免像普通文件菜单。

## 9. 测试点

### 9.1 必测流程

- 新建草稿后显示 `空白草稿`
- 导入草稿后显示 `导入草稿`
- 打开模板后显示 `模板草稿`
- 空白草稿点 `保存` 进入另存为
- 导入草稿点 `保存` 进入另存为
- 模板草稿点 `保存` 覆盖原模板
- 模板草稿点 `另存为模板` 不覆盖原模板
- 删除已打开模板后内容仍保留
- 关闭脏 tab 时能出现正确弹窗
- 退出程序时能列出全部脏 tab

### 9.2 边界测试

- `saveAsTemplate()` 时用户取消命名
- 退出程序时多个未绑定草稿依次命名
- 删除模板后再点 `保存`
- 导入的 `.yblabel.json` 与普通 JSON 的提示差异
- 恢复旧 workspace snapshot 时不崩

## 10. 非目标

本轮不处理：

- 自动保存
- 模板版本历史
- 模板市场
- 批量导入模板库
- 导入后自动归档到模板库
- 多窗口协同编辑

## 11. 一句话验收标准

如果做到下面这几条，本轮就算完成：

- 用户能一眼看出当前是 `模板草稿`、`导入草稿` 还是 `空白草稿`
- `保存` 的意义稳定，不再让人猜“会保存到哪里”
- 关闭 tab 和关闭程序时，不会无提示丢失未保存内容
- 模板管理入口保持轻量，不承担模糊的编辑语义
