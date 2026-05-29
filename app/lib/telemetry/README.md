# AWE Telemetry

Purpose: collect daily signal from real usage so we can see **what to hardcode next** for a faster, cheaper workflow over time — and so the hybrid compositor emits useful data from day one.

Two files implement it: `events.ts` (the typed taxonomy + `track()` contract) and `schema.sql` (the append-only table + the rollup views that produce the rankings).

## Design decisions (and why)

- **Append-only events, jsonb payload.** One immutable row per interaction. New event types never need a migration — critical because the AssetSpec shape will keep evolving. Aggregation happens in views, not in the write path.
- **Controlled device vocabulary (`VisualDevice`).** The "what to hardcode" question only has an answer if devices group. Free-text labels never aggregate. Every detected/generated device is tagged from a fixed list + a `method` (`code` vs `asset`). `other` exists as an escape hatch but carries a free-text label so new devices surface as candidates to add to the vocabulary.
- **The gold signal is `element.edited`.** Every edit is the user correcting where the system was wrong. It's weighted heaviest in the hardcode-priority score. The classification of *which* element was edited (and whether it was code- or asset-backed) is what turns edits into actionable direction.
- **Privacy-first.** We log design behaviour, never user content: style fingerprints, enums, deltas, counts, costs. Text edits record `editKind` + `charDelta`, not the words. Scripts are bucketed by length, not stored. (This matters for confidentiality and keeps the telemetry useful without holding sensitive copy.)
- **Versioned.** Every event stamps `appVersion` + `modelVersions`, so a quality regression can be traced to the release that caused it.
- **Forward-compatible.** `asset.*` and `critique.*` events are defined now and simply don't fire until those features ship. The moment the hybrid compositor lands, asset demand/cost/quality data starts accruing with zero extra work.

## Event lifecycle (what fires, when)

```
upload ──▶ reference.uploaded, reference.fetch
analyze ─▶ reference.analyzed (fingerprint + devices[]), script.analyzed
synth ───▶ plan.synthesized (compositions, container usage, assetSpecsEmitted)
assets ──▶ asset.requested → asset.generated | asset.failed     [compositor]
render ──▶ carousel.rendered
critique ▶ critique.run (findings[], unsupported devices)        [loop]
edit ────▶ element.edited  ★gold★ , style.overridden
regen ───▶ slide.regenerated, asset.regenerated
outcome ─▶ carousel.exported (success) | session.abandoned | slide.deleted
```

## Wiring (one ingestion path)

Implement `track()` once: a fire-and-forget client/server helper that posts to a new `app/api/telemetry` route which batch-inserts into `telemetry_events`. It must never block the UX. High-frequency edits (drag/resize) are debounced client-side before `track()` (see `DEBOUNCED_EVENTS`); `flush()` runs on export and on page unload. Suggested home in the monorepo: `packages/telemetry`.

## Reading the output → making the hardcode decision

Refresh the materialized views nightly (pg_cron / a Supabase scheduled function). Then:

- **`mv_device_demand`** is the primary queue. `hardcode_priority = times_seen × avg_gen_cost × (1 + asset_edits)`. The top rows are devices that appear often, cost real money to generate every time, and that users keep fixing — the best candidates to promote from "generated each run" to a deterministic code primitive.
- **`mv_extraction_overrides`** shows which StyleSpec fields users override most — i.e. where `analyze-reference` is mis-reading the reference. High override on `bgMood` or `headlineStyle` means fix extraction, not the renderer.
- **`mv_unsupported_devices`** is the asset/primitive roadmap: devices the critique loop couldn't reproduce, ranked by frequency × severity.
- **`mv_asset_quality`** flags devices whose generations come back low-confidence or slow — candidates for a better prompt template, a controlled-component approach, or a code primitive.
- **`mv_cost_per_carousel`** is the margin watch as asset-gen volume grows.
- **`mv_funnel_daily`** shows where sessions die (upload→synth→render→export).

## The flywheel this enables

`mv_device_demand` + `mv_unsupported_devices` tell you exactly which generated devices are worth turning into fast, reliable primitives. You (or an AI agent against this data) promote the top ones via a reviewed PR. Each promotion makes the next carousel cheaper and faster — the self-improving loop, with a human in the loop, grounded in real demand instead of guesswork.
