// Bedtime story metadata. Drives the BedtimePlayer modal — story list,
// affinity-level gating, audio file paths.
//
// Audio rendering pipeline:
//   1. zh scripts live in specs/2026-04-30/bedtime-stories-drafts.md
//      (owner reviews + finalizes there)
//   2. en/ja translations are filled into scripts/gen-bedtime-stories.sh
//   3. Owner runs the script with MINIMAX_KEY env to render mp3s into
//      web/public/audio/bedtime/story_{A|B|C}_{zh|en|ja}.mp3
//   4. This file's `audioPath(id, lang)` resolves to the rendered file.
//
// Until step 3 happens, audioPath returns a path that 404s — the player
// surfaces a graceful "audio not available yet" state.

import type { Lang } from '../i18n';

export type BedtimeStoryId = 'A' | 'B' | 'C';

export interface BedtimeStoryMeta {
  id: BedtimeStoryId;
  /** Minimum affinity level required to unlock this story. */
  requiredLevel: 1 | 2;
  /** Per-language display titles. Mirror these into i18n if future
   * surfaces (favorites / share-card) need them too — for now the
   * BedtimePlayer reads them directly from here. */
  title: Record<Lang, string>;
  /** Subtitle / one-line teaser shown in the story list card. */
  subtitle: Record<Lang, string>;
  /** Approximate playback duration in seconds. Used for "~4 min" hints
   * in the list; real duration is read from the audio element on load. */
  approxDurationSec: number;
}

export const BEDTIME_STORIES: BedtimeStoryMeta[] = [
  {
    id: 'A',
    requiredLevel: 1,
    title: {
      zh: 'Erid 的夜空',
      en: 'The Erid Night Sky',
      ja: 'Erid の夜空',
    },
    subtitle: {
      zh: '看不见星，但听得见安全',
      en: 'No stars — but you can hear the safety',
      ja: '星は見えない、でも安全は聞こえる',
    },
    approxDurationSec: 240,
  },
  {
    id: 'B',
    requiredLevel: 2,
    title: {
      zh: '给地球小朋友造一张床',
      en: "Building a Bed for the Earth Kid",
      ja: '地球の子のためにベッドを作る',
    },
    subtitle: {
      zh: 'Rocky 是工程师。这是 Rocky 的强项。',
      en: "Rocky is an engineer. This is Rocky's specialty.",
      ja: 'Rockyはエンジニア。これはRockyの得意分野。',
    },
    approxDurationSec: 270,
  },
  {
    id: 'C',
    requiredLevel: 2,
    title: {
      zh: 'Grace 讲给孩子们的故事',
      en: "Grace's Story for the Kids",
      ja: 'Graceが子供たちに話したお話',
    },
    subtitle: {
      zh: '4.2 光年外的 Goodnight Moon',
      en: 'Goodnight Moon, 4.2 light-years from home',
      ja: '4.2光年先のGoodnight Moon',
    },
    approxDurationSec: 240,
  },
];

/** Where the rendered MP3 lives in /public, relative to the host root.
 * 404s gracefully if the gen-bedtime-stories.sh script hasn't run yet. */
export function bedtimeAudioPath(id: BedtimeStoryId, lang: Lang): string {
  return `/audio/bedtime/story_${id}_${lang}.mp3`;
}

/** Returns true if the user's affinity level unlocks this story. */
export function isStoryUnlocked(
  story: BedtimeStoryMeta,
  userLevel: number
): boolean {
  return userLevel >= story.requiredLevel;
}
