/**
 * Supabase Storage helpers.
 *
 * We rehost Instagram/LinkedIn/TikTok CDN images to our own bucket
 * because their CDN URLs expire after 24–48 hours. Once rehosted, the
 * URL is permanent and safe to embed in saved CarouselDocuments.
 *
 * Bucket: `references` (must exist; public; see /docs/setup.md).
 * Path scheme: `{referenceId}/{order}.{ext}` so each reference has its
 * own folder.
 */

import 'server-only'

import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const BUCKET_NAME = 'references'

let _client: SupabaseClient | null = null

/** Lazily construct the service-role Supabase client (server only). */
function getClient(): SupabaseClient {
  if (_client) return _client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  _client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  })
  return _client
}

export interface RehostedImage {
  /** Permanent public URL for the rehosted image. */
  src: string
  /** Order within the reference (0-indexed). */
  order: number
  /** Storage path within the bucket, for debugging. */
  storagePath: string
  /** Original CDN URL we copied from, useful for traceability. */
  originalUrl: string
}

export interface RehostResult {
  /** Generated reference ID — also used as the storage subfolder. */
  referenceId: string
  /** Successfully rehosted images, in original order. */
  images: RehostedImage[]
  /** Any per-image errors (image index → error message). */
  errors: Array<{ order: number; originalUrl: string; message: string }>
  /** Total ms across all image downloads + uploads. */
  durationMs: number
}

/**
 * Generate a short, stable reference ID. Prefix makes it easy to scan
 * in logs and storage paths.
 */
export function generateReferenceId(): string {
  return `ref-${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

/**
 * Download a single image from a remote URL and upload it to Supabase
 * Storage. Returns the permanent public URL.
 *
 * Note: Instagram CDN URLs work server-to-server without auth headers.
 * We don't need to spoof a User-Agent for IG images, but we do for
 * some LinkedIn assets — leaving that for the LinkedIn implementation.
 */
async function rehostOne(
  imageUrl: string,
  storagePath: string,
): Promise<RehostedImage> {
  const supabase = getClient()

  const imgResponse = await fetch(imageUrl)
  if (!imgResponse.ok) {
    throw new Error(
      `Failed to download image (${imgResponse.status}): ${imageUrl.slice(0, 120)}`,
    )
  }
  const contentType =
    imgResponse.headers.get('content-type') ?? 'image/jpeg'
  const arrayBuffer = await imgResponse.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, buffer, {
      contentType,
      upsert: false,
      // 1 year cache — these never change, the path is unique per upload.
      cacheControl: '31536000',
    })

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`)
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath)

  return {
    src: publicUrl,
    order: parseOrderFromPath(storagePath),
    storagePath,
    originalUrl: imageUrl,
  }
}

/**
 * Rehost an entire batch of images (one carousel) into a single
 * reference folder. Runs uploads in parallel; collects per-image errors
 * so a single bad image doesn't drop the whole reference.
 */
export async function rehostCarousel(
  imageUrls: string[],
  referenceId = generateReferenceId(),
): Promise<RehostResult> {
  const start = Date.now()

  const results = await Promise.allSettled(
    imageUrls.map((url, i) => {
      const ext = guessExtension(url)
      const storagePath = `${referenceId}/${String(i).padStart(2, '0')}.${ext}`
      return rehostOne(url, storagePath)
    }),
  )

  const images: RehostedImage[] = []
  const errors: RehostResult['errors'] = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      images.push(r.value)
    } else {
      errors.push({
        order: i,
        originalUrl: imageUrls[i] ?? '',
        message: r.reason instanceof Error ? r.reason.message : String(r.reason),
      })
    }
  })

  // Keep images in original order even though Promise.allSettled preserves order.
  images.sort((a, b) => a.order - b.order)

  return {
    referenceId,
    images,
    errors,
    durationMs: Date.now() - start,
  }
}

/** Guess a file extension from a URL's pathname. */
function guessExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    const match = pathname.match(/\.(jpe?g|png|webp|gif)(?:$|[?#])/)
    const ext = match?.[1]
    if (ext) return ext === 'jpeg' ? 'jpg' : ext
  } catch {
    // ignore
  }
  return 'jpg'
}

function parseOrderFromPath(storagePath: string): number {
  // storagePath: `{refId}/{order}.{ext}` — we want the order.
  const filename = storagePath.split('/').pop() ?? ''
  const orderStr = filename.split('.')[0] ?? '0'
  const n = Number.parseInt(orderStr, 10)
  return Number.isFinite(n) ? n : 0
}
