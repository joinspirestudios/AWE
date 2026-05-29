/**
 * Telemetry — typed event taxonomy + ingestion contract for AWE usage
 * data. See ./README.md for design and ./schema.sql for the Supabase
 * tables + rollup views that produce the "what to hardcode next" ranking.
 *
 * Plain in-app module (not a workspace package) so it adds no dependency
 * and never touches pnpm-lock.yaml. Import via '@/lib/telemetry' or a
 * relative path.
 */
export * from './events'
