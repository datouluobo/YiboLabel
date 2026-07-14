# Export Design

## Goal

Add a consistent export flow for the current label document.

Supported first-version formats:

- local template file: `.yblabel.json`
- PNG image: `.png`
- JPG image: `.jpg`
- PDF document: `.pdf`

The export experience should feel like one feature, not four unrelated actions.

## User Flow

1. User opens the `Export` action from the main command bar.
2. User selects an export format.
3. If the format is PDF, user also selects paper size:
   - current label size
   - A4 portrait
   - A4 landscape
4. User confirms export.
5. The desktop shell opens a native Windows save dialog.
6. If the user chooses a path, the app writes the file.
7. The app shows one consistent success, cancel, or failure status message.

## Save Dialog

All formats must use the native Windows save dialog from the desktop shell.

Do not use browser download links as the main path. A browser fallback can exist only if the app is running without the desktop shell.

Dialog behavior:

- default file name comes from the current label name
- invalid Windows file name characters are replaced
- file filter matches the selected format
- default extension matches the selected format
- overwrite confirmation uses the native dialog behavior

Suggested filters:

- `YiboLabel template (*.yblabel.json)|*.yblabel.json`
- `PNG image (*.png)|*.png`
- `JPEG image (*.jpg)|*.jpg;*.jpeg`
- `PDF document (*.pdf)|*.pdf`

## Feedback

Use the same feedback pattern for every format.

Recommended messages:

- success: `已导出 PDF：filename.pdf`
- cancelled: no message, or `已取消导出`
- failure: `导出失败：reason`

The export button should enter a shared busy state, such as `导出中...`, while export is running.

## PDF Export

PDF export should use WebView2's native PDF printing support instead of carrying a PDF JavaScript library.

Rationale:

- the desktop app already runs inside WebView2
- WebView2 supports `PrintToPdfAsync`
- avoiding `jsPDF` keeps the app smaller
- the native path fits the Windows desktop experience

Paper options:

- `Current label size`: page size equals `LabelDocument.widthMm` by `LabelDocument.heightMm`, with zero margins.
- `A4 portrait`: page size is 210 mm by 297 mm.
- `A4 landscape`: page size is 297 mm by 210 mm.

For A4 exports, render the label at its real physical size and place it centered on the page in the first version.

Future option:

- label placement: center, top-left
- multiple labels per A4 sheet

## Image Export

PNG and JPG export should use one shared label rendering path.

Preferred approach:

- render the current `LabelDocument` to an offscreen canvas
- draw text, images, lines, and rectangles directly
- reuse `JsBarcode` for barcode rendering
- reuse `qrcode` for QR code rendering
- encode the canvas as PNG or JPG
- pass bytes to the desktop shell for writing to the chosen path

PNG behavior:

- preserve sharp edges
- keep a white label background unless transparent export is explicitly added later

JPG behavior:

- force a white background
- use a reasonable default quality, such as `0.92`

## Local Template Export

Local template export writes a JSON file for backup, transfer, and future import.

Suggested payload:

```json
{
  "schemaVersion": 1,
  "kind": "yibolabel-template-export",
  "exportedAt": "2026-07-14T00:00:00.000Z",
  "name": "Label name",
  "description": "",
  "tags": [],
  "source": "manual",
  "document": {}
}
```

The `document` field should contain the normalized current `LabelDocument`.

## Export Rendering Mode

PNG, JPG, and PDF should share the same visual export mode.

Before rendering/exporting, hide editor-only UI:

- grid overlay
- selection outlines
- resize handles
- rotation handle
- marquee selection
- snap lines
- hover or active editor affordances

Only the label content should appear in exported output.

## Desktop Bridge

Use one consistent WebView2 message family for export.

Suggested messages:

- `export-save-dialog`: open the native save dialog and return a file path or cancellation
- `export-write-file`: write JSON or image bytes to the selected path
- `export-print-pdf`: run WebView2 `PrintToPdfAsync` with the selected path and paper settings

The frontend should keep a request id for each export operation so responses can be matched reliably.

## Acceptance Criteria

- Export is disabled when no label tab is open.
- Every format opens the native Windows save dialog.
- Cancelling the save dialog does not show an error.
- PNG, JPG, and PDF do not include editor grid, selection, handles, or snap lines.
- Barcode and QR code elements export correctly.
- Image elements export correctly.
- Chinese text exports without missing glyphs.
- PDF current-label mode uses the actual label size.
- PDF A4 portrait and A4 landscape use the correct physical page size.
- A4 exports place the label at real size and centered.
- Success and failure feedback is consistent across all formats.

## Non-Goals For First Version

- batch export
- multiple labels per A4 sheet
- transparent PNG
- custom PDF margins
- custom JPG quality control
- import for `.yblabel.json`
- cloud or sharing integrations
