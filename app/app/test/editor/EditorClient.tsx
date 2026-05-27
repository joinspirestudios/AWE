'use client'

/**
 * AWE Editor — Slice 1 (read-only Konva preview)
 *
 * Reads a serialized funnel payload from localStorage (written by the
 * funnel's "Open Editor" button) and renders each SlidePlan as a 4:5
 * Konva canvas using the carousel's unified style.
 *
 * Slice 1 scope:
 *   - Render text / callout / numbered / badge / quote elements with
 *     real positioning from the SlidePlan's region+size.
 *   - Render image / decoration / logo elements as labeled placeholder
 *     rectangles (real image handling lands in Slice 2).
 *   - Apply the carousel's unified style for colors, typography
 *     category, background type, motifs.
 *   - Read-only — no editing affordances yet.
 *   - No export — preview only.
 *
 * Konva note: Next.js renders this as a client component (`'use client'`)
 * because Konva needs a real DOM and react-konva isn't SSR-safe. Konva
 * primitives are imported directly; they no-op on the server during the
 * initial RSC pass and hydrate on the client.
 */

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Circle, Group, Layer, Rect, Stage, Text } from 'react-konva'

// ─────────────────────────────────────────────────────────────────────────
// Types — mirror the @app/scene shapes but kept local for portability
// ─────────────────────────────────────────────────────────────────────────

type Region =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'full-bleed'
  | 'overlay'

type ElementType =
  | 'headline'
  | 'body'
  | 'image'
  | 'callout'
  | 'number'
  | 'decoration'
  | 'logo'
  | 'badge'
  | 'quote'

type ElementSize = 'small' | 'medium' | 'large' | 'full'

interface LayoutElement {
  type: ElementType
  region: Region
  size: ElementSize
  role: string
  notes?: string
}

interface SlidePlan {
  slideIndex: number
  purpose: string
  composition: string
  elements: LayoutElement[]
  rationale: string
  drawsFrom: Array<{ refId: string; slideIndex?: number; what: string }>
}

interface CarouselStyle {
  colors: { primary: string[]; accents: string[] }
  typography: {
    headlineStyle: 'serif' | 'sans' | 'display' | 'monospace'
    headlineWeight: 'light' | 'regular' | 'medium' | 'bold' | 'black'
    bodyStyle: 'serif' | 'sans'
    hierarchy: 'high-contrast' | 'subtle'
    headlineFontGuesses: Array<{ family: string; weight: number; confidence: number }>
    bodyFontGuesses: Array<{ family: string; weight: number; confidence: number }>
  }
  layout: {
    alignment: 'left' | 'center' | 'right' | 'mixed'
    grid: 'tight' | 'loose' | 'asymmetric'
    fullBleed: boolean
  }
  background: {
    type: 'solid' | 'gradient' | 'photo' | 'photo-overlay' | 'texture'
    mood: 'dark' | 'light' | 'high-contrast'
  }
  motifs: string[]
  slidePattern: 'consistent' | 'varied' | 'progressive'
}

interface CarouselPlan {
  slides: SlidePlan[]
  style: CarouselStyle
  overview?: string
}

interface ScriptSlide {
  purpose: string
  headline: string
  body?: string
  emphasis: string[]
}

interface ScriptAnalysis {
  niche: string
  subNiche?: string
  tone: string
  audience: string
  recommendedSlideCount: number
  slides: ScriptSlide[]
}

interface EditorPayload {
  plan: CarouselPlan
  script: ScriptAnalysis
  references: Array<{
    id: string
    ownerUsername?: string
  }>
  savedAt: number
}

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/** Logical slide dimensions. IG carousel native is 1080×1350 (4:5). */
const SLIDE_W = 1080
const SLIDE_H = 1350

/** Display scale — 50% of native gives a ~540×675 canvas that fits in most viewports. */
const DISPLAY_SCALE = 0.5

/** localStorage key matching what the funnel page writes on "Open Editor". */
const STORAGE_KEY = 'awe.editor.payload.v1'

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

export default function EditorClient() {
  const [payload, setPayload] = useState<EditorPayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)

  // Read from localStorage on mount. localStorage isn't available on the
  // server pass; this effect runs only on the client.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        setLoadError(
          'No editor payload found. Open the editor from the funnel page after running Analyze.',
        )
        return
      }
      const parsed = JSON.parse(raw) as EditorPayload
      if (!parsed?.plan?.slides?.length) {
        setLoadError(
          "The saved payload doesn't contain a valid plan. Re-run Analyze on the funnel page and click Open Editor again.",
        )
        return
      }
      setPayload(parsed)
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? `Couldn't read saved payload: ${err.message}`
          : 'Unknown error reading saved payload.',
      )
    }
  }, [])

  if (loadError) {
    return (
      <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
        <div className="mx-auto max-w-2xl rounded-lg border border-red-900/60 bg-red-950/30 p-6">
          <h1 className="text-lg font-medium">Couldn't open editor</h1>
          <p className="mt-2 text-sm text-red-200/80">{loadError}</p>
          <Link
            href="/test/funnel"
            className="mt-4 inline-block text-sm text-neutral-300 underline hover:text-neutral-100"
          >
            ← Back to funnel
          </Link>
        </div>
      </main>
    )
  }

  if (!payload) {
    return (
      <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
        <div className="text-sm text-neutral-500">Loading editor…</div>
      </main>
    )
  }

  const currentSlide = payload.plan.slides[currentIndex]
  const currentScriptSlide = payload.script.slides[currentIndex]

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-neutral-900 px-6 py-3">
        <div className="flex items-center gap-4">
          <Link
            href="/test/funnel"
            className="text-sm text-neutral-500 transition hover:text-neutral-200"
          >
            ← Funnel
          </Link>
          <div>
            <h1 className="text-sm font-medium">AWE Editor</h1>
            <p className="text-[11px] text-neutral-500">
              {payload.script.niche}
              {payload.script.subNiche ? ` · ${payload.script.subNiche}` : ''}
              {' · '}
              {payload.plan.slides.length} slides
            </p>
          </div>
        </div>
        <div className="text-[11px] text-neutral-500">
          Wireframe preview — visual fidelity comes in the next slice
        </div>
      </header>

      <div className="grid grid-cols-[14rem_1fr_18rem] gap-0">
        {/* Left rail — slide thumbnails */}
        <aside className="border-r border-neutral-900 px-3 py-4">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Slides
          </div>
          <div className="space-y-1.5">
            {payload.plan.slides.map((slide, i) => (
              <button
                key={slide.slideIndex}
                type="button"
                onClick={() => setCurrentIndex(i)}
                className={`flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left text-xs transition ${
                  i === currentIndex
                    ? 'bg-neutral-800 text-neutral-100'
                    : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
                }`}
              >
                <span className="font-mono text-neutral-500">
                  #{String(i + 1).padStart(2, '0')}
                </span>
                <span className="rounded bg-neutral-900 px-1 py-0.5 text-[9px] uppercase tracking-wide text-neutral-400">
                  {slide.purpose}
                </span>
                <span className="flex-1 truncate text-[11px]">
                  {payload.script.slides[i]?.headline ?? slide.composition}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Center — canvas */}
        <section className="flex flex-col items-center justify-start p-8">
          <div
            className="overflow-hidden rounded-md shadow-2xl"
            style={{
              width: SLIDE_W * DISPLAY_SCALE,
              height: SLIDE_H * DISPLAY_SCALE,
            }}
          >
            {currentSlide && currentScriptSlide && (
              <SlideCanvas
                slidePlan={currentSlide}
                style={payload.plan.style}
                scriptSlide={currentScriptSlide}
              />
            )}
          </div>
          <div className="mt-3 text-[11px] text-neutral-500">
            1080 × 1350 logical · {Math.round(DISPLAY_SCALE * 100)}% display
          </div>
        </section>

        {/* Right rail — slide metadata */}
        <aside className="border-l border-neutral-900 px-4 py-4">
          {currentSlide && (
            <div className="space-y-4 text-xs">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                  Composition
                </div>
                <div className="mt-1 text-neutral-200">
                  {currentSlide.composition}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                  Rationale
                </div>
                <p className="mt-1 leading-relaxed text-neutral-300">
                  {currentSlide.rationale}
                </p>
              </div>
              {currentSlide.elements.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                    Elements ({currentSlide.elements.length})
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {currentSlide.elements.map((el, i) => (
                      <li key={i} className="text-[11px] text-neutral-400">
                        <span className="text-neutral-300">{el.type}</span>
                        <span className="text-neutral-600">{' · '}</span>
                        <span>{el.region}</span>
                        <span className="text-neutral-600">{' · '}</span>
                        <span className="text-neutral-500">{el.role}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {currentSlide.drawsFrom.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                    Draws from
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {currentSlide.drawsFrom.map((d, i) => {
                      const ref = payload.references.find(
                        (r) => r.id === d.refId,
                      )
                      const label = ref?.ownerUsername
                        ? `@${ref.ownerUsername}`
                        : d.refId
                      return (
                        <span
                          key={i}
                          className="rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-400"
                          title={d.what}
                        >
                          {label}
                          {typeof d.slideIndex === 'number'
                            ? ` · ${d.slideIndex + 1}`
                            : ''}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// SlideCanvas — the Konva render
// ─────────────────────────────────────────────────────────────────────────

function SlideCanvas({
  slidePlan,
  style,
  scriptSlide,
}: {
  slidePlan: SlidePlan
  style: CarouselStyle
  scriptSlide: ScriptSlide
}) {
  // Background fill + text color are derived once from the style and
  // reused across elements. mood + background type drive both.
  const palette = useMemo(() => derivePalette(style), [style])

  return (
    <Stage
      width={SLIDE_W * DISPLAY_SCALE}
      height={SLIDE_H * DISPLAY_SCALE}
      scaleX={DISPLAY_SCALE}
      scaleY={DISPLAY_SCALE}
    >
      <Layer>
        {/* Background — solid color or simple gradient via two stacked Rects.
            Photo / photo-overlay / texture backgrounds get a placeholder
            color + mood treatment; real photo backgrounds come in Slice 2. */}
        <BackgroundLayer style={style} palette={palette} />

        {/* Elements — rendered in array order, which the synthesizer should
            have produced in visual reading order (back-to-front). */}
        {slidePlan.elements.map((el, i) => (
          <ElementShape
            key={i}
            element={el}
            style={style}
            palette={palette}
            scriptSlide={scriptSlide}
            slideIndex={slidePlan.slideIndex}
          />
        ))}
      </Layer>
    </Stage>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// BackgroundLayer
// ─────────────────────────────────────────────────────────────────────────

function BackgroundLayer({
  style,
  palette,
}: {
  style: CarouselStyle
  palette: Palette
}) {
  const bgType = style.background.type

  // Solid: single Rect fill.
  if (bgType === 'solid') {
    return <Rect x={0} y={0} width={SLIDE_W} height={SLIDE_H} fill={palette.bg} />
  }

  // Gradient: Konva supports linear gradients via fillLinearGradient* props.
  if (bgType === 'gradient') {
    return (
      <Rect
        x={0}
        y={0}
        width={SLIDE_W}
        height={SLIDE_H}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: SLIDE_W, y: SLIDE_H }}
        fillLinearGradientColorStops={[0, palette.bg, 1, palette.bgAccent]}
      />
    )
  }

  // Photo / photo-overlay / texture: placeholder treatment. A mood-tinted
  // base with a label indicating this is a stand-in for real imagery.
  // Slice 2 will swap this for real photos (upload or AI-gen).
  return (
    <Group>
      <Rect x={0} y={0} width={SLIDE_W} height={SLIDE_H} fill={palette.bg} />
      {/* Subtle hint that this is a placeholder background */}
      <Text
        x={SLIDE_W / 2}
        y={SLIDE_H - 70}
        offsetX={300}
        width={600}
        align="center"
        text={`[${bgType} background — placeholder]`}
        fontSize={20}
        fontFamily="ui-monospace, monospace"
        fill={palette.subtle}
        opacity={0.5}
      />
    </Group>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// ElementShape — dispatch on element.type
// ─────────────────────────────────────────────────────────────────────────

function ElementShape({
  element,
  style,
  palette,
  scriptSlide,
  slideIndex,
}: {
  element: LayoutElement
  style: CarouselStyle
  palette: Palette
  scriptSlide: ScriptSlide
  slideIndex: number
}) {
  const box = regionToBox(element.region, element.size, element.type)

  switch (element.type) {
    case 'headline':
      return (
        <TextElement
          box={box}
          text={scriptSlide.headline}
          fontFamily={typographyFontFamily(style.typography.headlineStyle)}
          fontWeight={typographyWeight(style.typography.headlineWeight)}
          fontSize={fontSizeFor('headline', element.size, style.typography.hierarchy)}
          fill={palette.fg}
          align={textAlignFromRegion(element.region, style.layout.alignment)}
        />
      )

    case 'body':
      return (
        <TextElement
          box={box}
          text={scriptSlide.body ?? ''}
          fontFamily={typographyFontFamily(style.typography.bodyStyle)}
          fontWeight={400}
          fontSize={fontSizeFor('body', element.size, style.typography.hierarchy)}
          fill={palette.fg}
          align={textAlignFromRegion(element.region, style.layout.alignment)}
        />
      )

    case 'quote':
      return (
        <TextElement
          box={box}
          text={scriptSlide.body ?? scriptSlide.headline}
          fontFamily={typographyFontFamily(style.typography.headlineStyle)}
          fontWeight={typographyWeight(style.typography.headlineWeight)}
          fontSize={fontSizeFor('quote', element.size, style.typography.hierarchy)}
          fill={palette.fg}
          fontStyle="italic"
          align={textAlignFromRegion(element.region, style.layout.alignment)}
        />
      )

    case 'number': {
      // For step slides, the slide index works as the number; otherwise
      // we render the role text (e.g. "01" or "$5K") as-given.
      const numericFromRole = element.role.match(/[0-9$.,KMB]+/)?.[0]
      const text = numericFromRole ?? String(slideIndex + 1).padStart(2, '0')
      return (
        <TextElement
          box={box}
          text={text}
          fontFamily={typographyFontFamily('display')}
          fontWeight={900}
          fontSize={fontSizeFor('number', element.size, 'high-contrast')}
          fill={palette.accent}
          align="center"
        />
      )
    }

    case 'callout':
      return (
        <CalloutShape
          box={box}
          text={element.role}
          fill={palette.accent}
          textFill={palette.accentFg}
        />
      )

    case 'badge':
      return (
        <BadgeShape
          box={box}
          text={element.role}
          fill={palette.subtle}
          textFill={palette.fg}
        />
      )

    case 'image':
    case 'decoration':
    case 'logo':
      return (
        <PlaceholderRect
          box={box}
          label={`${element.type.toUpperCase()} · ${element.role}`}
          fill={element.type === 'logo' ? palette.subtle : palette.placeholder}
          labelFill={palette.placeholderLabel}
        />
      )

    default:
      return null
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Element subcomponents
// ─────────────────────────────────────────────────────────────────────────

function TextElement({
  box,
  text,
  fontFamily,
  fontWeight,
  fontSize,
  fill,
  align,
  fontStyle,
}: {
  box: Box
  text: string
  fontFamily: string
  fontWeight: number
  fontSize: number
  fill: string
  align: 'left' | 'center' | 'right'
  fontStyle?: string
}) {
  // Konva's fontStyle accepts a CSS-ish string like "italic 700" combining
  // style and weight. Combine here so we can drive both via props.
  const ks = fontStyle ? `${fontStyle} ${fontWeight}` : String(fontWeight)
  return (
    <Text
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      text={text}
      fontFamily={fontFamily}
      fontSize={fontSize}
      fontStyle={ks}
      fill={fill}
      align={align}
      verticalAlign="middle"
      wrap="word"
      lineHeight={1.15}
    />
  )
}

function CalloutShape({
  box,
  text,
  fill,
  textFill,
}: {
  box: Box
  text: string
  fill: string
  textFill: string
}) {
  // Pill/oval matching the reference language (e.g. @emily.the.recruiter's
  // oval callout stickers). For slice 1 we use a Circle for short text,
  // wider ellipse-via-Rect-with-corner-radius for longer.
  const isShort = text.length <= 12
  if (isShort) {
    const r = Math.min(box.width, box.height) / 2
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    return (
      <Group>
        <Circle x={cx} y={cy} radius={r} fill={fill} />
        <Text
          x={cx - r}
          y={cy - 24}
          width={r * 2}
          height={48}
          text={text}
          fontFamily="ui-sans-serif, sans-serif"
          fontStyle="600"
          fontSize={Math.max(18, r / 4)}
          fill={textFill}
          align="center"
          verticalAlign="middle"
        />
      </Group>
    )
  }
  return (
    <Group>
      <Rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill={fill}
        cornerRadius={box.height / 2}
      />
      <Text
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        text={text}
        fontFamily="ui-sans-serif, sans-serif"
        fontStyle="600"
        fontSize={Math.max(20, box.height * 0.35)}
        fill={textFill}
        align="center"
        verticalAlign="middle"
        padding={16}
      />
    </Group>
  )
}

function BadgeShape({
  box,
  text,
  fill,
  textFill,
}: {
  box: Box
  text: string
  fill: string
  textFill: string
}) {
  return (
    <Group>
      <Rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill={fill}
        cornerRadius={8}
      />
      <Text
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        text={text}
        fontFamily="ui-sans-serif, sans-serif"
        fontStyle="500"
        fontSize={Math.max(16, box.height * 0.5)}
        fill={textFill}
        align="center"
        verticalAlign="middle"
        padding={8}
      />
    </Group>
  )
}

function PlaceholderRect({
  box,
  label,
  fill,
  labelFill,
}: {
  box: Box
  label: string
  fill: string
  labelFill: string
}) {
  return (
    <Group>
      <Rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill={fill}
        cornerRadius={4}
      />
      <Text
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        text={label}
        fontFamily="ui-monospace, monospace"
        fontSize={24}
        fill={labelFill}
        align="center"
        verticalAlign="middle"
        padding={20}
      />
    </Group>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Layout math — region + size → box, font sizing, palette derivation
// ─────────────────────────────────────────────────────────────────────────

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Generous padding inside the slide so content doesn't kiss the edges. */
const PADDING = 60

/** Map element size to relative box dimensions inside the slide. */
function sizeToFraction(size: ElementSize): {
  w: number
  h: number
} {
  switch (size) {
    case 'small':
      return { w: 0.35, h: 0.12 }
    case 'medium':
      return { w: 0.6, h: 0.2 }
    case 'large':
      return { w: 0.85, h: 0.35 }
    case 'full':
      return { w: 1, h: 1 }
  }
}

/**
 * Convert a region + size to a positioned Box in slide coordinates.
 * Element type can adjust the box (e.g. callouts and numbers stay
 * square-ish; images can be more rectangular).
 */
function regionToBox(
  region: Region,
  size: ElementSize,
  type: ElementType,
): Box {
  if (region === 'full-bleed' || region === 'overlay') {
    return { x: 0, y: 0, width: SLIDE_W, height: SLIDE_H }
  }

  const frac = sizeToFraction(size)
  let w = SLIDE_W * frac.w
  let h = SLIDE_H * frac.h

  // Callout / number / badge shapes look better at consistent aspect
  // ratios (circular-ish or pill-shaped) rather than the wide text band
  // defaults. Clamp height proportional to width.
  if (type === 'callout' || type === 'number' || type === 'badge') {
    const target = Math.min(w, h * 2.5)
    w = target
    h = type === 'callout' ? target * 0.6 : target * 0.45
  }

  // Image/decoration/logo look better square or near-square at small/medium.
  if (
    (type === 'image' || type === 'decoration' || type === 'logo') &&
    size !== 'full'
  ) {
    if (size === 'small') h = w
  }

  // Map region to anchor; compute (x, y) from anchor.
  const [vBand, hBand] = parseRegion(region)
  const vAvail = SLIDE_H - 2 * PADDING
  const hAvail = SLIDE_W - 2 * PADDING

  let x: number
  switch (hBand) {
    case 'left':
      x = PADDING
      break
    case 'center':
      x = PADDING + (hAvail - w) / 2
      break
    case 'right':
      x = SLIDE_W - PADDING - w
      break
  }

  let y: number
  switch (vBand) {
    case 'top':
      y = PADDING
      break
    case 'middle':
      y = PADDING + (vAvail - h) / 2
      break
    case 'bottom':
      y = SLIDE_H - PADDING - h
      break
  }

  return { x, y, width: w, height: h }
}

function parseRegion(
  r: Region,
): ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right'] {
  // Caller guards against full-bleed/overlay; only the 3×3 grid lands here.
  const [v, h] = r.split('-') as [
    'top' | 'middle' | 'bottom',
    'left' | 'center' | 'right',
  ]
  return [v, h]
}

/** Approximate text alignment from the region's horizontal band. */
function textAlignFromRegion(
  region: Region,
  globalAlignment: 'left' | 'center' | 'right' | 'mixed',
): 'left' | 'center' | 'right' {
  if (region === 'full-bleed' || region === 'overlay') {
    return globalAlignment === 'mixed' ? 'center' : globalAlignment
  }
  const [, h] = parseRegion(region)
  return h
}

/**
 * Resolve a typography category to a CSS font-family stack. Slice 1 uses
 * generic fallbacks; loading the actual family from headlineFontGuesses
 * is its own slice.
 */
function typographyFontFamily(
  cat: 'serif' | 'sans' | 'display' | 'monospace',
): string {
  switch (cat) {
    case 'serif':
      return 'ui-serif, Georgia, serif'
    case 'sans':
      return 'ui-sans-serif, system-ui, sans-serif'
    case 'display':
      // Display fonts are a stand-in until we load real families. Bold
      // serif gives a reasonable editorial feel that survives the next
      // upgrade better than condensed-sans would.
      return '"Playfair Display", "Times New Roman", ui-serif, serif'
    case 'monospace':
      return 'ui-monospace, "SF Mono", Menlo, monospace'
  }
}

function typographyWeight(
  w: 'light' | 'regular' | 'medium' | 'bold' | 'black',
): number {
  switch (w) {
    case 'light':
      return 300
    case 'regular':
      return 400
    case 'medium':
      return 500
    case 'bold':
      return 700
    case 'black':
      return 900
  }
}

/**
 * Resolve a font size in slide-coordinate pixels based on element type,
 * its size hint, and the carousel's typography hierarchy strength.
 * Hierarchy = high-contrast amplifies the headline-vs-body gap.
 */
function fontSizeFor(
  type: 'headline' | 'body' | 'quote' | 'number',
  size: ElementSize,
  hierarchy: 'high-contrast' | 'subtle',
): number {
  const hierMul = hierarchy === 'high-contrast' ? 1.25 : 1
  const base = {
    headline: { small: 44, medium: 72, large: 112, full: 156 },
    body: { small: 28, medium: 36, large: 44, full: 52 },
    quote: { small: 36, medium: 56, large: 88, full: 124 },
    number: { small: 96, medium: 192, large: 288, full: 384 },
  }[type][size]
  // Body shrinks (not grows) under high-contrast hierarchy — the gap
  // widens by reducing body, not by ballooning headline beyond the box.
  if (type === 'body')
    return Math.round(base / (hierarchy === 'high-contrast' ? 1.1 : 1))
  return Math.round(base * hierMul)
}

// ─────────────────────────────────────────────────────────────────────────
// Palette derivation — turn the unified style into renderer-ready colors
// ─────────────────────────────────────────────────────────────────────────

interface Palette {
  bg: string
  bgAccent: string
  fg: string
  accent: string
  accentFg: string
  subtle: string
  placeholder: string
  placeholderLabel: string
}

function derivePalette(style: CarouselStyle): Palette {
  const primary = style.colors.primary[0] ?? '#111111'
  const primary2 = style.colors.primary[1] ?? primary
  const accent = style.colors.accents[0] ?? '#FFFFFF'
  const isDark = style.background.mood === 'dark'

  // For dark moods, primary likely IS the dark background; flip foreground.
  // For light moods, primary likely IS the light background. high-contrast
  // is treated as dark for slice 1 — the references both lean dark when
  // mood=high-contrast.
  const bg =
    style.background.type === 'solid'
      ? primary
      : isDark
        ? primary
        : style.background.type === 'gradient'
          ? primary
          : primary

  const fg = isDark ? '#FFFFFF' : '#111111'

  // Accent foreground — choose whichever of white/black contrasts more
  // against the accent. Simple luminance threshold.
  const accentFg = readableTextColor(accent)

  return {
    bg,
    bgAccent: primary2,
    fg,
    accent,
    accentFg,
    subtle: withAlpha(fg, 0.12),
    placeholder: withAlpha(accent, 0.15),
    placeholderLabel: withAlpha(fg, 0.5),
  }
}

/** White or black, whichever reads better on top of the given hex color. */
function readableTextColor(hex: string): string {
  const { r, g, b } = parseHex(hex)
  // Standard luminance formula.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#111111' : '#FFFFFF'
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '')
  if (m.length === 3) {
    return {
      r: Number.parseInt(m[0]! + m[0], 16),
      g: Number.parseInt(m[1]! + m[1], 16),
      b: Number.parseInt(m[2]! + m[2], 16),
    }
  }
  return {
    r: Number.parseInt(m.slice(0, 2), 16),
    g: Number.parseInt(m.slice(2, 4), 16),
    b: Number.parseInt(m.slice(4, 6), 16),
  }
}

function withAlpha(hex: string, a: number): string {
  const { r, g, b } = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
