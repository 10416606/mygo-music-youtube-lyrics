// YouTube Music, for personal use. The catalog comes from the API its website
// calls. A track's audio is found as YouTube's app for the Vision Pro asks for
// it, which is given addresses that play as they are, and ffmpeg turns it into
// the MP3 the app can play, as neither AAC nor Opus is something it decodes.
// Should YouTube stop answering that app, yt-dlp finds the audio instead, if
// it's installed. Your library takes your own session, which signing in on
// Google's page in a window of the app gives, as its cookies.

const site = "https://music.youtube.com";
const webUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// The session's cookies, as a Cookie header, kept in the plugin's storage.
const cookie = () => host.storage.get("cookie") || "";

function cookieValue(name) {
  for (const part of cookie().split(";")) {
    const at = part.indexOf("=");
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return "";
}

function needAccount() {
  if (!cookie()) throw fail("signIn");
}

function sha1(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 0xff);
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  for (let at = 0; at < bytes.length; at += 64) {
    const w = [];
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[at + i * 4] << 24) | (bytes[at + i * 4 + 1] << 16) | (bytes[at + i * 4 + 2] << 8) | bytes[at + i * 4 + 3];
    }
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20 ? [(b & c) | (~b & d), 0x5a827999]
        : i < 40 ? [b ^ c ^ d, 0x6ed9eba1]
        : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
        : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
      [e, d, c, b, a] = [d, c, rotl(b, 30), a, t];
    }
    [a, b, c, d, e].forEach((v, i) => (h[i] = (h[i] + v) | 0));
  }
  return h.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

// What the website sends to say whose session this is, to the site at origin.
function authHeaders(origin = site) {
  const sapisid = cookieValue("__Secure-3PAPISID") || cookieValue("SAPISID");
  if (!sapisid) return {};
  const now = Math.floor(Date.now() / 1000);
  return {
    cookie: cookie(),
    authorization: `SAPISIDHASH ${now}_${sha1(`${now} ${sapisid} ${origin}`)}`,
    "x-goog-authuser": "0",
  };
}

function clientVersion() {
  const d = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `1.${d}.01.00`;
}

// The apps the service tells apart, as a request says it's from one of them.
const remix = {
  get client() {
    return { clientName: "WEB_REMIX", clientVersion: clientVersion() };
  },
};

// Its Android app, which is told when each line of the lyrics is sung, where
// the website only gets the words.
const android = {
  client: { clientName: "ANDROID_MUSIC", clientVersion: "7.21.50", androidSdkVersion: 34 },
  headers: { "user-agent": "com.google.android.apps.youtube.music/7.21.50 (Linux; U; Android 14) gzip" },
};

// YouTube's app for the Vision Pro, which is given audio at addresses that need
// no signature worked out, nor YouTube's JavaScript run. It asks as a visitor:
// a session is turned down.
const visionUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const visionOS = (visitor) => ({
  client: {
    clientName: "VISIONOS",
    clientVersion: "1.02",
    deviceMake: "Apple",
    deviceModel: "RealityDevice17,1",
    userAgent: visionUA,
    osName: "visionOS",
    osVersion: "26.5.23O471",
    visitorData: visitor,
  },
  headers: {
    "user-agent": visionUA,
    "x-goog-visitor-id": visitor,
    "x-youtube-client-name": "101",
    "x-youtube-client-version": "1.02",
  },
  anonymous: true,
});

// call asks the service as the website, or as another of its apps. An
// anonymous call leaves the session out.
async function call(endpoint, body, as = remix) {
  const res = await fetch(`${site}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": webUA,
      origin: site,
      "x-origin": site,
      ...(as.anonymous ? {} : authHeaders()),
      ...as.headers,
    },
    body: JSON.stringify({ context: { client: as.client }, ...body }),
  });
  if (res.status === 401) {
    endSession();
    throw fail("signIn", "Your YouTube Music session has ended: sign in again");
  }
  if (!res.ok) throw new Error(`${endpoint}: ${res.status}`);
  return res.json();
}

const browseId = (id) => call("browse", { browseId: id });

// Answers are deep and change shape, so what's in them is found by name.

function findAll(node, name, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) findAll(item, name, out);
  } else if (node && typeof node === "object") {
    for (const key of Object.keys(node)) {
      if (key === name) out.push(node[key]);
      else findAll(node[key], name, out);
    }
  }
  return out;
}
const findOne = (node, name) => findAll(node, name)[0];

const textOf = (t) => (t ? t.simpleText || (t.runs || []).map((r) => r.text).join("") : "");

// Covers come in the size asked for in their address.
function imageOf(node) {
  const list = node && findOne(node, "thumbnails");
  const url = list && list.length ? list[list.length - 1].url : "";
  if (!url) return undefined;
  return url.replace(/=w\d+-h\d+[^/]*$/, "=w544-h544-l90-rj");
}

function msOf(text) {
  if (!text || !/^\d+(:\d+)+$/.test(text)) return 0;
  return text.split(":").reduce((sum, n) => sum * 60 + Number(n), 0) * 1000;
}

const pageTypeOf = (nav) =>
  nav?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || "";

const plainPlaylistId = (id) => (id || "").replace(/^VL/, "");

// What a line of credits names: who, on which album, and for how long.
function creditsOf(runs) {
  const out = { artists: [], album: null, duration: 0, names: [] };
  for (const run of runs || []) {
    const text = run.text;
    if (!text || /^\s*[•·,&]\s*$/.test(text)) continue;
    const nav = run.navigationEndpoint;
    const type = pageTypeOf(nav);
    if (type === "MUSIC_PAGE_TYPE_ARTIST" || type === "MUSIC_PAGE_TYPE_USER_CHANNEL") {
      out.artists.push({ id: nav.browseEndpoint.browseId, name: text });
    } else if (type === "MUSIC_PAGE_TYPE_ALBUM" || type === "MUSIC_PAGE_TYPE_AUDIOBOOK") {
      out.album = { id: nav.browseEndpoint.browseId, name: text };
    } else if (msOf(text)) {
      out.duration = msOf(text);
    } else {
      out.names.push(text);
    }
  }
  return out;
}

function trackFrom(id, name, credits, image, unavailable) {
  // A track whose artist has no page of their own only has them as words, the
  // first of which may be its kind in a list of everything.
  const artists = credits.artists.length
    ? credits.artists
    : credits.names.slice(0, 1).map((n) => ({ id: "", name: n }));
  return rememberLyricTrack({
    id,
    name,
    artists,
    album: credits.album ? { ...credits.album, imageUrl: image } : { id: "", name: "", imageUrl: image },
    duration: credits.duration,
    url: `${site}/watch?v=${id}`,
    unavailable: unavailable || undefined,
  });
}

// A row of a list: a song, or what a search for other things finds.
function rowOf(r) {
  const columns = (r.flexColumns || []).map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text);
  const name = textOf(columns[0]);
  const nav = columns[0]?.runs?.[0]?.navigationEndpoint;
  const videoId = r.playlistItemData?.videoId || nav?.watchEndpoint?.videoId;
  const runs = columns.slice(1).flatMap((c) => [...(c?.runs || []), { text: "•" }]);
  const fixed = (r.fixedColumns || []).map((c) => textOf(c.musicResponsiveListItemFixedColumnRenderer?.text));
  const credits = creditsOf(runs);
  credits.duration = credits.duration || msOf(fixed[0]);
  const image = imageOf(r.thumbnail);
  if (videoId) {
    const grey = r.musicItemRendererDisplayPolicy === "MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT";
    return { kind: "track", value: trackFrom(videoId, name, credits, image, grey) };
  }
  const target = r.navigationEndpoint;
  return collectionOf(target, name, runs, image);
}

// A card: anything at all, by where it leads.
function cardOf(r) {
  const name = textOf(r.title);
  const runs = r.subtitle?.runs || [];
  const image = imageOf(r.thumbnailRenderer);
  const nav = r.navigationEndpoint;
  if (nav?.watchEndpoint?.videoId) {
    const credits = creditsOf(runs);
    // On a card, words come first that say what it is.
    credits.names = credits.names.slice(1);
    return { kind: "track", value: trackFrom(nav.watchEndpoint.videoId, name, credits, image) };
  }
  return collectionOf(nav, name, runs, image);
}

function collectionOf(nav, name, runs, image) {
  const id = nav?.browseEndpoint?.browseId;
  if (!id) return null;
  const credits = creditsOf(runs);
  switch (pageTypeOf(nav)) {
    case "MUSIC_PAGE_TYPE_ARTIST":
    case "MUSIC_PAGE_TYPE_USER_CHANNEL":
      return { kind: "artist", value: { id, name, imageUrl: image } };
    case "MUSIC_PAGE_TYPE_ALBUM":
    case "MUSIC_PAGE_TYPE_AUDIOBOOK":
      return { kind: "album", value: { id, name, imageUrl: image, artists: credits.artists, released: credits.names.find((n) => /^\d{4}$/.test(n)) } };
    case "MUSIC_PAGE_TYPE_PLAYLIST":
      return { kind: "playlist", value: { id: plainPlaylistId(id), name, imageUrl: image, owner: credits.artists[0]?.name || credits.names[1] || "" } };
  }
  return null;
}

function itemsOf(list) {
  const out = [];
  for (const item of list || []) {
    const row = item.musicResponsiveListItemRenderer;
    const card = item.musicTwoRowItemRenderer;
    const got = row ? rowOf(row) : card ? cardOf(card) : null;
    if (got) out.push(got);
  }
  return out;
}

const ofKind = (items, kind) => items.filter((i) => i.kind === kind).map((i) => i.value);

// Some lists leave out how long a song is, and the app needs that to seek and
// to know when it ends. The queue answers for many at once.
async function withDurations(tracks) {
  const missing = tracks.filter((t) => !t.duration).map((t) => t.id);
  if (!missing.length) return tracks;
  const known = {};
  try {
    const r = await call("music/get_queue", { videoIds: [...new Set(missing)].slice(0, 100) });
    for (const v of findAll(r, "playlistPanelVideoRenderer")) known[v.videoId] = msOf(textOf(v.lengthText));
  } catch (e) {
    console.warn(`get_queue: ${e.message}`);
  }
  for (const t of tracks) t.duration = t.duration || known[t.id] || 0;
  return tracks;
}

function shelfTitle(shelf) {
  return textOf(shelf.title) || textOf(findOne(shelf.header, "title"));
}

// The sections of a page of shelves, in their order.
async function sectionsOf(answer) {
  const sections = [];
  for (const list of findAll(answer, "sectionListRenderer").concat(findAll(answer, "sectionListContinuation"))) {
    for (const entry of list.contents || []) {
      const shelf =
        entry.musicCarouselShelfRenderer || entry.musicShelfRenderer || entry.musicPlaylistShelfRenderer || entry.gridRenderer;
      if (!shelf) continue;
      const items = itemsOf(shelf.contents || shelf.items);
      if (!items.length) continue;
      sections.push({
        title: shelfTitle(shelf),
        tracks: await withDurations(ofKind(items, "track")),
        albums: ofKind(items, "album"),
        artists: ofKind(items, "artist"),
        playlists: ofKind(items, "playlist"),
      });
    }
  }
  return sections;
}

// A next page's token, in either of the ways it's given.
function nextToken(node) {
  if (!node) return "";
  const old = findOne(node, "nextContinuationData");
  if (old?.continuation) return old.continuation;
  return findOne(node, "continuationCommand")?.token || "";
}

// The app asks for pages by how much it has, the service by a token: this is
// which token goes with how much.
const tokens = new Map();
function pageToken(key, offset) {
  return offset > 0 ? tokens.get(`${key}\0${offset}`) : null;
}
function keepToken(key, offset, token) {
  if (token) tokens.set(`${key}\0${offset}`, token);
  return Boolean(token);
}

// What a page's rows are, and its next token. Those of a next page aren't where
// the first page's are.
function rowsOf(answer) {
  const further = findOne(answer, "onResponseReceivedActions") || findOne(answer, "musicShelfContinuation") || findOne(answer, "musicPlaylistShelfContinuation");
  if (further) {
    const list = findAll(further, "continuationItems")[0] || further.contents || [];
    return { items: itemsOf(list), token: nextToken(further) };
  }
  const shelf = findOne(answer, "musicPlaylistShelfRenderer") || findOne(answer, "musicShelfRenderer");
  return { items: itemsOf(shelf?.contents), token: nextToken(shelf) };
}

// Account.

export async function account() {
  if (!cookie()) return null;
  const r = await call("account/account_menu", {});
  const header = findOne(r, "activeAccountHeaderRenderer");
  if (!header) return null;
  const name = textOf(header.accountName);
  return { id: textOf(header.channelHandle) || name, name, imageUrl: imageOf(header.accountPhoto) };
}

// Signing in is on Google's own page, as YouTube Music's website signs in, in a
// window the app shows. It's done once Google gives YouTube the session.
const signInPage =
  "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&uilel=3&passive=true" +
  "&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F";

// Google turns down signing in on a page it takes for one inside an app, so it's
// told the page is the system's own browser.
const browserUA =
  host.platform === "darwin"
    ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15"
    : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

export async function signIn() {
  const { cookie: session } = await host.webSignIn({
    url: signInPage,
    cookiesOf: site,
    until: ["SAPISID", "__Secure-3PSID"],
    userAgent: browserUA,
  });
  host.storage.set("cookie", session);
  likedSet = null;
  const me = await account();
  if (!me) {
    endSession();
    throw new Error("YouTube Music didn't take that sign-in: try again");
  }
  return me;
}

export function signOut() {
  endSession();
}

// What's kept of a session goes with it.
function endSession() {
  host.storage.remove("cookie");
  likedSet = null;
}

export function setSetting({ key }) {
  if (key === "programs") {
    for (const name of Object.keys(installed)) delete installed[name];
    ranged = null;
  }
}

// Pages.

export async function home() {
  const answer = await browseId("FEmusic_home");
  const sections = await sectionsOf(answer);
  // It comes in a few pages. Two more make a page that's worth scrolling.
  let token = nextToken(findOne(answer, "sectionListRenderer"));
  for (let i = 0; token && i < 2; i++) {
    const more = await call("browse", { continuation: token });
    sections.push(...(await sectionsOf(more)));
    token = nextToken(findOne(more, "sectionListContinuation"));
  }
  return { title: "Home", sections };
}

export async function browse({ page }) {
  const ids = { charts: ["FEmusic_charts", "Charts"], new: ["FEmusic_new_releases", "New Releases"] };
  const known = ids[page];
  if (known) return { title: known[1], sections: await sectionsOf(await browseId(known[0])) };
  throw fail("unavailable", "no such page");
}

// Search. Each kind has its filter, which the website sends in this form.

const filters = {
  tracks: "EgWKAQIIAWoMEA4QChADEAQQCRAF",
  albums: "EgWKAQIYAWoMEA4QChADEAQQCRAF",
  artists: "EgWKAQIgAWoMEA4QChADEAQQCRAF",
  playlists: "EgeKAQQoAEABagwQDhAKEAMQBBAJEAU%3D",
};

export async function search({ query, kind, offset }) {
  const filter = filters[kind];
  if (!filter) return { [kind]: [], more: false };
  const key = `search\0${kind}\0${query}`;
  const token = pageToken(key, offset);
  if (offset > 0 && !token) return { [kind]: [], more: false };
  const answer = await call("search", token ? { continuation: token } : { query, params: decodeURIComponent(filter) });
  const { items, token: next } = rowsOf(answer);
  const single = { tracks: "track", albums: "album", artists: "artist", playlists: "playlist" }[kind];
  const found = ofKind(items, single);
  if (kind === "tracks") await withDurations(found);
  return { [kind]: found, more: keepToken(key, offset + found.length, next) };
}

export async function suggest({ query }) {
  const r = await call("music/get_search_suggestions", { input: query });
  return findAll(r, "searchSuggestionRenderer").map((s) => textOf(s.suggestion)).filter(Boolean);
}

// Albums and artists.

function headerOf(answer) {
  return findOne(answer, "musicResponsiveHeaderRenderer") || findOne(answer, "musicDetailHeaderRenderer") || {};
}

async function albumPage({ id }) {
  const answer = await browseId(id);
  const header = headerOf(answer);
  const credits = creditsOf([...(header.straplineTextOne?.runs || []), ...(header.subtitle?.runs || [])]);
  const album = {
    id,
    name: textOf(header.title),
    imageUrl: imageOf(header.thumbnail),
    artists: credits.artists,
    released: textOf(header.subtitle).match(/\b\d{4}\b/)?.[0],
  };
  const shelf = findOne(answer, "musicShelfRenderer");
  const tracks = ofKind(itemsOf(shelf?.contents), "track").map((t) => ({
    ...t,
    // An album's rows only name who's on them if that's someone else.
    artists: t.artists.length ? t.artists : album.artists,
    album: { id, name: album.name, imageUrl: album.imageUrl },
  }));
  return { album, tracks: await withDurations(tracks) };
}

async function artistPage({ id }) {
  const answer = await browseId(id);
  const header = findOne(answer, "musicImmersiveHeaderRenderer") || findOne(answer, "musicVisualHeaderRenderer") || {};
  const sections = await sectionsOf(answer);
  return {
    artist: { id, name: textOf(header.title), imageUrl: imageOf(header.thumbnail || header.foregroundThumbnail) },
    tracks: sections.flatMap((s) => s.tracks).slice(0, 20),
    albums: sections.flatMap((s) => s.albums),
  };
}

export { albumPage as album, artistPage as artist };

// Playlists and the library.

// A long playlist comes in pages: this many is thousands of songs.
const pagesAtMost = 30;

async function tracksOfAll(answer) {
  const out = [];
  let { items, token } = rowsOf(answer);
  out.push(...ofKind(items, "track"));
  for (let i = 0; token && i < pagesAtMost; i++) {
    ({ items, token } = rowsOf(await call("browse", { continuation: token })));
    out.push(...ofKind(items, "track"));
  }
  return out;
}

async function playlistPage({ id }) {
  const answer = await browseId(`VL${id}`);
  const header = headerOf(answer);
  const tracks = await withDurations(await tracksOfAll(answer));
  return {
    id,
    name: textOf(header.title),
    imageUrl: imageOf(header.thumbnail),
    description: textOf(findOne(header.description, "description") || header.description),
    owner: textOf(header.straplineTextOne),
    trackCount: tracks.length,
    tracks,
  };
}
export { playlistPage as playlist };

// The app loads this for its sidebar as it starts: no account is no playlists,
// rather than asking someone who's only browsing to sign in.
export async function playlists() {
  if (!cookie()) return [];
  const items = (await sectionsOf(await browseId("FEmusic_liked_playlists"))).flatMap((s) => s.playlists);
  // Liked Music has an entry of its own, and episodes for later aren't songs.
  return items.filter((p) => p.id !== "LM" && p.id !== "SE").map((p) => ({ ...p, saved: true }));
}

export async function liked({ offset }) {
  needAccount();
  const token = pageToken("liked", offset);
  if (offset > 0 && !token) return { tracks: [], more: false };
  const answer = token ? await call("browse", { continuation: token }) : await browseId("VLLM");
  const { items, token: next } = rowsOf(answer);
  const tracks = await withDurations(ofKind(items, "track"));
  return { tracks, more: keepToken("liked", offset + tracks.length, next) };
}

// The service can't say of many songs at once which are liked, so the first few
// pages of liked songs answer, for a few minutes at a time.
let likedSet = null;
let likedAt = 0;
const likedFor = 5 * 60 * 1000;

async function likedIds() {
  if (likedSet && Date.now() - likedAt < likedFor) return likedSet;
  const set = new Set();
  let { items, token } = rowsOf(await browseId("VLLM"));
  for (let i = 0; ; i++) {
    for (const t of ofKind(items, "track")) set.add(t.id);
    if (!token || i >= 5) break;
    ({ items, token } = rowsOf(await call("browse", { continuation: token })));
  }
  likedSet = set;
  likedAt = Date.now();
  return set;
}

export async function isLiked({ ids }) {
  const set = cookie() ? await likedIds() : new Set();
  return Object.fromEntries(ids.map((id) => [id, set.has(id)]));
}

export async function like({ id, on }) {
  needAccount();
  await call(on ? "like/like" : "like/removelike", { target: { videoId: id } });
  if (likedSet) {
    if (on) likedSet.add(id);
    else likedSet.delete(id);
  }
}

export async function recent() {
  if (!cookie()) return [];
  const sections = await sectionsOf(await browseId("FEmusic_history"));
  return sections.flatMap((s) => s.tracks).slice(0, 50);
}

// Radio: songs like the one last played.

const radio = { id: "radio", name: "Radio", description: "Songs like the one you played last." };

export function stations() {
  return [radio];
}

// What's played also goes in your history on YouTube Music, which its
// recommendations are made from, as its own player would put it there.
export async function played({ id }) {
  host.storage.set("lastPlayed", id);
  if (!cookie()) return;
  try {
    await report(id);
  } catch (e) {
    console.warn(`reporting ${id} as played: ${e.message}`);
  }
}

async function report(id) {
  const r = await call("player", { videoId: id, playbackContext: { contentPlaybackContext: {} } });
  const base = r.playbackTracking?.videostatsPlaybackUrl?.baseUrl;
  if (!base) throw new Error("YouTube gave no address to report it to");
  const url = new URL(base);
  // The session goes with it, so it goes to YouTube alone.
  if (url.protocol !== "https:" || !/(^|\.)youtube\.com$/.test(url.hostname)) {
    throw new Error(`not sending your session to ${url.hostname}`);
  }
  url.searchParams.set("ver", "2");
  url.searchParams.set("c", "WEB_REMIX");
  url.searchParams.set("cpn", playbackNonce());
  const res = await fetch(url.href, {
    headers: { "user-agent": webUA, referer: `${site}/`, ...authHeaders(url.origin) },
  });
  if (!res.ok) throw new Error(`${res.status}`);
}

// The 16 characters a player sends to tell one playback from another.
function playbackNonce() {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[Math.floor(Math.random() * 64)];
  return out;
}

function panelTrack(v) {
  const credits = creditsOf(v.longBylineText?.runs);
  credits.duration = msOf(textOf(v.lengthText));
  return trackFrom(v.videoId, textOf(v.title), credits, imageOf(v.thumbnail));
}

// Each batch starts from what's playing by then, so a radio drifts as a radio
// does. With nothing played yet, the first song of Home will do. Nothing to go
// on is an empty batch, which the app asks again for: Home isn't the same each time.
export async function stationNext() {
  let seed = host.storage.get("lastPlayed");
  if (!seed) {
    const { sections } = await home();
    seed = sections.flatMap((s) => s.tracks)[0]?.id;
    if (!seed) return [];
  }
  const answer = await call("next", { videoId: seed, playlistId: `RDAMVM${seed}`, isAudioOnly: true, enablePersistentPlaylistPanel: true, tunerSettingValue: "AUTOMIX_SETTING_NORMAL" });
  return findAll(answer, "playlistPanelVideoRenderer").filter((v) => v.videoId !== seed).map(panelTrack);
}

// Lyrics+ 0.2.0. Lyrics queries are always anonymous.
// Keep the account and playback code above/below this section unchanged.
const lyricTracks = new Map();
const lyricPending = new Map();
const lyricCacheKey = "lyricsFixCacheV1";
const lyricDiagnosticKey = "lyricsFixDiagnosticsV1";
const lyricClient = { ...android, anonymous: true };
const lyricUA = "MyGoMusic-Youtube-Lyrics/0.2.0 (https://github.com/10416606/mygo-music-youtube-lyrics)";
let betterLyricsAfter = 0;
let lrclibAfter = 0;
let lrclibLastAt = 0;
let lrclibQueue = Promise.resolve();

function rememberLyricTrack(track) {
  if (!track?.id || !track.name) return track;
  lyricTracks.delete(track.id);
  lyricTracks.set(track.id, track);
  if (lyricTracks.size > 200) lyricTracks.delete(lyricTracks.keys().next().value);
  return track;
}

function readLyricStore(key, fallback) {
  try { return host.storage.get(key) ?? fallback; } catch { return fallback; }
}

function writeLyricStore(key, value) {
  try { host.storage.set(key, value); } catch { /* A cache failure must not hide lyrics. */ }
}

function lyricCount(value) {
  if (Array.isArray(value?.lines)) return value.lines.filter((l) => l.text?.trim()).length;
  return typeof value?.lrc === "string" ? (value.lrc.match(/\[\d+:\d+(?:\.\d+)?\]/g) || []).length : 0;
}

function cachedLyrics(id) {
  const entries = readLyricStore(lyricCacheKey, []);
  if (!Array.isArray(entries)) return null;
  const entry = entries.find((e) => e?.id === id && Date.now() - e.at < 7 * 86400000);
  return lyricCount(entry?.value) ? entry.value : null;
}

function cacheLyrics(id, value) {
  if (!lyricCount(value)) return;
  const old = readLyricStore(lyricCacheKey, []);
  const entries = [{ id, at: Date.now(), value }, ...(Array.isArray(old) ? old.filter((e) => e?.id !== id) : [])];
  while (entries.length > 30 || (entries.length > 1 && JSON.stringify(entries).length > 400000)) entries.pop();
  writeLyricStore(lyricCacheKey, entries);
}

function saveLyricDiagnostic(id, result, sources) {
  const old = readLyricStore(lyricDiagnosticKey, []);
  writeLyricStore(lyricDiagnosticKey, [
    { id, at: Date.now(), result, sources },
    ...(Array.isArray(old) ? old.slice(0, 11) : []),
  ]);
}

// The host drops a lyric call after 30 seconds. Leave room for every fallback.
async function lyricJSON(url, options, deadline, timeout = 4500) {
  const remaining = Math.min(timeout, deadline - Date.now());
  if (remaining < 100) throw new Error("deadline");
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { controller?.abort(); reject(new Error("timeout")); }, remaining);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...options, ...(controller ? { signal: controller.signal } : {}) });
        if (!response.ok) {
          const error = new Error(`http-${response.status}`);
          error.status = response.status;
          error.retryAfter = response.headers?.get?.("retry-after") || "";
          throw error;
        }
        return await response.json();
      })(),
      expired,
    ]);
  } finally { clearTimeout(timer); }
}

function lyricCall(endpoint, body, deadline, client = lyricClient) {
  return lyricJSON(`${site}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers: {
      "content-type": "application/json", origin: site, "x-origin": site,
      "user-agent": webUA, ...client.headers,
    },
    body: JSON.stringify({ context: { client: client.client }, ...body }),
  }, deadline, 5500);
}

async function lyricAttempt(name, task, sources) {
  const at = Date.now();
  try {
    const value = await task();
    sources.push({ name, status: value?.instrumental ? "instrumental" : lyricCount(value) || (name.endsWith("next") && value) ? "ok" : "empty", ms: Date.now() - at });
    return value;
  } catch (error) {
    const status = error?.status ? `http-${error.status}` : /timeout|deadline/.test(error?.message || "") ? "timeout" : "request-failed";
    sources.push({ name, status, ms: Date.now() - at });
    console.warn(`Lyrics Fix: ${name}: ${status}`);
    return null;
  }
}

export function lyrics({ id }) {
  const cached = cachedLyrics(id);
  if (cached) return Promise.resolve(cached);
  if (lyricPending.has(id)) return lyricPending.get(id);
  const pending = loadImprovedLyrics(id).finally(() => lyricPending.delete(id));
  lyricPending.set(id, pending);
  return pending;
}

async function loadImprovedLyrics(id) {
  const deadline = Date.now() + 24000;
  const sources = [];
  let track = lyricTracks.get(id);
  let next = await lyricAttempt("youtube-next", () => lyricCall("next", { videoId: id, isAudioOnly: true }, deadline), sources);
  if (!next && !track) {
    next = await lyricAttempt("youtube-web-next", () => lyricCall("next", { videoId: id, isAudioOnly: true }, deadline, { ...remix, anonymous: true }), sources);
  }
  const playing = next && findAll(next, "playlistPanelVideoRenderer").find((v) => v.videoId === id);
  if (playing) {
    const fresh = panelTrack(playing);
    track = rememberLyricTrack({
      ...track, ...fresh,
      duration: fresh.duration || track?.duration || 0,
      artists: fresh.artists?.length ? fresh.artists : track?.artists || [],
      album: fresh.album?.name ? fresh.album : track?.album || fresh.album,
    });
  }
  const own = next && await lyricAttempt("youtube-timed", () => youtubeLyrics(next, deadline), sources);
  if (lyricCount(own)) return finishLyrics(id, "youtube", own, sources);
  let instrumental = false;
  if (track?.name && track.artists?.some((a) => a.name)) {
    const lrc = await lyricAttempt("lrclib", () => lrclibLyrics(track, deadline), sources);
    if (lyricCount(lrc)) return finishLyrics(id, "lrclib", lrc, sources);
    instrumental = !!lrc?.instrumental;
    if (Date.now() >= betterLyricsAfter && Date.now() + 100 < deadline) {
      const better = await lyricAttempt("better-lyrics", () => betterLyrics(track, deadline), sources);
      if (lyricCount(better)) return finishLyrics(id, "better-lyrics", better, sources);
    }
  }
  saveLyricDiagnostic(id, instrumental ? "instrumental" : "not-found", sources);
  if (instrumental) return { lines: [] };
  // This is a status placeholder, not a fabricated lyric or song classification.
  // Do not cache it: playing the track again must retry failed requests.
  return { lines: [{ start: 0, end: track?.duration || 3600000, text: "暂未获取到歌词，请稍后重试" }] };
}

function finishLyrics(id, source, value, sources) {
  cacheLyrics(id, value);
  saveLyricDiagnostic(id, source, sources);
  return value;
}

function cleanLyricTitle(value) {
  return String(value || "").normalize("NFKC")
    .replace(/[（(\[]\s*(?:official\s+(?:music\s+)?video|official\s+audio|audio|mv|lyrics?(?:\s+video)?|官方(?:音樂|音乐)?(?:影片|视频|MV)|高音[質质]|動態歌詞|动态歌词|CC)\s*[）)\]]/gi, " ")
    .replace(/\s+/g, " ").trim();
}

function lyricName(value) {
  return cleanLyricTitle(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function matchingLyricRecord(record, track) {
  if (!record || lyricName(record.trackName || record.name) !== lyricName(track.name)) return false;
  const artist = lyricName(record.artistName);
  if (!artist || !(track.artists || []).some((a) => lyricName(a.name) === artist)) return false;
  if (track.duration && (!Number.isFinite(Number(record.duration)) || Math.abs(Number(record.duration) * 1000 - track.duration) > 8000)) return false;
  return true;
}

function retryLyricAfter(error) {
  const seconds = Number(error.retryAfter);
  const wait = error.retryAfter && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(error.retryAfter) - Date.now();
  const delay = Number.isFinite(wait) && wait >= 0 ? wait : 60000;
  return Date.now() + delay + Math.round(Math.random() * Math.min(delay * 0.3, 3000));
}

function lrclibRequest(path, query, deadline) {
  const request = async () => {
    if (Date.now() < lrclibAfter) throw new Error("rate-limited");
    const pause = Math.max(0, lrclibLastAt + 250 - Date.now());
    if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
    if (deadline - Date.now() < 100) throw new Error("deadline");
    lrclibLastAt = Date.now();
    try {
      return await lyricJSON(`https://lrclib.net/api/${path}?${new URLSearchParams(query)}`, {
        headers: { "user-agent": lyricUA },
      }, deadline, 6500);
    } catch (error) {
      if (error.status === 429 || error.status === 503) lrclibAfter = retryLyricAfter(error);
      throw error;
    }
  };
  const result = lrclibQueue.then(request, request);
  lrclibQueue = result.catch(() => {});
  return result;
}

function fromLrcRecord(record) {
  if (record.syncedLyrics && /\[\d+:\d+(?:\.\d+)?\]/.test(record.syncedLyrics)) return { lrc: record.syncedLyrics };
  return record.instrumental ? { instrumental: true } : null;
}

async function lrclibLyrics(track, deadline) {
  const artist = track.artists.find((a) => a.name).name;
  const query = { track_name: cleanLyricTitle(track.name), artist_name: artist };
  if (track.album?.name) query.album_name = track.album.name;
  if (track.duration > 0 && track.duration <= 3600000) query.duration = String(Math.round(track.duration / 1000));
  // Search cached records first. /get may start a much slower upstream lookup.
  const records = await lrclibRequest("search", { track_name: query.track_name, artist_name: artist }, deadline);
  const matches = (Array.isArray(records) ? records : []).filter((r) => matchingLyricRecord(r, track));
  matches.sort((a, b) => {
    const delta = (r) => Math.abs(Number(r.duration) * 1000 - (track.duration || Number(r.duration) * 1000));
    return delta(a) - delta(b);
  });
  // Search results are less conclusive than the exact endpoint; never classify
  // a song as instrumental solely from a search result.
  const found = matches.map(fromLrcRecord).find((r) => lyricCount(r));
  if (found) return found;
  let exact = null;
  try { exact = await lrclibRequest("get", query, deadline); }
  catch (error) { if (error.status !== 404) throw error; }
  return matchingLyricRecord(exact, track) ? fromLrcRecord(exact) : null;
}

async function betterLyrics(track, deadline) {
  const query = new URLSearchParams({ s: track.name, a: track.artists.map((a) => a.name).join(", ") });
  if (track.album?.name) query.set("al", track.album.name);
  if (track.duration) query.set("d", String(Math.round(track.duration / 1000)));
  try {
    const response = await lyricJSON(`https://api.betterlyrics.org/getLyrics?${query}`, {
      headers: { "user-agent": lyricUA },
    }, deadline, 3000);
    const lines = linesOfTTML(typeof response?.ttml === "string" ? response.ttml : "");
    return lines.length ? { lines } : null;
  } catch (error) {
    if (error.status === 401 || error.status === 403) betterLyricsAfter = Date.now() + 30 * 60000;
    if (error.status === 429) betterLyricsAfter = retryLyricAfter(error);
    throw error;
  }
}

async function youtubeLyrics(next, deadline) {
  const lyricsId = findAll(next, "browseId").find((b) => typeof b === "string" && /^MPLY/.test(b));
  if (!lyricsId) return null;
  const response = await lyricCall("browse", { browseId: lyricsId }, deadline);
  const data = findOne(response, "timedLyricsData");
  const timed = Array.isArray(data) ? data : Array.isArray(data?.lyrics) ? data.lyrics : [];
  const lines = timed.filter((l) => typeof l.lyricLine === "string" && l.lyricLine.trim()).map((l) => ({
    start: Number(l.cueRange?.startTimeMilliseconds),
    end: Number(l.cueRange?.endTimeMilliseconds) || 0,
    text: l.lyricLine,
  })).filter((l) => Number.isFinite(l.start) && l.start >= 0).sort((a, b) => a.start - b.start);
  return lines.length ? { lines } : null;
}

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXML = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) =>
    e[0] !== "#" ? (entities[e] ?? all) : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))),
  );

// A time as TTML writes it, such as 1:02.500 or 62.5, in milliseconds.
function clockOf(value) {
  if (!value) return null;
  const parts = value.trim().replace(/s$/, "").split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || !(Number(p) >= 0))) return null;
  return Math.round(parts.reduce((sum, p) => sum * 60 + Number(p), 0) * 1000);
}

const attrOf = (attrs, name) => attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

// The lines of a TTML document: each <p> is a line, and each <span> in it with a
// time is a word, or part of one. The text between them is the spacing, which
// goes with the word before it. A span with no time only groups others, such
// as background vocals, and its words are the line's own.
function linesOfTTML(ttml) {
  const lines = [];
  for (const [, pAttrs, body] of ttml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const words = [];
    let text = "";
    let lead = ""; // what comes before the first word
    let word = null; // the word being read, and how many spans deep in it
    let depth = 0;
    for (const [, close, name, attrs, chars] of body.matchAll(/<(\/?)([\w:.-]+)([^>]*?)\/?>|([^<]+)/g)) {
      if (chars !== undefined) {
        const s = unescapeXML(chars);
        text += s;
        if (word) word.text += s;
        else if (words.length) words[words.length - 1].text += s;
        else lead += s;
        continue;
      }
      if (name !== "span") continue;
      if (close) {
        if (word && --depth === 0) {
          words.push(word);
          word = null;
        }
      } else if (word) {
        depth++;
      } else {
        const start = clockOf(attrOf(attrs, "begin"));
        if (start === null) continue;
        word = { start, end: clockOf(attrOf(attrs, "end")) ?? start, text: lead.trimStart() };
        lead = "";
        depth = 1;
      }
    }
    const start = clockOf(attrOf(pAttrs, "begin")) ?? words[0]?.start;
    const end = clockOf(attrOf(pAttrs, "end")) ?? words[words.length - 1]?.end ?? 0;
    text = text.replace(/\s+/g, " ").trim();
    // A line with no time can't be followed.
    if (text && start != null) lines.push({ start, end, text, words: words.length ? words : undefined });
  }
  return lines;
}

// Playing.

const installed = {};

// GUI apps don't get a shell's PATH, so where programs are commonly installed is
// tried too. Starting one is the only way a plugin can tell it's there.
async function program(name, versionFlag) {
  if (installed[name]) return installed[name];
  const folder = host.setting("programs");
  const sep = host.platform === "windows" ? "\\" : "/";
  const places = [
    ...(folder ? [`${folder.replace(/[\\/]+$/, "")}${sep}${name}`] : []),
    name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ];
  for (const path of places) {
    try {
      const proc = host.spawn(path, [versionFlag]);
      proc.closeStdin();
      while ((await proc.readLine()) !== null) {}
      if ((await proc.wait()) === 0) {
        installed[name] = path;
        return path;
      }
    } catch (e) {
      if (/allowed/.test(e.message)) {
        throw fail("setup", "Allow YouTube Music to start programs in its settings");
      }
    }
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Where a track's audio is, and how loud it is. Its address lasts for hours.
const located = new Map();
const locatedFor = 60 * 60 * 1000;

async function locate(id) {
  const known = located.get(id);
  if (known && Date.now() - known.at < locatedFor) return known;
  let found;
  try {
    found = await direct(id);
  } catch (e) {
    // What YouTube won't play, yt-dlp can't either.
    if (e.code === "unavailable") throw e;
    console.warn(`finding ${id}'s audio: ${e.message}`);
    visitor = "";
    found = await throughYtdlp(id, e);
  }
  found.at = Date.now();
  located.set(id, found);
  return found;
}

// A visit gets an ID before it's given any audio, or it's asked if it's a bot.
let visitor = "";

async function visitorData() {
  if (visitor) return visitor;
  const r = await call("visitor_id", {}, { ...remix, anonymous: true });
  visitor = r.responseContext?.visitorData || "";
  if (!visitor) throw new Error("YouTube gave this visit no ID");
  return visitor;
}

// The audio of the highest bit rate, as yt-dlp picks it: in the track's own
// language, and as it was mixed, rather than the copy with its range
// compressed, which YouTube lists beside it.
async function direct(id) {
  const r = await call("player", { videoId: id, contentCheckOk: true, racyCheckOk: true }, visionOS(await visitorData()));
  const status = r.playabilityStatus || {};
  if (status.status !== "OK") {
    const why = status.reason || `YouTube says ${status.status || "nothing"} of this`;
    throw status.status === "UNPLAYABLE" || status.status === "ERROR" ? fail("unavailable", why) : new Error(why);
  }
  let best = null;
  for (const f of r.streamingData?.adaptiveFormats || []) {
    if (!f.mimeType?.startsWith("audio/") || !f.url || f.isDrc) continue;
    if (f.audioTrack && !f.audioTrack.audioIsDefault) continue;
    if (!best || f.bitrate > best.bitrate) best = f;
  }
  if (!best) throw new Error("YouTube listed no audio to play as it is");
  return { url: best.url, http_headers: { "User-Agent": webUA }, gain: gainOf(r.playerConfig?.audioConfig), direct: true };
}

// The app's gain is ReplayGain's, which brings a track to -18 LUFS, and YouTube
// says how loud a track is.
function gainOf(audio) {
  const lkfs = audio?.trackAbsoluteLoudnessLkfs ?? audio?.perceptualLoudnessDb;
  if (typeof lkfs !== "number" || !lkfs) return undefined;
  return Math.round((-18 - lkfs) * 100) / 100;
}

// The cookie goes to yt-dlp on its standard input, as anyone on this machine can
// read the arguments of a program.
function ytdlpConfig() {
  const c = cookie();
  return c ? `--add-headers "Cookie:${c.replace(/[\\"]/g, "\\$&")}"\n` : "";
}

const ytdlpTimeout = 25000;

// yt-dlp finds the audio as YouTube's website does, which takes it a few
// seconds, and a JavaScript runtime to work out YouTube's challenges. Without
// it, what went wrong without it stands.
async function throughYtdlp(id, why) {
  const ytdlp = await program("yt-dlp", "--version");
  if (!ytdlp) throw why;
  const args = [
    "--config-locations", "-",
    "--no-warnings", "--no-playlist", "--no-progress",
    ...whatYtdlpAsks(),
    "--print", "%(.{url,http_headers})j",
  ];
  for (const runtime of ["deno", "node", "bun"]) {
    const path = await program(runtime, "--version");
    if (path) {
      args.push("--js-runtimes", `${runtime}:${path}`);
      break;
    }
  }
  args.push(`https://www.youtube.com/watch?v=${id}`);

  const proc = host.spawn(ytdlp, args);
  proc.write(ytdlpConfig());
  proc.closeStdin();
  const timer = setTimeout(() => proc.kill(), ytdlpTimeout);
  const lines = [];
  for (let line; (line = await proc.readLine()) !== null; ) lines.push(line);
  const code = await proc.wait();
  clearTimeout(timer);
  if (code !== 0 || !lines.length) throw ytdlpFailure(proc.errorOutput());
  return { ...JSON.parse(lines[lines.length - 1]), direct: false };
}

// Which of YouTube's apps yt-dlp asks as, and for what. Signed out, its own
// choice works, and the audio alone, as one file. With a session it asks as the
// embedded player, whose addresses YouTube now turns down with no token from
// its JavaScript, which yt-dlp can't make. Safari's are good, but only as HLS,
// with video: at 360p, its audio is the AAC YouTube has on its own.
function whatYtdlpAsks() {
  if (!cookie()) {
    return ["--extractor-args", "youtube:skip=hls,dash", "--format", "bestaudio[protocol^=http]/bestaudio"];
  }
  return [
    "--extractor-args", "youtube:player_client=web_safari",
    "--format", "bestaudio[protocol^=m3u8]/93/94/92/95/91",
  ];
}

function ytdlpFailure(output) {
  const said = output.split("\n").reverse().find((l) => l.startsWith("ERROR:")) || output.trim() || "yt-dlp stopped";
  const why = said.replace(/^ERROR:\s*(\[[^\]]*\]\s*)?(\S+:\s*)?/, "");
  if (/not a bot|sign in|cookies/i.test(why)) {
    return fail("signIn", cookie() ? "YouTube turned down your session: sign in again" : "YouTube asks you to sign in to play this");
  }
  if (/unavailable|private|removed|not available|premium/i.test(why)) return fail("unavailable", why);
  return new Error(why);
}

// YouTube's own player asks for its audio a piece at a time, and serves one
// request for all of it slowly. An older ffmpeg can't ask that way.
let ranged = null;

async function asksInPieces(ffmpeg) {
  if (ranged !== null) return ranged;
  const proc = host.spawn(ffmpeg, ["-hide_banner", "-h", "protocol=http"]);
  proc.closeStdin();
  let found = false;
  for (let line; (line = await proc.readLine()) !== null; ) found ||= line.includes("-request_size");
  await proc.wait();
  return (ranged = found);
}

// ffmpeg serves the MP3 itself, to the one request that comes for it, and so
// lets the track start before all of it is there. No more than a few wait at a
// time, for what was skipped before it was ever asked for.
const serving = [];
const servingAtMost = 3;
const servedWithin = 10 * 60 * 1000;

function stopWaiting() {
  while (serving.length >= servingAtMost) serving.shift().kill();
}

async function serve(source, bitRate) {
  const ffmpeg = await program("ffmpeg", "-version");
  if (!ffmpeg) {
    throw fail("setup", "YouTube Music plays through ffmpeg: install it, or say where it is in the plugin's settings");
  }
  const pieces = await asksInPieces(ffmpeg);
  stopWaiting();
  const headers = source.http_headers || {};
  const port = 20000 + Math.floor(Math.random() * 40000);
  const proc = host.spawn(ffmpeg, [
    "-nostdin", "-hide_banner", "-nostats",
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
    "-rw_timeout", "15000000",
    ...(pieces ? ["-request_size", String(10 << 20)] : []),
    ...(headers["User-Agent"] ? ["-user_agent", headers["User-Agent"]] : []),
    "-i", source.url,
    "-vn", "-c:a", "libmp3lame", "-b:a", `${bitRate}k`, "-id3v2_version", "0", "-write_xing", "0",
    "-f", "mp3", "-listen", "1", `http://127.0.0.1:${port}/`,
  ]);
  proc.closeStdin();
  let stopped = false;
  serving.push(proc);
  const timer = setTimeout(() => proc.kill(), servedWithin);
  proc.wait().then(() => {
    stopped = true;
    clearTimeout(timer);
    const at = serving.indexOf(proc);
    if (at >= 0) serving.splice(at, 1);
  });
  // It says what it's reading right before it opens the port. Trying the port
  // isn't a way to find out: it would take the one request ffmpeg answers.
  const until = Date.now() + 15000;
  while (!proc.errorOutput().includes("Input #0")) {
    if (stopped) throw new Error(`ffmpeg stopped: ${proc.errorOutput().trim().split("\n").pop()}`);
    if (Date.now() > until) {
      proc.kill();
      throw new Error("the audio didn't start in time");
    }
    await sleep(30);
  }
  await sleep(100);
  return `http://127.0.0.1:${port}/`;
}

export async function stream({ id, quality }) {
  const kbps = quality === "standard" ? 128 : 192;
  let source = await locate(id);
  let url;
  try {
    url = await serve(source, kbps);
  } catch (e) {
    // An address may stop working before it said it would, and YouTube now and
    // then turns down one it just gave out: yt-dlp may find one that works.
    located.delete(id);
    if (!source.direct || e.code === "setup") throw e;
    console.warn(`playing ${id} as YouTube gave it: ${e.message}`);
    source = { ...(await throughYtdlp(id, e)), gain: source.gain, at: Date.now() };
    url = await serve(source, kbps);
    located.set(id, source);
  }
  return {
    url,
    type: "mp3",
    quality: kbps === 128 ? "standard" : "high",
    bitRate: kbps * 1000,
    gain: source.gain,
  };
}
