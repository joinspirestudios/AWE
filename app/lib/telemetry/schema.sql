-- =========================================================================
-- AWE telemetry — Supabase / Postgres schema
--
-- One append-only events table + nightly materialized rollups. New event
-- types never need a migration: type is text, detail lives in jsonb.
-- =========================================================================

create table if not exists telemetry_events (
  id             bigint generated always as identity primary key,
  ts             timestamptz not null default now(),

  -- correlation ids (mirror EventEnvelope in events.ts)
  session_id     uuid        not null,
  user_id        uuid,
  carousel_id    uuid,
  reference_id   uuid,
  slide_index    int,
  element_id     text,
  asset_id       uuid,

  -- the event
  type           text        not null,
  payload        jsonb       not null default '{}'::jsonb,

  -- versioning (attribute quality shifts to releases)
  app_version    text,
  model_versions jsonb,
  client         text
);

-- Indexes for the rollup queries below.
create index if not exists tev_ts          on telemetry_events (ts);
create index if not exists tev_type_ts     on telemetry_events (type, ts);
create index if not exists tev_session     on telemetry_events (session_id);
create index if not exists tev_carousel    on telemetry_events (carousel_id);
create index if not exists tev_payload_gin on telemetry_events using gin (payload);
-- group-by style fingerprint (set in payload for analyzed/synthesized/edit events)
create index if not exists tev_fingerprint on telemetry_events ((payload #>> '{fingerprint,hash}'));

-- =========================================================================
-- ROLLUP 1 — DEVICE DEMAND  ➜  the "what to hardcode next" ranking.
--
-- For each visual device: how often it appears, how often it needs a
-- generated asset, what that generation costs, cache-hit rate, and how
-- often users have to CORRECT it. High demand + high asset-cost + high
-- correction-rate = promote to a real code primitive.
-- =========================================================================
create materialized view if not exists mv_device_demand as
with detected as (         -- devices seen on references
  select (d->>'device')                         as device,
         (d->>'method')                         as method,
         coalesce((d->>'count')::int, 1)        as cnt
  from telemetry_events e
  cross join lateral jsonb_array_elements(e.payload->'devices') d
  where e.type = 'reference.analyzed'
),
gen as (                   -- asset generations, by device
  select payload->>'device'                     as device,
         (payload->>'costUsd')::numeric         as cost,
         (payload->>'cacheHit')::boolean        as cache_hit
  from telemetry_events
  where type = 'asset.generated'
),
edits as (                 -- user corrections on asset-backed elements
  select payload->>'elementType'                as element_type,
         payload->>'method'                     as method
  from telemetry_events
  where type = 'element.edited'
)
select
  d.device,
  sum(d.cnt)                                              as times_seen,
  count(*) filter (where d.method = 'asset')             as seen_needs_asset,
  (select count(*) from gen g where g.device = d.device) as generations,
  (select round(avg(g.cost)::numeric, 4) from gen g where g.device = d.device)              as avg_gen_cost_usd,
  (select round(avg((g.cache_hit)::int)::numeric, 3) from gen g where g.device = d.device)  as cache_hit_rate,
  (select count(*) from edits ed where ed.method = 'asset')                                 as asset_edits,
  -- crude priority score: demand x generation-cost x how often users fix it
  round(
    sum(d.cnt)
    * coalesce((select avg(g.cost) from gen g where g.device = d.device), 0)
    * (1 + (select count(*) from edits ed where ed.method = 'asset'))::numeric
  , 3)                                                    as hardcode_priority
from detected d
group by d.device
order by hardcode_priority desc nulls last;

-- =========================================================================
-- ROLLUP 2 — EXTRACTION ACCURACY  ➜  where analyze-reference is weak.
-- Which StyleSpec fields users override most (bg, type, color, ...).
-- A high override rate on a field means extraction is mis-reading it.
-- =========================================================================
create materialized view if not exists mv_extraction_overrides as
select
  payload->>'field'                                   as field,
  count(*)                                            as overrides,
  count(distinct session_id)                          as sessions_affected
from telemetry_events
where type = 'style.overridden'
group by payload->>'field'
order by overrides desc;

-- =========================================================================
-- ROLLUP 3 — UNSUPPORTED DEVICES  ➜  the primitive/asset roadmap.
-- Devices the critique loop flagged it could not reproduce.
-- =========================================================================
create materialized view if not exists mv_unsupported_devices as
select
  f->>'device'                                        as device,
  count(*)                                            as times_flagged,
  count(distinct session_id)                          as sessions_affected,
  round(avg((f->>'severity')::int)::numeric, 2)       as avg_severity
from telemetry_events e
cross join lateral jsonb_array_elements(e.payload->'findings') f
where e.type = 'critique.run'
  and f->>'resolution' = 'unsupported'
group by f->>'device'
order by times_flagged desc;

-- =========================================================================
-- ROLLUP 4 — ASSET QUALITY  ➜  where generation is unreliable.
-- =========================================================================
create materialized view if not exists mv_asset_quality as
select
  payload->>'device'                                  as device,
  count(*)                                            as generations,
  round(avg((payload->>'confidence')::numeric), 3)    as avg_confidence,
  count(*) filter (where (payload->>'confidence')::numeric < 0.6) as low_confidence,
  round(avg((payload->>'latencyMs')::numeric), 0)     as avg_latency_ms,
  round(avg((payload->>'costUsd')::numeric), 4)       as avg_cost_usd
from telemetry_events
where type = 'asset.generated'
group by payload->>'device'
order by low_confidence desc;

-- =========================================================================
-- ROLLUP 5 — COST PER CAROUSEL  ➜  margin watch.
-- Sums model + asset + fetch costs per finished carousel.
-- =========================================================================
create materialized view if not exists mv_cost_per_carousel as
select
  carousel_id,
  round(sum((payload->>'costUsd')::numeric), 4)       as total_cost_usd,
  count(*) filter (where type = 'asset.generated')    as assets_generated
from telemetry_events
where carousel_id is not null
  and payload ? 'costUsd'
group by carousel_id;

-- =========================================================================
-- ROLLUP 6 — FUNNEL  ➜  where sessions die.
-- =========================================================================
create materialized view if not exists mv_funnel_daily as
select
  date_trunc('day', ts)                                          as day,
  count(distinct session_id) filter (where type = 'reference.uploaded')  as uploaded,
  count(distinct session_id) filter (where type = 'plan.synthesized')    as synthesized,
  count(distinct session_id) filter (where type = 'carousel.rendered')   as rendered,
  count(distinct session_id) filter (where type = 'carousel.exported')   as exported,
  count(distinct session_id) filter (where type = 'session.abandoned')   as abandoned
from telemetry_events
group by 1
order by 1 desc;

-- Refresh nightly (Supabase scheduled function / pg_cron):
--   refresh materialized view concurrently mv_device_demand;
--   ... (repeat for each view)
-- Add `create unique index` on each MV first if using CONCURRENTLY.
