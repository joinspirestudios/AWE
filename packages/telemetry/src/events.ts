/**
 * AWE telemetry — event taxonomy.
 *
 * Design rules:
 *  - Append-only. Every interaction is one immutable event. New event
 *    types never require a migration (the DB stores `type` + jsonb).
 *  - Privacy-first. We log DESIGN BEHAVIOUR, not user content: style
 *    fingerprints, enums, deltas, counts, costs. Never raw script text.
 *  - Forward-compatible. Asset-gen and critique events are defined NOW
 *    so the day the hybrid compositor ships, collection is already live.
 *  - Aggregatable. Visual devices use a CONTROLLED VOCABULARY
 *    (`VisualDevice`) — free-text would never group into a ranking.
 *
 * The "gold signal" is `element.edited`: every edit is the user
 * correcting where the system was wrong. Weight analysis accordingly.
 */

// ─────────────────────────────────────────────────────────────────────────
// Controlled vocabulary — the unit the "what to hardcode next" ranking
// aggregates over. Extend deliberately; do not free-text.
// ─────────────────────────────────────────────────────────────────────────

/** A distinct visual device a reference can contain. */
export type VisualDevice =
  // code-reproducible today
  | 'solid-fill-band'
  | 'bordered-box'
  | 'pill-callout'
  | 'badge'
  | 'oversized-numeral'
  | 'color-block'
  | 'divider-line'
  | 'highlight-swatch'
  | 'circle-motif'
  | 'plain-text'
  // typically needs a generated asset (hybrid compositor)
  | 'torn-paper-edge'
  | 'paper-grain'
  | 'halftone'
  | 'gradient-mesh'
  | 'hand-drawn-arrow'
  | 'sticker'
  | 'watercolor-blob'
  | 'photo-fullbleed'
  | 'photo-overlay'
  | 'collage-grid'
  | 'chart'
  | '3d-object'
  | 'custom-illustration'
  | 'other' // escape hatch — but log a free-text `deviceLabel` alongside

/** How a device was (or would be) produced. */
export type RenderMethod = 'code' | 'asset'

/** The editable fields a user can change — also the critique target space. */
export type EditableField =
  | 'text'
  | 'position'
  | 'size'
  | 'color'
  | 'font'
  | 'weight'
  | 'alignment'
  | 'container'
  | 'tone'
  | 'asset'

// ─────────────────────────────────────────────────────────────────────────
// Common envelope — every event carries these correlation + version keys.
// ─────────────────────────────────────────────────────────────────────────

export interface EventEnvelope {
  /** One creation session: upload → export or abandon. */
  sessionId: string
  userId?: string // nullable until auth exists
  carouselId?: string // the plan being worked on
  referenceId?: string // which uploaded reference (when relevant)
  slideIndex?: number // granular: which slide
  elementId?: string // granular: which element
  assetId?: string // generated asset (when relevant)
  client?: 'web' | 'api'
  /** Attribute quality shifts to releases. */
  appVersion?: string
  modelVersions?: {
    extract?: string
    synth?: string
    critique?: string
    image?: string
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Style fingerprint — a compact, privacy-safe summary of an extracted or
// synthesized StyleSpec. The primary DIMENSION events are grouped by.
// ─────────────────────────────────────────────────────────────────────────

export interface StyleFingerprint {
  bgType: 'solid' | 'gradient' | 'photo' | 'photo-overlay' | 'texture'
  bgMood: 'dark' | 'light' | 'high-contrast'
  headlineStyle: 'serif' | 'sans' | 'display' | 'monospace'
  bodyStyle: 'serif' | 'sans'
  headlineFamily?: string // extracted family name only (no PII)
  grid: 'tight' | 'loose' | 'asymmetric'
  fullBleed: boolean
  slidePattern: 'consistent' | 'varied' | 'progressive'
  paletteSize: number
  /** Short hash so identical references collapse to one fingerprint id. */
  hash: string
}

/** One detected device on a reference, with its routing decision. */
export interface DetectedDevice {
  device: VisualDevice
  deviceLabel?: string // free-text when device === 'other'
  method: RenderMethod // code vs needs-asset
  count: number // occurrences across the reference
  confidence: number // 0..1 classifier confidence
}

// ─────────────────────────────────────────────────────────────────────────
// Event payloads (discriminated union on `type`).
// ─────────────────────────────────────────────────────────────────────────

export type TelemetryEvent = EventEnvelope &
  (
    // ── Ingest ──────────────────────────────────────────────────────────
    | { type: 'reference.uploaded'; source: 'upload' | 'url'; slideCount: number; aspect?: string }
    | {
        type: 'reference.fetch' // scraping reliability + cost signal
        source: 'apify' | 'url'
        ok: boolean
        latencyMs: number
        costUsd?: number
        errorKind?: string
      }

    // ── Analyze ─────────────────────────────────────────────────────────
    | {
        type: 'reference.analyzed'
        fingerprint: StyleFingerprint
        devices: DetectedDevice[] // THE classification → demand ranking
        latencyMs: number
        costUsd?: number
      }
    | {
        type: 'script.analyzed'
        niche?: string
        tone?: string
        slideCount: number
        lengthBucket: 'xs' | 's' | 'm' | 'l' | 'xl' // never raw text
      }

    // ── Synthesize ──────────────────────────────────────────────────────
    | {
        type: 'plan.synthesized'
        fingerprint: StyleFingerprint
        compositions: string[] // per-slide composition labels
        elementTypeHistogram: Record<string, number>
        containerUsage: number // # elements using a container
        assetSpecsEmitted: { role: string; device: VisualDevice; count: number }[]
        latencyMs: number
        costUsd?: number
        tokens?: number
      }

    // ── Asset generation (hybrid compositor — fires once it ships) ───────
    | {
        type: 'asset.requested'
        role: string // 'background texture' | 'edge decoration' | ...
        device: VisualDevice
        promptHash: string
        cacheHit: boolean // cache vs fresh generation
      }
    | {
        type: 'asset.generated'
        role: string
        device: VisualDevice
        latencyMs: number
        costUsd: number
        confidence: number // 0..1 quality/placement confidence
        cacheHit: boolean
      }
    | { type: 'asset.failed'; role: string; device: VisualDevice; errorKind: string }

    // ── Render ──────────────────────────────────────────────────────────
    | { type: 'carousel.rendered'; slideCount: number; renderMs: number }

    // ── Critique loop (fires once it ships) ──────────────────────────────
    | {
        type: 'critique.run'
        iteration: number
        findings: {
          target: string // schema path, e.g. 'style.background.mood'
          observed: string
          referenceWants: string
          severity: 1 | 2 | 3 | 4 | 5
          resolution: 'auto-applied' | 'unsupported' | 'ignored'
          device?: VisualDevice // set when resolution === 'unsupported'
        }[]
        latencyMs: number
        costUsd?: number
      }

    // ── Edits — THE GOLD SIGNAL ─────────────────────────────────────────
    | {
        type: 'element.edited'
        field: EditableField
        elementType: string // headline | body | callout | image | ...
        role?: string
        region?: string
        method: RenderMethod // was the edited element code or asset-backed
        touchedByCritique: boolean
        secondsSinceGenerated?: number
        // before/after are DESIGN values only — never raw copy.
        // For text edits, log editKind + charDelta, NOT the text.
        before?: string | number
        after?: string | number
        editKind?: 'retype' | 'tweak' | 'replace'
        charDelta?: number
      }
    | { type: 'style.overridden'; field: keyof StyleFingerprint; before: string; after: string }

    // ── Regeneration (dissatisfaction signal) ───────────────────────────
    | { type: 'slide.regenerated'; reason?: string }
    | { type: 'asset.regenerated'; role: string; device: VisualDevice; attempt: number }

    // ── Outcome ─────────────────────────────────────────────────────────
    | { type: 'slide.deleted' }
    | { type: 'carousel.exported'; slideCount: number; format: string; editsBeforeExport: number }
    | { type: 'session.abandoned'; lastStage: string; durationMs: number }
  )

// ─────────────────────────────────────────────────────────────────────────
// track() — the single ingestion contract. Implement once (an
// `app/api/telemetry` route that batch-inserts into Supabase). Debounce
// high-frequency edits (drag/resize) client-side before calling.
// ─────────────────────────────────────────────────────────────────────────

export interface Tracker {
  track(event: TelemetryEvent): void // fire-and-forget; never blocks UX
  flush(): Promise<void> // on export / unload
}

/** Events that should be debounced client-side (coalesce bursts). */
export const DEBOUNCED_EVENTS: ReadonlySet<TelemetryEvent['type']> = new Set([
  'element.edited',
])
