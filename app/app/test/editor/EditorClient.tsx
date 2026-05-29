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
import { Group, Layer, Rect, Stage, Text } from 'react-konva'

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
  /** Literal display text bound to this slot by the synthesizer. */
  content?: string
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  // fontsReady flips to true once Google Fonts requested for this carousel
  // have loaded. Used as a render key so Konva re-measures text in the real
  // typeface instead of the fallback. Without this, the canvas keeps the
  // fallback measurement and the font swap looks broken.
  const [fontsReady, setFontsReady] = useState(false)

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

  // Font loading. Read the synthesized font guesses from the payload's
  // style and request them from Google Fonts. If the family isn't on
  // Google Fonts the link 404s silently and the font-stack fallback
  // kicks in — no error state needed. When the fonts finish loading,
  // we flip a render key so Konva re-measures text in the real face
  // instead of the system fallback it used during the first paint.
  useEffect(() => {
    if (!payload) return

    const headlineFamily =
      payload.plan.style.typography.headlineFontGuesses[0]?.family
    const bodyFamily = payload.plan.style.typography.bodyFontGuesses[0]?.family
    const families = [headlineFamily, bodyFamily].filter(
      (f): f is string => Boolean(f && f.trim()),
    )
    if (families.length === 0) {
      setFontsReady(true)
      return
    }

    // Build the Google Fonts URL. Format:
    //   https://fonts.googleapis.com/css2?family=Name:wght@400;500;700&family=Other:wght@400;700&display=swap
    // Spaces in family names become '+'. We request a generous weight
    // range so any weight Konva asks for has something to render with.
    const params = families
      .map(
        (f) =>
          `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300;400;500;600;700;900`,
      )
      .join('&')
    const href = `https://fonts.googleapis.com/css2?${params}&display=swap`

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)

    // Wait for the fonts to actually be ready. document.fonts.ready
    // resolves once all currently-pending font loads complete. There's
    // a small chance the link's @font-face declarations aren't yet
    // parsed when we check — a microtask delay is enough to be safe.
    let cancelled = false
    Promise.resolve()
      .then(() => document.fonts.ready)
      .then(() => {
        if (!cancelled) setFontsReady(true)
      })
      .catch(() => {
        // If fonts.ready rejects for any reason, render anyway with
        // fallback fonts. Better than blocking forever.
        if (!cancelled) setFontsReady(true)
      })

    return () => {
      cancelled = true
      if (link.parentNode) link.parentNode.removeChild(link)
    }
  }, [payload])

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
      {/* Header — minimal: back link, carousel identity, details toggle */}
      <header className="flex items-center justify-between border-b border-neutral-900 px-6 py-3">
        <div className="flex items-center gap-4">
          <Link
            href="/test/funnel"
            className="text-sm text-neutral-500 transition hover:text-neutral-200"
          >
            ← Funnel
          </Link>
          <div>
            <h1 className="text-sm font-medium">
              {payload.script.niche}
              {payload.script.subNiche ? ` · ${payload.script.subNiche}` : ''}
            </h1>
            <p className="text-[11px] text-neutral-500">
              {payload.plan.slides.length} slides · Slide {currentIndex + 1}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          className="rounded border border-neutral-800 px-2.5 py-1 text-[11px] text-neutral-400 transition hover:border-neutral-700 hover:text-neutral-200"
        >
          {detailsOpen ? 'Hide details' : 'Details'}
        </button>
      </header>

      <div className="grid grid-cols-[14rem_1fr] gap-0">
        {/* Left rail — slide list. Stripped of purpose pills and other
            technical chrome; just slide number + the first line of the
            content so the user can navigate by what's on each slide. */}
        <aside className="border-r border-neutral-900 px-3 py-4">
          <div className="space-y-0.5">
            {payload.plan.slides.map((slide, i) => (
              <button
                key={slide.slideIndex}
                type="button"
                onClick={() => setCurrentIndex(i)}
                className={`flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left transition ${
                  i === currentIndex
                    ? 'bg-neutral-800 text-neutral-100'
                    : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
                }`}
              >
                <span className="font-mono text-[10px] text-neutral-500">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="flex-1 truncate text-[11px]">
                  {payload.script.slides[i]?.headline ?? slide.composition}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Center — canvas. The product. */}
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
                key={fontsReady ? 'fonts-ready' : 'fonts-loading'}
                slidePlan={currentSlide}
                style={payload.plan.style}
                scriptSlide={currentScriptSlide}
              />
            )}
          </div>
        </section>
      </div>

      {/* Details slide-over — only mounted when user requests it. */}
      {detailsOpen && currentSlide && (
        <DetailsPanel
          slide={currentSlide}
          references={payload.references}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </main>
  )
}

// ────────────────────────────────────────────────────────────────────────
// DetailsPanel — slide-over surfacing the synthesis metadata
//
// Hidden by default. Surfaces composition, rationale, elements, and
// "draws from" attributions for users who want to know why the AI made
// the choices it did. Most users will never open this; for those who
// do, it should feel like a glance into the AI's reasoning.
// ────────────────────────────────────────────────────────────────────────

function DetailsPanel({
  slide,
  references,
  onClose,
}: {
  slide: SlidePlan
  references: EditorPayload['references']
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-y-0 right-0 z-50 w-80 overflow-y-auto border-l border-neutral-800 bg-neutral-950 px-5 py-4 shadow-2xl"
      role="dialog"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-300">
          Slide details
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-200"
          aria-label="Close details"
        >
          ×
        </button>
      </div>
      <div className="space-y-4 text-xs">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Composition
          </div>
          <div className="mt-1 text-neutral-200">{slide.composition}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Rationale
          </div>
          <p className="mt-1 leading-relaxed text-neutral-300">
            {slide.rationale}
          </p>
        </div>
        {slide.elements.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              Elements ({slide.elements.length})
            </div>
            <ul className="mt-1.5 space-y-1">
              {slide.elements.map((el, i) => (
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
        {slide.drawsFrom.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              Draws from
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {slide.drawsFrom.map((d, i) => {
                const ref = references.find((r) => r.id === d.refId)
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
    </div>
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

  // Pre-compute every element's box in a single layout pass. This is
  // layout-aware: elements at middle-left and middle-right are
  // recognized as a 2-column row and share horizontal space, instead
  // of each being given 60% of slide width and overlapping in the
  // middle. Overlay elements get type-specific positioning.
  const boxes = useMemo(
    () => computeBoxes(slidePlan.elements),
    [slidePlan.elements],
  )

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
        {slidePlan.elements.map((el, i) => {
          const box = boxes[i]
          if (!box) return null
          return (
            <ElementShape
              key={i}
              element={el}
              box={box}
              style={style}
              palette={palette}
              scriptSlide={scriptSlide}
              slideIndex={slidePlan.slideIndex}
            />
          )
        })}
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

  // Solid: single Rect fill, with subtle vignette overlay for depth.
  if (bgType === 'solid') {
    return (
      <Group>
        <Rect x={0} y={0} width={SLIDE_W} height={SLIDE_H} fill={palette.bg} />
        <VignetteOverlay palette={palette} />
      </Group>
    )
  }

  // Gradient: Konva supports linear gradients via fillLinearGradient* props.
  // Multi-stop for richer depth than a two-color linear ramp.
  if (bgType === 'gradient') {
    return (
      <Group>
        <Rect
          x={0}
          y={0}
          width={SLIDE_W}
          height={SLIDE_H}
          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
          fillLinearGradientEndPoint={{ x: SLIDE_W, y: SLIDE_H }}
          fillLinearGradientColorStops={[
            0,
            palette.bgAccent,
            0.5,
            palette.bg,
            1,
            palette.bg,
          ]}
        />
        <VignetteOverlay palette={palette} />
      </Group>
    )
  }

  // Texture: solid color base + grain noise overlay. The noise overlay
  // gives the film-grain feel the references have without needing AI
  // gen yet (Slice 2 will replace with AI-generated textures for
  // higher fidelity).
  if (bgType === 'texture') {
    return (
      <Group>
        <Rect x={0} y={0} width={SLIDE_W} height={SLIDE_H} fill={palette.bg} />
        <GrainOverlay opacity={0.22} />
        <VignetteOverlay palette={palette} />
      </Group>
    )
  }

  // Photo / photo-overlay: until Slice 2 wires AI-generated photos,
  // approximate the mood with a darker tinted gradient + grain. Not a
  // real photo, but reads as "image background" rather than "wireframe".
  return (
    <Group>
      <Rect
        x={0}
        y={0}
        width={SLIDE_W}
        height={SLIDE_H}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: SLIDE_H }}
        fillLinearGradientColorStops={[
          0,
          palette.bgAccent,
          1,
          palette.bg,
        ]}
      />
      <GrainOverlay opacity={0.18} />
      <VignetteOverlay palette={palette} strong />
    </Group>
  )
}

/**
 * Film-grain overlay. Generates a small noise canvas once on mount and
 * tiles it across the slide via Konva's pattern-fill mechanism. The
 * canvas is grayscale random noise; we apply with low opacity and a
 * multiply composite so it darkens the underlying color naturally
 * rather than washing it out.
 */
function GrainOverlay({ opacity = 0.2 }: { opacity?: number }) {
  const [pattern, setPattern] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    // 256×256 is a sweet spot — large enough that the tile isn't
    // visibly repeating at slide scale; small enough to generate fast.
    const TILE = 256
    const canvas = document.createElement('canvas')
    canvas.width = TILE
    canvas.height = TILE
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const imgData = ctx.createImageData(TILE, TILE)
    for (let i = 0; i < imgData.data.length; i += 4) {
      // Bias the noise slightly dark so the multiply blend mode has
      // something to multiply with. Pure mid-gray gives almost no
      // visible grain.
      const v = 60 + Math.random() * 195
      imgData.data[i] = v
      imgData.data[i + 1] = v
      imgData.data[i + 2] = v
      imgData.data[i + 3] = 255
    }
    ctx.putImageData(imgData, 0, 0)
    const img = new window.Image()
    img.src = canvas.toDataURL()
    img.onload = () => setPattern(img)
  }, [])

  if (!pattern) return null
  return (
    <Rect
      x={0}
      y={0}
      width={SLIDE_W}
      height={SLIDE_H}
      fillPatternImage={pattern}
      fillPatternRepeat="repeat"
      opacity={opacity}
      globalCompositeOperation="multiply"
      listening={false}
    />
  )
}

/**
 * Subtle vignette — darkens the corners slightly to give the slide a
 * little depth. References-style carousels typically have a tiny bit
 * of edge darkening; without it everything looks flat.
 */
function VignetteOverlay({
  palette,
  strong = false,
}: {
  palette: Palette
  strong?: boolean
}) {
  const cx = SLIDE_W / 2
  const cy = SLIDE_H / 2
  const innerR = SLIDE_W * 0.4
  const outerR = SLIDE_W * 0.75
  const edgeAlpha = strong ? 0.45 : 0.2
  // Use the bg color, darkened, for the vignette so it complements
  // rather than tints. For light backgrounds, vignette goes light too
  // (rare but possible with mood=light).
  const vignetteColor = palette.bgIsDark
    ? `rgba(0, 0, 0, ${edgeAlpha})`
    : `rgba(0, 0, 0, ${edgeAlpha * 0.6})`
  return (
    <Rect
      x={0}
      y={0}
      width={SLIDE_W}
      height={SLIDE_H}
      fillRadialGradientStartPoint={{ x: cx, y: cy }}
      fillRadialGradientStartRadius={innerR}
      fillRadialGradientEndPoint={{ x: cx, y: cy }}
      fillRadialGradientEndRadius={outerR}
      fillRadialGradientColorStops={[0, 'rgba(0,0,0,0)', 1, vignetteColor]}
      listening={false}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────
// ElementShape — dispatch on element.type
// ─────────────────────────────────────────────────────────────────────────

function ElementShape({
  element,
  box,
  style,
  palette,
  scriptSlide,
  slideIndex,
}: {
  element: LayoutElement
  box: Box
  style: CarouselStyle
  palette: Palette
  scriptSlide: ScriptSlide
  slideIndex: number
}) {
  // Pre-resolve preferred font families once per render. The Google
  // Fonts CSS link was already injected when the payload loaded.
  const headlineFamily =
    style.typography.headlineFontGuesses[0]?.family
  const bodyFamily = style.typography.bodyFontGuesses[0]?.family

  switch (element.type) {
    case 'headline':
      return (
        <TextElement
          box={box}
          text={element.content ?? scriptSlide.headline}
          fontFamily={typographyFontFamily(
            style.typography.headlineStyle,
            headlineFamily,
          )}
          fontWeight={typographyWeight(style.typography.headlineWeight)}
          fontSize={fontSizeToFit(
            element.content ?? scriptSlide.headline,
            box,
            headlineBaseSize(
              element.content ?? scriptSlide.headline,
              element.size,
              style.typography.hierarchy,
            ),
          )}
          fill={palette.fg}
          align={textAlignFromRegion(element.region, style.layout.alignment)}
          letterSpacing={
            style.typography.headlineStyle === 'display' ? -1 : -0.5
          }
        />
      )

    case 'body':
      return (
        <TextElement
          box={box}
          text={element.content ?? scriptSlide.body ?? ''}
          fontFamily={typographyFontFamily(
            style.typography.bodyStyle,
            bodyFamily,
          )}
          fontWeight={400}
          fontSize={fontSizeToFit(
            element.content ?? scriptSlide.body ?? '',
            box,
            fontSizeFor('body', element.size, style.typography.hierarchy),
          )}
          fill={palette.fg}
          align={textAlignFromRegion(element.region, style.layout.alignment)}
        />
      )

    case 'quote':
      return (
        <TextElement
          box={box}
          text={element.content ?? scriptSlide.body ?? scriptSlide.headline}
          fontFamily={typographyFontFamily(
            style.typography.headlineStyle,
            headlineFamily,
          )}
          fontWeight={typographyWeight(style.typography.headlineWeight)}
          fontSize={fontSizeToFit(
            element.content ?? scriptSlide.body ?? scriptSlide.headline,
            box,
            fontSizeFor('quote', element.size, style.typography.hierarchy),
          )}
          fill={palette.fg}
          fontStyle="italic"
          align={textAlignFromRegion(element.region, style.layout.alignment)}
        />
      )

    case 'number': {
      // Prefer explicit content; else pull a numeric token from the
      // role; else fall back to the slide position.
      const numericFromRole = element.role.match(/[0-9$.,KMB]+/)?.[0]
      const text =
        element.content ??
        numericFromRole ??
        String(slideIndex + 1).padStart(2, '0')
      return (
        <TextElement
          box={box}
          text={text}
          fontFamily={typographyFontFamily('display', headlineFamily)}
          fontWeight={900}
          fontSize={fontSizeToFit(
            text,
            box,
            fontSizeFor('number', element.size, 'high-contrast'),
          )}
          fill={palette.accent}
          align="center"
          letterSpacing={-2}
        />
      )
    }

    case 'callout':
      return (
        <CalloutShape
          box={box}
          text={element.content ?? element.role}
          fill={palette.accent}
          textFill={palette.accentFg}
        />
      )

    case 'badge':
      return (
        <BadgeShape
          box={box}
          text={element.content ?? element.role}
          fill={palette.subtle}
          textFill={palette.fg}
        />
      )

    case 'decoration':
      // Decorations are visual dividers/accents, not labeled boxes.
      // Render an actual divider line (vertical or horizontal based on
      // the box's aspect) in the accent color.
      return <DecorationShape box={box} palette={palette} />

    case 'logo':
      // No real brand asset exists until the creator supplies one.
      // Rendering a big gray placeholder box here was the loudest
      // "unfinished" artifact in the output — it landed on every slide.
      // Until there's an actual logo to draw, render nothing: an empty
      // gap reads as intentional negative space; a labeled gray box does
      // not. (Synthesis will also stop stamping a logo on every slide.)
      return null

    case 'image':
      // Until Slice 2 wires real imagery, an image slot stays a faint
      // tinted block so the composition still reserves its space — but
      // unlabeled, so it whispers "image goes here" instead of shouting.
      return (
        <PlaceholderRect
          box={box}
          label=""
          fill={palette.placeholder}
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
  letterSpacing,
}: {
  box: Box
  text: string
  fontFamily: string
  fontWeight: number
  fontSize: number
  fill: string
  align: 'left' | 'center' | 'right'
  fontStyle?: string
  letterSpacing?: number
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
      letterSpacing={letterSpacing}
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
  // Oval/pill shape — matches the references' oval-callout-sticker
  // motif. A Rect with cornerRadius=min(w,h)/2 produces a true pill on
  // wide boxes and a circle on square boxes, which is more flexible
  // than a strict Konva Circle node.
  const cornerR = Math.min(box.width, box.height) / 2

  // Font sizing: scale by the smaller dimension so text fits inside
  // the oval. Shorter text gets a larger font; longer text gets
  // smaller, with a floor so it stays legible.
  const lengthBudget = (box.width * box.height) / Math.max(text.length, 1)
  const baseFontSize = Math.sqrt(lengthBudget) * 0.65
  const fontSize = Math.max(22, Math.min(box.height * 0.32, baseFontSize))

  // Inner padding tracks the oval's curvature — text needs to stay
  // off the rounded edges. About 18% of the smaller dimension is a
  // reasonable visual margin.
  const innerPad = Math.min(box.width, box.height) * 0.18

  // Shadow gives the callout dimensionality — it stops looking like a
  // flat cutout and starts looking like an applied sticker.
  const shadowBlur = Math.min(40, box.height * 0.25)
  const shadowOffsetY = Math.min(12, box.height * 0.08)

  // Subtle radial gradient adds a touch of internal lighting variation
  // so the callout doesn't look like a solid color blob. Inner highlight
  // is just a hint lighter than the base fill.
  const highlight = lightenHex(fill, 0.08)

  return (
    <Group>
      <Rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fillRadialGradientStartPoint={{
          x: box.width * 0.4,
          y: box.height * 0.35,
        }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndPoint={{
          x: box.width * 0.5,
          y: box.height * 0.5,
        }}
        fillRadialGradientEndRadius={Math.max(box.width, box.height) * 0.6}
        fillRadialGradientColorStops={[0, highlight, 1, fill]}
        cornerRadius={cornerR}
        shadowColor="rgba(0, 0, 0, 0.35)"
        shadowBlur={shadowBlur}
        shadowOffsetX={0}
        shadowOffsetY={shadowOffsetY}
        shadowOpacity={1}
      />
      <Text
        x={box.x + innerPad}
        y={box.y}
        width={box.width - innerPad * 2}
        height={box.height}
        text={text}
        fontFamily="ui-sans-serif, sans-serif"
        fontStyle="600"
        fontSize={fontSize}
        fill={textFill}
        align="center"
        verticalAlign="middle"
        wrap="word"
        lineHeight={1.1}
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
        cornerRadius={8}
      />
      {label ? (
        <Text
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          text={label}
          fontFamily="ui-sans-serif, sans-serif"
          fontSize={24}
          fill={labelFill}
          align="center"
          verticalAlign="middle"
          padding={20}
        />
      ) : null}
    </Group>
  )
}

/**
 * Decoration — a visual divider or accent line, not a labeled box.
 * Orientation follows the box aspect: tall box → vertical divider,
 * wide box → horizontal divider. Rendered as a thin rounded bar in a
 * subtle foreground tint so it reads as a separator, not content.
 */
function DecorationShape({ box, palette }: { box: Box; palette: Palette }) {
  const isVertical = box.height >= box.width
  const thickness = 4
  if (isVertical) {
    const cx = box.x + box.width / 2
    return (
      <Rect
        x={cx - thickness / 2}
        y={box.y + box.height * 0.1}
        width={thickness}
        height={box.height * 0.8}
        fill={withAlpha(palette.fg, 0.25)}
        cornerRadius={thickness / 2}
        listening={false}
      />
    )
  }
  const cy = box.y + box.height / 2
  return (
    <Rect
      x={box.x + box.width * 0.1}
      y={cy - thickness / 2}
      width={box.width * 0.8}
      height={thickness}
      fill={withAlpha(palette.fg, 0.25)}
      cornerRadius={thickness / 2}
      listening={false}
    />
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
 * Compute the rendered box for every element on the slide in a single
 * pass. Layout-aware: when multiple elements share a row (vertical
 * band), they share that row's horizontal space as columns instead of
 * each taking 60% of slide width and overlapping in the middle.
 *
 * Algorithm:
 *   1. Separate elements into full-bleed, overlay, and in-grid.
 *   2. Full-bleed → entire slide.
 *   3. In-grid → group by vertical band (top/middle/bottom). For each
 *      band, detect which horizontal bands are present (left/center/
 *      right). The count of present bands = number of columns. Each
 *      element is sized within its column, not the full slide.
 *      Multiple elements in the same column-row cell stack vertically.
 *   4. Overlay → positioned and sized per element type. Callouts go
 *      to a small accent position; images become full-bleed; etc.
 */
function computeBoxes(elements: LayoutElement[]): Box[] {
  const boxes: Box[] = new Array(elements.length)
  const fullBleedIdx: number[] = []
  const overlayIdx: number[] = []
  const inGridIdx: number[] = []

  elements.forEach((el, i) => {
    if (el.region === 'full-bleed') fullBleedIdx.push(i)
    else if (el.region === 'overlay') overlayIdx.push(i)
    else inGridIdx.push(i)
  })

  // 1. Full-bleed: the whole slide.
  for (const i of fullBleedIdx) {
    boxes[i] = { x: 0, y: 0, width: SLIDE_W, height: SLIDE_H }
  }

  // 2. In-grid: lay out via row-bands → columns.
  layoutInGrid(elements, inGridIdx, boxes)

  // 3. Overlay: positioned per type.
  layoutOverlays(elements, overlayIdx, boxes)

  return boxes
}

/**
 * Lay out the elements that live in the 3×3 region grid. Splits into
 * row-bands (top/middle/bottom), determines column count per band from
 * which horizontal bands are present, then distributes elements within
 * each column.
 */
function layoutInGrid(
  elements: LayoutElement[],
  indices: number[],
  boxes: Box[],
) {
  const byRow: Record<VBand, number[]> = { top: [], middle: [], bottom: [] }
  for (const i of indices) {
    const el = elements[i]
    if (!el) continue
    const [v] = parseRegion(el.region as GridRegion)
    byRow[v].push(i)
  }

  // Vertical band layout: split slide into 3 horizontal strips with
  // some headroom for visual balance. Top/bottom strips get slightly
  // less than middle so headlines have room to breathe.
  const ROW_GAP = 40
  const rowHeights = computeRowHeights(byRow)
  let cursorY = PADDING

  for (const band of ['top', 'middle', 'bottom'] as const) {
    const rowIndices = byRow[band]
    if (rowIndices.length === 0) {
      cursorY += rowHeights[band] + ROW_GAP
      continue
    }

    layoutRow(elements, rowIndices, boxes, cursorY, rowHeights[band])
    cursorY += rowHeights[band] + ROW_GAP
  }
}

/**
 * Allocate row heights based on which bands have content. Empty bands
 * collapse so the populated content uses more of the canvas. Middle
 * gets a small bonus when present (it's typically where the headline
 * sits and benefits from breathing room).
 */
function computeRowHeights(
  byRow: Record<VBand, number[]>,
): Record<VBand, number> {
  const ROW_GAP = 40
  const totalH = SLIDE_H - 2 * PADDING
  const populated = (['top', 'middle', 'bottom'] as const).filter(
    (b) => byRow[b].length > 0,
  )

  if (populated.length === 0) {
    return { top: 0, middle: 0, bottom: 0 }
  }

  const totalGap = ROW_GAP * (populated.length - 1)
  const availH = totalH - totalGap

  // Weight middle row slightly heavier when present.
  const weights: Record<VBand, number> = { top: 1, middle: 1.2, bottom: 1 }
  const presentWeightSum = populated.reduce((sum, b) => sum + weights[b], 0)

  return {
    top: byRow.top.length > 0 ? (weights.top / presentWeightSum) * availH : 0,
    middle:
      byRow.middle.length > 0
        ? (weights.middle / presentWeightSum) * availH
        : 0,
    bottom:
      byRow.bottom.length > 0
        ? (weights.bottom / presentWeightSum) * availH
        : 0,
  }
}

/**
 * Distribute elements across columns within a single row band.
 * Detects column count from the horizontal bands present among the
 * row's elements. Stacks elements vertically when multiple share the
 * same column-row cell.
 */
function layoutRow(
  elements: LayoutElement[],
  rowIndices: number[],
  boxes: Box[],
  rowY: number,
  rowHeight: number,
) {
  // Group by h-band within this row.
  const byCol: Record<HBand, number[]> = { left: [], center: [], right: [] }
  for (const i of rowIndices) {
    const el = elements[i]
    if (!el) continue
    const [, h] = parseRegion(el.region as GridRegion)
    byCol[h].push(i)
  }

  const activeColumns: HBand[] = (['left', 'center', 'right'] as const).filter(
    (b) => byCol[b].length > 0,
  )
  const colCount = activeColumns.length
  const COL_GAP = colCount > 1 ? 50 : 0
  const totalW = SLIDE_W - 2 * PADDING
  const colWidth = (totalW - COL_GAP * (colCount - 1)) / colCount

  activeColumns.forEach((colBand, colIdx) => {
    const colIndices = byCol[colBand]
    const colX = PADDING + colIdx * (colWidth + COL_GAP)

    // Distribute the column's vertical space among elements that
    // stack within it. Each gets an equal-share slot; large/full-size
    // elements get a wider slot if there's no contention.
    const slotH = rowHeight / colIndices.length

    colIndices.forEach((elIdx, stackIdx) => {
      const el = elements[elIdx]
      if (!el) return
      const slotY = rowY + stackIdx * slotH
      boxes[elIdx] = boxForCell(el, colX, slotY, colWidth, slotH)
    })
  })
}

/**
 * Compute the actual box for one element within an allocated cell
 * (column-stack slot). Adjusts the box's shape and centering based on
 * element type — compact shapes (callout, number, badge) are sized as
 * pills/circles centered in the cell; text and image elements fill
 * more of the cell.
 */
function boxForCell(
  el: LayoutElement,
  cellX: number,
  cellY: number,
  cellW: number,
  cellH: number,
): Box {
  const frac = sizeToFraction(el.size)

  if (el.type === 'callout' || el.type === 'number' || el.type === 'badge') {
    // Compact shapes: stay aspect-bounded and centered in the cell.
    // Choose width based on size hint but cap at cell width minus
    // some breathing room.
    const targetW = Math.min(cellW * 0.85, 320 + frac.w * 200)
    const aspect = el.type === 'callout' ? 0.6 : el.type === 'badge' ? 0.4 : 1.1
    const targetH = Math.min(cellH * 0.85, targetW * aspect)
    return {
      x: cellX + (cellW - targetW) / 2,
      y: cellY + (cellH - targetH) / 2,
      width: targetW,
      height: targetH,
    }
  }

  if (el.type === 'image' || el.type === 'decoration' || el.type === 'logo') {
    // Visual blocks: respect size hint but cap to the cell.
    const targetW = cellW * Math.min(1, 0.7 + frac.w * 0.3)
    const targetH = cellH * Math.min(1, 0.7 + frac.h * 1.5)
    return {
      x: cellX + (cellW - targetW) / 2,
      y: cellY + (cellH - targetH) / 2,
      width: targetW,
      height: targetH,
    }
  }

  // Text-bearing elements (headline, body, quote): use most of the
  // cell so wrapping has room.
  return {
    x: cellX,
    y: cellY,
    width: cellW,
    height: cellH,
  }
}

/**
 * Position overlay elements based on type. Overlay is semantic — "on
 * top of the rest" — not "fill the entire slide" (which is what the
 * old code did, producing the giant-yellow-circle bug).
 *
 *   - callout: small accent in a corner; top-right by default, or
 *     bottom-right if there's already a top-right element.
 *   - image: full-bleed background (Slice 2 will wire real imagery).
 *   - decoration: thin band along an edge.
 *   - other: centered medium pill near the top.
 */
function layoutOverlays(
  elements: LayoutElement[],
  indices: number[],
  boxes: Box[],
) {
  // Track which corners are already taken so multiple overlay callouts
  // don't stack on top of each other.
  const cornerOrder: Array<{ x: number; y: number }> = [
    { x: SLIDE_W - PADDING - 360, y: PADDING },              // top-right
    { x: PADDING, y: PADDING },                              // top-left
    { x: SLIDE_W - PADDING - 360, y: SLIDE_H - PADDING - 200 }, // bottom-right
    { x: PADDING, y: SLIDE_H - PADDING - 200 },              // bottom-left
  ]
  let cornerCursor = 0

  for (const i of indices) {
    const el = elements[i]
    if (!el) continue
    if (el.type === 'image') {
      boxes[i] = { x: 0, y: 0, width: SLIDE_W, height: SLIDE_H }
    } else if (el.type === 'decoration') {
      // Thin band along bottom
      boxes[i] = {
        x: 0,
        y: SLIDE_H - 100,
        width: SLIDE_W,
        height: 80,
      }
    } else if (
      el.type === 'callout' ||
      el.type === 'badge' ||
      el.type === 'logo'
    ) {
      const c = cornerOrder[cornerCursor % cornerOrder.length]!
      cornerCursor++
      // Size based on size hint; callouts pill-shaped, badges smaller
      const frac = sizeToFraction(el.size)
      const w = Math.min(360, 200 + frac.w * 200)
      const aspect = el.type === 'callout' ? 0.55 : 0.4
      const h = w * aspect
      boxes[i] = { x: c.x, y: c.y, width: w, height: h }
    } else {
      // Headlines/body/quote/number as overlays: centered medium block
      // near the top. Rare in synthesis output but defensible default.
      const w = SLIDE_W * 0.7
      const h = 200
      boxes[i] = {
        x: (SLIDE_W - w) / 2,
        y: PADDING + 40,
        width: w,
        height: h,
      }
    }
  }
}

type VBand = 'top' | 'middle' | 'bottom'
type HBand = 'left' | 'center' | 'right'
type GridRegion = Exclude<Region, 'full-bleed' | 'overlay'>

function parseRegion(r: GridRegion): [VBand, HBand] {
  const [v, h] = r.split('-') as [VBand, HBand]
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
  const [, h] = parseRegion(region as GridRegion)
  return h
}

/**
 * Resolve a typography category to a CSS font-family stack. When the
 * synthesizer named a specific font (via headlineFontGuesses /
 * bodyFontGuesses), we prefer that family at the front of the stack;
 * the editor's font-loading effect will have requested it from Google
 * Fonts. If the named font isn't available, the browser falls through
 * to the category-appropriate fallback below.
 */
function typographyFontFamily(
  cat: 'serif' | 'sans' | 'display' | 'monospace',
  preferredFamily?: string,
): string {
  const fallback = (() => {
    switch (cat) {
      case 'serif':
        return 'ui-serif, Georgia, serif'
      case 'sans':
        return 'ui-sans-serif, system-ui, sans-serif'
      case 'display':
        // Display fonts often want a high-impact serif/sans. Pick
        // something editorial as the final fallback.
        return '"Playfair Display", "Times New Roman", ui-serif, serif'
      case 'monospace':
        return 'ui-monospace, "SF Mono", Menlo, monospace'
    }
  })()
  if (preferredFamily && preferredFamily.trim()) {
    return `"${preferredFamily}", ${fallback}`
  }
  return fallback
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

/**
 * Headlines should be short — a phrase, not a sentence. Synthesis
 * sometimes types a full explanatory sentence as a `headline`, which
 * then renders at full headline scale and turns the slide into a wall
 * of shouting type (the comparison-slide failure mode). This demotes
 * the *base* size by word count before fit-to-box runs: a genuine short
 * headline keeps its punch; a sentence-length "headline" drops toward
 * body scale so hierarchy survives even when the upstream element type
 * is wrong. Renderer-side safety net for an upstream typing problem —
 * the real fix is in the synthesis prompt, this just stops the bleed.
 */
function headlineBaseSize(
  text: string,
  size: ElementSize,
  hierarchy: 'high-contrast' | 'subtle',
): number {
  const base = fontSizeFor('headline', size, hierarchy)
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (words <= 6) return base // genuine short headline — full impact
  if (words <= 12) return Math.round(base * 0.6) // long headline — tame it
  // A sentence typed as a headline: pull down to ~body scale (a touch
  // above, so it still leads) instead of dominating the slide.
  const bodyLead = Math.round(fontSizeFor('body', size, hierarchy) * 1.25)
  return Math.min(Math.round(base * 0.45), bodyLead)
}

/**
 * Scale a base font size down so the text fits within its box. Without
 * this, a long headline in a narrow column wraps into an extreme
 * vertical stack (one or two characters per line). Estimates the
 * rendered line count via average character width, then shrinks the
 * font until the wrapped text fits the box height — down to a floor.
 */
function fontSizeToFit(text: string, box: Box, baseSize: number): number {
  if (!text) return baseSize
  const FLOOR = 18
  let size = baseSize
  // Average glyph advance ≈ 0.55 of font size for typical proportional
  // fonts. Chars-per-line = box width / (size * 0.55).
  for (let i = 0; i < 12; i++) {
    const charsPerLine = Math.max(1, Math.floor(box.width / (size * 0.55)))
    const lines = Math.ceil(text.length / charsPerLine)
    const neededHeight = lines * size * 1.18
    if (neededHeight <= box.height || size <= FLOOR) break
    // Shrink proportionally toward fitting, with a little extra bite so
    // we converge in a few iterations.
    size = Math.max(FLOOR, size * Math.sqrt(box.height / neededHeight) * 0.95)
  }
  return Math.round(size)
}



interface Palette {
  bg: string
  bgAccent: string
  fg: string
  accent: string
  accentFg: string
  subtle: string
  placeholder: string
  placeholderLabel: string
  /** True when the background color is dark (mood='dark' or computed luminance is low). */
  bgIsDark: boolean
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

  // Determine bg darkness from the ACTUAL background color, not the
  // mood field. The synthesizer's mood and its primary color can
  // disagree (e.g. mood='light' but a dark primary), which produced
  // the dark-text-on-dark-background bug. The rendered color wins.
  const bgLum = colorLuminance(bg)
  const bgIsDark = bgLum < 0.5

  // Foreground follows the background: light text on dark bg, dark text
  // on light bg. Slightly softened from pure white/black for a less
  // harsh, more designed feel.
  const fg = bgIsDark ? '#F5F1E8' : '#1A1A1A'

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
    bgIsDark,
  }
}

function colorLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
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

/** Mix a hex color toward white by fraction (0..1). 0=original, 1=white. */
function lightenHex(hex: string, fraction: number): string {
  const { r, g, b } = parseHex(hex)
  const f = Math.max(0, Math.min(1, fraction))
  const lr = Math.round(r + (255 - r) * f)
  const lg = Math.round(g + (255 - g) * f)
  const lb = Math.round(b + (255 - b) * f)
  return `rgb(${lr}, ${lg}, ${lb})`
}
