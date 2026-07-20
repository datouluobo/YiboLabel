import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import { ContentValueInput } from './ContentValueInput'
import { clamp, defaultFontFamily, normalizeFontFamily, normalizeRotation, pointsToMm, roundTo } from '../domain/labelDocument'
import { getBarcodeLayout, getQrCodeLayout } from '../domain/codeElementLayout'
import type {
  BarcodeElement,
  ImageElement,
  LabelElement,
  LineElement,
  QrCodeElement,
  RectangleElement,
  TextElement,
} from '../types'

const rotationPresets = [0, 90, 180, 270]
const barcodePresets = [
  { value: '128', label: 'Code 128' },
  { value: '39', label: 'Code 39' },
  { value: 'EAN13', label: 'EAN-13' },
  { value: 'EAN8', label: 'EAN-8' },
  { value: 'UPCA', label: 'UPC-A' },
  { value: 'UPCE', label: 'UPC-E' },
]
const fontFamilyOptions = [
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'Microsoft YaHei UI', label: '微软雅黑 UI' },
  { value: 'SimHei', label: '黑体' },
  { value: 'SimSun', label: '宋体' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'Arial', label: 'Arial' },
]

const formatOneDecimal = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : '0.0')

export function ToolButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="tool-button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

export function LayerActionButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button className="mini-button layer-action-button" type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function InspectorSection({ title, hint, className, children }: { title?: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <section className={clsx('inspector-section', className)}>
      {title ? (
        <div className="inspector-section-head">
          <strong>{title}</strong>
          {hint ? <span>{hint}</span> : null}
        </div>
      ) : null}
      <div className="inspector-section-body">{children}</div>
    </section>
  )
}

export function MultiSelectionInspector({
  count,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
}: {
  count: number
  onBringForward: () => void
  onSendBackward: () => void
  onBringToFront: () => void
  onSendToBack: () => void
}) {
  return (
    <div className="inspector-fields">
      <p className="empty-note">已选中 {count} 个元素。</p>
      <div className="field-row">
        <button className="mini-button" onClick={onBringToFront}>
          置顶
        </button>
        <button className="mini-button" onClick={onSendToBack}>
          置底
        </button>
      </div>
      <div className="field-row">
        <button className="mini-button" onClick={onBringForward}>
          上移
        </button>
        <button className="mini-button" onClick={onSendBackward}>
          下移
        </button>
      </div>
    </div>
  )
}

export function ElementPreview({ element, canvasScale }: { element: LabelElement; canvasScale: number }) {
  if (element.type === 'text') {
    return <TextPreview element={element} canvasScale={canvasScale} />
  }

  if (element.type === 'barcode') {
    return <BarcodePreview element={element} canvasScale={canvasScale} />
  }

  if (element.type === 'qrcode') {
    return <QrPreview element={element} canvasScale={canvasScale} />
  }

  if (element.type === 'line') {
    return <div className="line-preview" style={{ height: Math.max(2, element.thickness * canvasScale * 0.2) }} />
  }

  if (element.type === 'rectangle') {
    return <div className="rectangle-preview" style={{ borderWidth: `${Math.max(1, element.thickness * canvasScale * 0.12)}px` }} />
  }

  return element.dataUrl ? <img className="image-preview" src={element.dataUrl} alt="" /> : <div className="image-placeholder">图片</div>
}

function TextPreview({ element, canvasScale }: { element: TextElement; canvasScale: number }) {
  const fontSizePx = Math.max(12, pointsToMm(element.fontSize) * canvasScale)
  const fontWeight = element.bold ? 700 : 500
  const fontStyle = element.italic ? 'italic' : 'normal'
  const fontFamily = `"${normalizeFontFamily(element.fontFamily)}", "Microsoft YaHei", "微软雅黑", sans-serif`
  const availableWidth = Math.max(1, element.width * canvasScale - 4)
  const measuredWidth = useMemo(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) {
      return availableWidth
    }

    context.font = `${fontStyle} ${fontWeight} ${fontSizePx}px ${fontFamily}`
    return context.measureText(element.text || ' ').width
  }, [availableWidth, element.text, fontSizePx, fontFamily, fontStyle, fontWeight])
  const fitScale = clamp(availableWidth / Math.max(1, measuredWidth), 0.55, 1)
  const justifyContent = element.align === 'right' ? 'flex-end' : element.align === 'center' ? 'center' : 'flex-start'

  return (
    <div className="text-preview" style={{ justifyContent }}>
      <span
        className="text-preview-content"
        style={{
          fontSize: `${fontSizePx}px`,
          fontWeight,
          fontStyle,
          fontFamily,
          transform: `scaleX(${fitScale})`,
          transformOrigin: element.align === 'right' ? 'right top' : element.align === 'center' ? 'center top' : 'left top',
        }}
      >
        {element.text}
      </span>
    </div>
  )
}

function BarcodePreview({ element, canvasScale }: { element: BarcodeElement; canvasScale: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!canvasRef.current) {
      return
    }

    try {
      const canvasWidth = Math.max(80, Math.round(element.width * canvasScale))
      const canvasHeight = Math.max(48, Math.round(element.height * canvasScale))
      const layout = getBarcodeLayout(element, canvasWidth, canvasHeight, canvasScale)
      canvasRef.current.width = canvasWidth
      canvasRef.current.height = canvasHeight
      const context = canvasRef.current.getContext('2d')
      if (!context) {
        return
      }

      const barcodeCanvas = document.createElement('canvas')
      barcodeCanvas.width = Math.max(1, Math.round(layout.code.width))
      barcodeCanvas.height = Math.max(1, Math.round(layout.code.height))

      JsBarcode(barcodeCanvas, element.value || ' ', {
        format: mapBarcodePreviewFormat(element.symbology),
        width: 1,
        height: barcodeCanvas.height,
        displayValue: false,
        margin: 0,
        background: '#ffffff',
      })

      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvasWidth, canvasHeight)
      context.imageSmoothingEnabled = false
      context.drawImage(barcodeCanvas, layout.code.x, layout.code.y, layout.code.width, layout.code.height)
      if (layout.text) {
        drawCanvasText(context, element.value, layout.text, layout.fontSize, element.humanReadableFontFamily)
      }
    } catch {
      // Ignore preview errors for incomplete or unsupported content.
    }
  }, [canvasScale, element])

  return <canvas ref={canvasRef} className="barcode-preview" />
}

function QrPreview({ element, canvasScale }: { element: QrCodeElement; canvasScale: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!canvasRef.current) {
      return
    }

    const canvasWidth = Math.max(32, Math.round(element.width * canvasScale))
    const canvasHeight = Math.max(32, Math.round(element.height * canvasScale))
    const layout = getQrCodeLayout(element, canvasWidth, canvasHeight, canvasScale)
    canvasRef.current.width = canvasWidth
    canvasRef.current.height = canvasHeight
    const context = canvasRef.current.getContext('2d')
    if (!context) {
      return
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvasWidth, canvasHeight)
    const qrCanvas = document.createElement('canvas')
    qrCanvas.width = Math.max(16, Math.round(layout.code.width))
    qrCanvas.height = Math.max(16, Math.round(layout.code.height))
    void QRCode.toCanvas(qrCanvas, element.value || ' ', {
      margin: 0,
      width: qrCanvas.width,
    }).then(() => {
      context.imageSmoothingEnabled = false
      context.drawImage(qrCanvas, layout.code.x, layout.code.y, layout.code.width, layout.code.height)
      if (layout.text) {
        drawCanvasText(context, element.value, layout.text, layout.fontSize, element.humanReadableFontFamily)
      }
    })
  }, [canvasScale, element])

  return <canvas ref={canvasRef} className="barcode-preview" />
}

function drawCanvasText(context: CanvasRenderingContext2D, value: string, bounds: { x: number; y: number; width: number; height: number }, fontSize: number, fontFamily: string) {
  const text = value || ' '
  const font = `500 ${fontSize}px "${normalizeFontFamily(fontFamily)}", "Microsoft YaHei", "微软雅黑", sans-serif`
  context.save()
  context.fillStyle = '#18222f'
  context.font = font
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.beginPath()
  context.rect(bounds.x, bounds.y, bounds.width, bounds.height)
  context.clip()
  const measuredWidth = context.measureText(text).width
  const fitScale = clamp((bounds.width - 2) / Math.max(1, measuredWidth), 0.55, 1)
  context.translate(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  context.scale(fitScale, 1)
  context.fillText(text, 0, 0)
  context.restore()
}

function FontFamilyField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const normalizedValue = normalizeFontFamily(value)

  return (
    <label>
      {label}
      <select value={normalizedValue} onChange={(event) => onChange(event.target.value)}>
        {fontFamilyOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function mapBarcodePreviewFormat(symbology: string) {
  const normalized = symbology.replace(/[_\s-]/g, '').toUpperCase()
  if (normalized === '128' || normalized === 'CODE128') {
    return 'CODE128'
  }

  if (normalized === 'CODE128A') {
    return 'CODE128A'
  }

  if (normalized === 'CODE128B') {
    return 'CODE128B'
  }

  if (normalized === 'CODE128C') {
    return 'CODE128C'
  }

  if (normalized === '39' || normalized === 'CODE39') {
    return 'CODE39'
  }

  if (normalized === 'EAN13') {
    return 'EAN13'
  }

  if (normalized === 'EAN8') {
    return 'EAN8'
  }

  if (normalized === 'UPCA') {
    return 'UPC'
  }

  if (normalized === 'UPCE') {
    return 'UPC'
  }

  return 'CODE128'
}

export function ElementInspector({
  element,
  onNameChange,
  onPatch,
}: {
  element: LabelElement
  layerCount: number
  onNameChange: (name: string) => void
  onPatch: (patch: Partial<LabelElement>) => void
  onBringForward: () => void
  onSendBackward: () => void
  onBringToFront: () => void
  onSendToBack: () => void
  onToggleLock: () => void
  onToggleHidden: () => void
}) {
  const geometryLocked = element.locked
  const nudge = (x: number, y: number) => onPatch({ x: roundTo(element.x + x, 0.1), y: roundTo(element.y + y, 0.1) })
  const patchSize = (patch: Partial<LabelElement>) => {
    onPatch(patch)
  }

  const patchQrTextVisibility = (showHumanReadable: boolean) => {
    if (element.type !== 'qrcode') {
      return
    }

    onPatch({ showHumanReadable } as Partial<QrCodeElement>)
  }

  const patchQrFontSize = (fontSize: number) => {
    if (element.type !== 'qrcode') {
      return
    }

    onPatch({ humanReadableFontSize: fontSize } as Partial<QrCodeElement>)
  }

  const contentSection = (() => {
    if (element.type === 'text') {
      return (
        <InspectorSection title="文本" className="text-settings-section">
          <label className="text-content-field">
            <span className="visually-hidden">内容</span>
            <ContentValueInput
              value={element.text}
              groupIds={element.lexiconGroupIds ?? []}
              onChange={(value) => onPatch({ text: value } as Partial<TextElement>)}
            />
          </label>
          <div className="text-format-grid">
            <label>
              字号
              <input type="number" min="4" max="96" value={element.fontSize} onChange={(event) => onPatch({ fontSize: Number(event.target.value) } as Partial<TextElement>)} />
            </label>
            <FontFamilyField
              label="字体"
              value={element.fontFamily ?? defaultFontFamily}
              onChange={(value) => onPatch({ fontFamily: value } as Partial<TextElement>)}
            />
            <div className="text-style-toggles">
              <label className="toggle-row text-style-toggle">
                <input type="checkbox" checked={element.bold} onChange={(event) => onPatch({ bold: event.target.checked } as Partial<TextElement>)} />
                粗体
              </label>
              <label className="toggle-row text-style-toggle">
                <input type="checkbox" checked={element.italic} onChange={(event) => onPatch({ italic: event.target.checked } as Partial<TextElement>)} />
                斜体
              </label>
            </div>
          </div>
          <div className="text-align-row">
            <span>对齐</span>
            <div className="segmented-row">
              {[
                { value: 'left', label: '左' },
                { value: 'center', label: '中' },
                { value: 'right', label: '右' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={clsx('mini-button', element.align === option.value && 'active')}
                  onClick={() => onPatch({ align: option.value as TextElement['align'] } as Partial<TextElement>)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </InspectorSection>
      )
    }

    if (element.type === 'barcode') {
      return (
        <InspectorSection title="条码">
          <label>
            <span className="visually-hidden">内容</span>
            <ContentValueInput
              value={element.value}
              groupIds={element.lexiconGroupIds ?? []}
              onChange={(value) => onPatch({ value } as Partial<BarcodeElement>)}
            />
          </label>
          <div className="field-row">
            <label>
              常用制式
              <select
                value={barcodePresets.some((item) => item.value === element.symbology) ? element.symbology : '__custom__'}
                onChange={(event) => onPatch({ symbology: event.target.value === '__custom__' ? element.symbology : event.target.value } as Partial<BarcodeElement>)}
              >
                {barcodePresets.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                <option value="__custom__">自定义</option>
              </select>
            </label>
            <label>
              实际制式
              <input value={element.symbology} onChange={(event) => onPatch({ symbology: event.target.value } as Partial<BarcodeElement>)} />
            </label>
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={element.showHumanReadable}
              onChange={(event) => onPatch({ showHumanReadable: event.target.checked } as Partial<BarcodeElement>)}
            />
            显示条码文字
          </label>
          <div className="field-row">
            <label>
              文字位置
              <select value={element.textPosition} onChange={(event) => onPatch({ textPosition: event.target.value as BarcodeElement['textPosition'] } as Partial<BarcodeElement>)}>
                <option value="bottom">下方</option>
                <option value="top">上方</option>
              </select>
            </label>
            <label>
              文字字号
              <input type="number" min="4" max="36" value={element.humanReadableFontSize} onChange={(event) => onPatch({ humanReadableFontSize: Number(event.target.value) } as Partial<BarcodeElement>)} />
            </label>
          </div>
          <FontFamilyField
            label="文字字体"
            value={element.humanReadableFontFamily ?? defaultFontFamily}
            onChange={(value) => onPatch({ humanReadableFontFamily: value } as Partial<BarcodeElement>)}
          />
        </InspectorSection>
      )
    }

    if (element.type === 'qrcode') {
      return (
        <InspectorSection title="二维码">
          <label>
            <span className="visually-hidden">内容</span>
            <ContentValueInput
              value={element.value}
              groupIds={element.lexiconGroupIds ?? []}
              onChange={(value) => onPatch({ value } as Partial<QrCodeElement>)}
            />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={element.showHumanReadable}
              onChange={(event) => patchQrTextVisibility(event.target.checked)}
            />
            同时显示文本
          </label>
          <div className="field-row">
            <label>
              文字位置
              <select value={element.textPosition} onChange={(event) => onPatch({ textPosition: event.target.value as QrCodeElement['textPosition'] } as Partial<QrCodeElement>)}>
                <option value="bottom">下方</option>
                <option value="top">上方</option>
              </select>
            </label>
            <label>
              文字字号
              <input type="number" min="4" max="36" value={element.humanReadableFontSize} onChange={(event) => patchQrFontSize(Number(event.target.value))} />
            </label>
          </div>
          <FontFamilyField
            label="文字字体"
            value={element.humanReadableFontFamily ?? defaultFontFamily}
            onChange={(value) => onPatch({ humanReadableFontFamily: value } as Partial<QrCodeElement>)}
          />
        </InspectorSection>
      )
    }

    return null
  })()

  return (
    <div className="inspector-fields">
      <InspectorSection className="overview-section">
        <label>
          名称
          <input value={element.name ?? ''} onChange={(event) => onNameChange(event.target.value)} />
        </label>
      </InspectorSection>

      {contentSection}

      <InspectorSection title="位置" hint={geometryLocked ? '已锁定' : 'mm'}>
        <div className="field-row">
          <label>
            X
            <input type="number" step="0.1" value={formatOneDecimal(element.x)} disabled={geometryLocked} onChange={(event) => onPatch({ x: Number(event.target.value) })} />
          </label>
          <label>
            Y
            <input type="number" step="0.1" value={formatOneDecimal(element.y)} disabled={geometryLocked} onChange={(event) => onPatch({ y: Number(event.target.value) })} />
          </label>
        </div>
        <div className="nudge-grid">
          <button className="mini-button" disabled={geometryLocked} onClick={() => nudge(0, -0.5)}>
            ↑ 0.5
          </button>
          <button className="mini-button" disabled={geometryLocked} onClick={() => nudge(0, 0.5)}>
            ↓ 0.5
          </button>
          <button className="mini-button" disabled={geometryLocked} onClick={() => nudge(-0.5, 0)}>
            ← 0.5
          </button>
          <button className="mini-button" disabled={geometryLocked} onClick={() => nudge(0.5, 0)}>
            → 0.5
          </button>
        </div>
      </InspectorSection>

      <InspectorSection title="尺寸" hint={geometryLocked ? '已锁定' : 'mm'}>
        <div className="field-row">
          <label>
            宽
            <input type="number" step="0.1" value={formatOneDecimal(element.width)} disabled={geometryLocked} onChange={(event) => patchSize({ width: Number(event.target.value) })} />
          </label>
          <label>
            高
            <input type="number" step="0.1" value={formatOneDecimal(element.height)} disabled={geometryLocked} onChange={(event) => patchSize({ height: Number(event.target.value) })} />
          </label>
        </div>
      </InspectorSection>

      <InspectorSection>
        <label>
          旋转
          <input type="number" step="1" min="0" max="359" value={element.rotation} disabled={geometryLocked} onChange={(event) => onPatch({ rotation: Number(event.target.value) })} />
        </label>
        <div className="segmented-row">
          {rotationPresets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={clsx('mini-button', normalizeRotation(element.rotation) === preset && 'active')}
              disabled={geometryLocked}
              onClick={() => onPatch({ rotation: preset })}
            >
              {preset}°
            </button>
          ))}
        </div>
      </InspectorSection>

      {element.type === 'rectangle' && (
        <InspectorSection title="矩形样式">
          <label>
            边框粗细
            <input type="number" min="1" max="8" value={element.thickness} onChange={(event) => onPatch({ thickness: Number(event.target.value) } as Partial<RectangleElement>)} />
          </label>
        </InspectorSection>
      )}

      {element.type === 'line' && (
        <InspectorSection title="线条样式">
          <label>
            线条粗细
            <input type="number" min="1" max="8" value={element.thickness} onChange={(event) => onPatch({ thickness: Number(event.target.value) } as Partial<LineElement>)} />
          </label>
        </InspectorSection>
      )}

      {element.type === 'image' && (
        <InspectorSection title="图片设置">
          <label className="toggle-row">
            <input type="checkbox" checked={element.invert} onChange={(event) => onPatch({ invert: event.target.checked } as Partial<ImageElement>)} />
            打印时反相
          </label>
        </InspectorSection>
      )}
    </div>
  )
}
