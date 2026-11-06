# YouTube Music for MyGo Music

Plays YouTube Music in [MyGo Music](https://github.com/egoist/mygo-music). It isn't affiliated with or endorsed by YouTube or Google, uses YouTube's private API, and may stop working at any time.

## Install

Install [ffmpeg](https://ffmpeg.org), and [yt-dlp](https://github.com/yt-dlp/yt-dlp) as a fallback. On macOS:

```bash
brew install ffmpeg yt-dlp
```

yt-dlp needs a JavaScript runtime (Deno, Node or Bun) to solve YouTube's challenges; Homebrew includes Deno. Keep yt-dlp up to date, as YouTube changes often.

Install with the deeplink:

[mygo-music://install-plugin?repo=egoist/mygo-music-youtube-music](mygo-music://install-plugin?repo=egoist/mygo-music-youtube-music)

Or paste the GitHub URL in Settings > Plugins:

[https://github.com/egoist/mygo-music-youtube-music](https://github.com/egoist/mygo-music-youtube-music)

In Settings > Plugins, allow YouTube Music to start programs. To get your library, click **Sign In** and sign in to Google in the window that opens.

If ffmpeg or yt-dlp isn't found, set **Programs Folder** in the plugin's settings.

## Signing in

You sign in on Google's page, in a window of the app. The session is kept unencrypted in the plugin's data on this machine, and is sent to music.youtube.com, s.youtube.com for your history, and to yt-dlp when it fetches audio. Signing out forgets it. To end the session on Google's side, remove the device in your Google account's security settings.

## What works

- Signed out: playing, Home, charts, new releases, search, albums, artists, playlists and timed lyrics.
- Signed in: your library, playlists, liked songs, recently played, liking songs, a personal Home, listening history and radio.
- Not available: editing playlists, saving albums, following artists, podcasts and comments.

## How it plays

Tracks are fetched the way YouTube's Vision Pro app fetches them, then ffmpeg converts them to MP3 on the fly. If that fails, yt-dlp is used instead; it can take up to 15 seconds to start, and needs you signed in from a VPN or server network. The audio is lossy.

## Lyrics

From [Better Lyrics](https://github.com/better-lyrics/better-lyrics) when available, otherwise from YouTube Music.
