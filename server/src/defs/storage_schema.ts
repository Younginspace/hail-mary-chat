/**
 * Storage Schema
 *
 * Define your storage buckets here for compile-time type safety.
 * This file is the source of truth for bucket metadata.
 * Bucket names are first-level path prefixes in the environment's R2 bucket.
 *
 * After editing this file, run:
 *   edgespark storage apply
 *
 * Usage in code:
 *   import { buckets } from "@defs";
 *   await edgespark.storage.from(buckets.uploads).put("file.jpg", buffer);
 */

import type { BucketDef } from "@sdk/server-types";

// P5 F2: cache of rendered TTS audio clips. Keyed by SHA-256 of
// text+lang+voice_id so repeat requests skip MiniMax entirely.
// Directory layout: audio/<first2chars>/<rest>.mp3
export const rockyAudio: BucketDef<"rocky-audio"> = {
  bucket_name: "rocky-audio",
  description: "Cached TTS audio clips (content-addressed)",
};
