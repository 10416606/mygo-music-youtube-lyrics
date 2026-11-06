# Changelog

## 0.2.0 — 2026-11-06

- Establish an independently maintained repository under 10416606.
- Fetch timed YouTube lyrics without attaching the Google account session.
- Add LRCLIB fallback with title, artist, and duration matching.
- Prefer cached LRCLIB search results before slower exact lookup.
- Add bounded waits, positive-result caching, request coalescing, and safe diagnostics.
- Respect Retry-After; cool down unauthorized Better Lyrics requests.
- Display an unavailable-lyrics status instead of classifying a failed request as instrumental.
- Add offline regression tests and release packaging.
