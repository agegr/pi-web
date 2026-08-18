/**
 * The calendar's muted colour palette, decided in one place.
 *
 * Every event is drawn in one of six low-saturation colours, chosen from the
 * event's Google `colorId` when it has one and otherwise from a stable hash of
 * its title. The keys here are semantic — the actual hex lives in globals.css
 * as `--event-<key>` with a light and a dark value — so the same event reads
 * as a wash on parchment and on the dark canvas alike.
 */

export const EVENT_COLOR_KEYS = ["clay", "sage", "teal", "slate", "plum", "honey"] as const;
export type EventColorKey = (typeof EVENT_COLOR_KEYS)[number];

/**
 * Google's eleven standard event colours, each mapped to the nearest muted
 * key. Custom colours (a `colorId` outside "1".."11") are not mappable —
 * Google does not expose their hex — so they fall through to the title hash.
 */
const GOOGLE_COLOR_TO_KEY: Record<string, EventColorKey> = {
  "1": "slate", // lavender
  "2": "sage", // sage
  "3": "plum", // grape
  "4": "plum", // flamingo
  "5": "honey", // banana
  "6": "clay", // tangerine
  "7": "teal", // peacock
  "8": "slate", // graphite
  "9": "slate", // blueberry
  "10": "sage", // basil
  "11": "clay", // tomato
};

export function googleColorKey(colorId: string | undefined): EventColorKey | null {
  if (!colorId) return null;
  return GOOGLE_COLOR_TO_KEY[colorId] ?? null;
}

/** djb2 — cheap, deterministic, and spread evenly over the palette. */
export function titleColorKey(title: string): EventColorKey {
  let hash = 5381;
  for (let i = 0; i < title.length; i += 1) {
    hash = ((hash << 5) + hash + title.charCodeAt(i)) >>> 0;
  }
  return EVENT_COLOR_KEYS[hash % EVENT_COLOR_KEYS.length];
}

/**
 * The colour key to draw an event in: its Google-derived key when it has one,
 * otherwise a hash of its title. Local events always fall through to the hash.
 */
export function eventColorKey(event: { colorKey?: string; title: string }): EventColorKey {
  if (event.colorKey && (EVENT_COLOR_KEYS as readonly string[]).includes(event.colorKey)) {
    return event.colorKey as EventColorKey;
  }
  return titleColorKey(event.title);
}
