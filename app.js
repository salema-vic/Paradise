const PLAYLIST_URL = "https://raw.githubusercontent.com/Paradise-91/ParaTV/main/playlists/paratv/main/paratv-highest.m3u";

/*
  RÉGLAGE IMPORTANT

  Tu peux choisir la première chaîne de 3 façons :

  1. Par l'URL :
     http://localhost:8080/?channel=tf1
     http://localhost:8080/?channel=france%202
     http://localhost:8080/?index=3

  2. En modifiant DEFAULT_CHANNEL_NAME ci-dessous.
     Exemple :
     const DEFAULT_CHANNEL_NAME = "France 2";

  3. En modifiant DEFAULT_CHANNEL_INDEX ci-dessous.
     Attention : l'index commence à 0.
*/
const DEFAULT_CHANNEL_NAME = "";
const DEFAULT_CHANNEL_INDEX = null;

const FALLBACK_CHANNEL_HINTS = [
  "tf1",
  "la une",
  "para tv",
  "paratv"
];

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const ERROR_RELOAD_DELAY_MS = 2500;
const MIN_REFRESH_DELAY_MS = 60 * 1000;
const FALLBACK_REFRESH_MS = 30 * 60 * 1000;
const PLAYLIST_REFRESH_MS = 10 * 60 * 1000;
const STATUS_AUTO_HIDE_MS = 5000;

const video = document.getElementById("video");
const stateBadge = document.getElementById("stateBadge");
const playlistLabel = document.getElementById("playlistLabel");
const channelLabel = document.getElementById("channelLabel");
const streamLabel = document.getElementById("streamLabel");
const startupSelectionLabel = document.getElementById("startupSelectionLabel");
const lastLoad = document.getElementById("lastLoad");
const expiresAt = document.getElementById("expiresAt");
const nextRefresh = document.getElementById("nextRefresh");
const logBox = document.getElementById("log");
const reloadButton = document.getElementById("reloadButton");
const reloadPlaylistButton = document.getElementById("reloadPlaylistButton");
const muteButton = document.getElementById("muteButton");
const playButton = document.getElementById("playButton");
const controlsButton = document.getElementById("controlsButton");
const controlsPanel = document.getElementById("controlsPanel");
const channelSelect = document.getElementById("channelSelect");
const statusBar = document.getElementById("statusBar");
const statusText = document.getElementById("statusText");

let hls = null;
let refreshTimer = null;
let playlistTimer = null;
let reloadTimer = null;
let statusTimer = null;
let objectUrl = null;
let channels = [];
let selectedChannelIndex = 0;
let selectedStreamUrl = "";
let lastPlaylistText = "";
let isReloading = false;

playlistLabel.textContent = PLAYLIST_URL;

function log(message) {
  const time = new Date().toLocaleTimeString("fr-FR");
  logBox.textContent = `[${time}] ${message}\n` + logBox.textContent;
}

function showStatus(message, autoHide = true) {
  statusText.textContent = message;
  statusBar.classList.remove("hidden");

  clearTimeout(statusTimer);
  if (autoHide) {
    statusTimer = setTimeout(() => {
      statusBar.classList.add("hidden");
    }, STATUS_AUTO_HIDE_MS);
  }
}

function setState(text, type = "") {
  stateBadge.textContent = text;
  stateBadge.className = `badge ${type}`.trim();
  showStatus(text, type === "ok");
}

function formatDate(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("fr-FR");
}

function addCacheBuster(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_=${Date.now()}`;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getUrlChannelName() {
  const params = new URLSearchParams(window.location.search);
  return params.get("channel") || params.get("chaine") || params.get("name") || "";
}

function getUrlChannelIndex() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("index");
  if (raw === null || raw === "") return null;

  const value = Number(raw);
  if (!Number.isInteger(value)) return null;

  return value;
}

function resolveRelativeUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl).href;
  } catch (_) {
    return url;
  }
}

async function fetchText(url) {
  const response = await fetch(addCacheBuster(url), {
    cache: "no-store",
    headers: {
      "Accept": "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} pendant la récupération de ${url}`);
  }

  return response.text();
}

function parseM3u(text, baseUrl) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsedChannels = [];
  let pendingInfo = null;

  for (const line of lines) {
    if (line.startsWith("#EXTINF")) {
      const namePart = line.includes(",") ? line.slice(line.lastIndexOf(",") + 1).trim() : "Chaîne sans nom";
      const tvgName = line.match(/tvg-name="([^"]+)"/i)?.[1];
      const tvgId = line.match(/tvg-id="([^"]+)"/i)?.[1];
      const groupTitle = line.match(/group-title="([^"]+)"/i)?.[1];
      const logo = line.match(/tvg-logo="([^"]+)"/i)?.[1];

      pendingInfo = {
        name: tvgName || namePart || tvgId || "Chaîne sans nom",
        title: namePart || tvgName || tvgId || "Chaîne sans nom",
        id: tvgId || "",
        group: groupTitle || "",
        logo: logo || ""
      };
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    if (line.includes(".m3u8") || line.includes(".m3u")) {
      parsedChannels.push({
        ...(pendingInfo || {
          name: `Flux ${parsedChannels.length + 1}`,
          title: `Flux ${parsedChannels.length + 1}`,
          id: "",
          group: "",
          logo: ""
        }),
        url: resolveRelativeUrl(line, baseUrl)
      });
      pendingInfo = null;
    }
  }

  return parsedChannels;
}

function findChannelByName(list, wantedName) {
  const wanted = normalizeText(wantedName);
  if (!wanted) return -1;

  let index = list.findIndex((channel) => {
    const exactValues = [channel.name, channel.title, channel.id]
      .map(normalizeText)
      .filter(Boolean);

    return exactValues.includes(wanted);
  });

  if (index >= 0) return index;

  index = list.findIndex((channel) => {
    const searchable = normalizeText(`${channel.name} ${channel.title} ${channel.id} ${channel.group} ${channel.url}`);
    return searchable.includes(wanted);
  });

  return index;
}

function findFallbackChannelIndex(list) {
  for (const hint of FALLBACK_CHANNEL_HINTS) {
    const index = findChannelByName(list, hint);
    if (index >= 0) return index;
  }

  return 0;
}

function findStartupChannelIndex(list) {
  const urlIndex = getUrlChannelIndex();
  if (urlIndex !== null && list[urlIndex]) {
    startupSelectionLabel.textContent = `URL index=${urlIndex}`;
    return urlIndex;
  }

  const urlChannel = getUrlChannelName();
  const urlChannelIndex = findChannelByName(list, urlChannel);
  if (urlChannelIndex >= 0) {
    startupSelectionLabel.textContent = `URL channel=${urlChannel}`;
    return urlChannelIndex;
  }

  if (DEFAULT_CHANNEL_INDEX !== null && list[DEFAULT_CHANNEL_INDEX]) {
    startupSelectionLabel.textContent = `DEFAULT_CHANNEL_INDEX=${DEFAULT_CHANNEL_INDEX}`;
    return DEFAULT_CHANNEL_INDEX;
  }

  const defaultNameIndex = findChannelByName(list, DEFAULT_CHANNEL_NAME);
  if (defaultNameIndex >= 0) {
    startupSelectionLabel.textContent = `DEFAULT_CHANNEL_NAME=${DEFAULT_CHANNEL_NAME}`;
    return defaultNameIndex;
  }

  const fallbackIndex = findFallbackChannelIndex(list);
  startupSelectionLabel.textContent = `fallback index=${fallbackIndex}`;
  return fallbackIndex;
}

function renderChannelSelect() {
  channelSelect.innerHTML = "";

  channels.forEach((channel, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${index} — ${channel.group ? `${channel.name} · ${channel.group}` : channel.name}`;
    channelSelect.appendChild(option);
  });

  channelSelect.value = String(selectedChannelIndex);
}

function selectChannel(index) {
  if (!channels[index]) return;

  selectedChannelIndex = index;
  selectedStreamUrl = channels[index].url;

  channelLabel.textContent = `${index} — ${channels[index].name}`;
  streamLabel.textContent = selectedStreamUrl;
  channelSelect.value = String(index);
}

async function loadMainPlaylist(keepCurrentSelection = true) {
  setState("Chargement playlist", "warn");
  log("Récupération de la playlist principale.");

  const text = await fetchText(PLAYLIST_URL);
  const parsed = parseM3u(text, PLAYLIST_URL);

  if (!parsed.length) {
    throw new Error("Aucun flux M3U8 trouvé dans la playlist principale.");
  }

  const previousUrl = selectedStreamUrl;
  channels = parsed;

  if (keepCurrentSelection && previousUrl) {
    const sameUrlIndex = channels.findIndex((channel) => channel.url === previousUrl);
    selectedChannelIndex = sameUrlIndex >= 0 ? sameUrlIndex : findStartupChannelIndex(channels);
  } else {
    selectedChannelIndex = findStartupChannelIndex(channels);
  }

  renderChannelSelect();
  selectChannel(selectedChannelIndex);

  clearTimeout(playlistTimer);
  playlistTimer = setTimeout(() => {
    loadMainPlaylist(true)
      .then(() => reloadFreshPlaylist("playlist principale rafraîchie"))
      .catch((error) => {
        log(error.message);
        queueReload("erreur refresh playlist principale");
      });
  }, PLAYLIST_REFRESH_MS);

  log(`${channels.length} flux trouvés dans la playlist principale.`);
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  return atob(padded);
}

function extractJwtExpirationMs(text) {
  const jwtMatch = text.match(/https?:\/\/[^\s"']+\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (!jwtMatch) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(jwtMatch[1].split(".")[1]));
    if (!payload.exp) return null;
    return Number(payload.exp) * 1000;
  } catch (error) {
    log(`Impossible de lire l'expiration JWT: ${error.message}`);
    return null;
  }
}

function extractCommentExpirationMs(text) {
  const match = text.match(/Expires at\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+CEST/i);
  if (!match) return null;

  const [, day, month, year, hour, minute, second] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}+02:00`;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}

function getExpirationMs(text) {
  return extractJwtExpirationMs(text) || extractCommentExpirationMs(text);
}

function scheduleRefresh(expirationMs) {
  clearTimeout(refreshTimer);

  let delay = FALLBACK_REFRESH_MS;

  if (expirationMs) {
    const refreshAt = expirationMs - REFRESH_MARGIN_MS;
    delay = Math.max(refreshAt - Date.now(), MIN_REFRESH_DELAY_MS);
  }

  nextRefresh.textContent = formatDate(Date.now() + delay);
  refreshTimer = setTimeout(() => {
    reloadFreshPlaylist("refresh programmé avant expiration");
  }, delay);
}

async function fetchSelectedStreamPlaylist() {
  if (!selectedStreamUrl) {
    await loadMainPlaylist(false);
  }

  const text = await fetchText(selectedStreamUrl);

  if (!text.includes("#EXTM3U")) {
    throw new Error("Le flux sélectionné ne ressemble pas à une playlist M3U8 valide.");
  }

  return text;
}

function cleanupPlayer() {
  clearTimeout(reloadTimer);

  if (hls) {
    hls.destroy();
    hls = null;
  }

  video.removeAttribute("src");
  video.load();

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function updatePlayButton() {
  playButton.textContent = video.paused ? "Lecture" : "Pause";
}

function updateMuteButton() {
  muteButton.textContent = video.muted ? "Activer le son" : "Couper le son";
}

function playWhenReady() {
  const playPromise = video.play();

  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      showStatus("Autoplay bloqué. Clique sur lecture.", false);
      log("Lecture automatique bloquée par le navigateur.");
    });
  }

  updatePlayButton();
}

async function loadWithHlsJs(playlistText) {
  objectUrl = URL.createObjectURL(
    new Blob([playlistText], {
      type: "application/vnd.apple.mpegurl"
    })
  );

  hls = new Hls({
    lowLatencyMode: true,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 8,
    fragLoadingRetryDelay: 1000,
    manifestLoadingRetryDelay: 1000,
    levelLoadingRetryDelay: 1000
  });

  hls.on(Hls.Events.MEDIA_ATTACHED, () => {
    hls.loadSource(objectUrl);
  });

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    setState("Lecture prête", "ok");
    playWhenReady();
  });

  hls.on(Hls.Events.ERROR, (_, data) => {
    const details = data?.details || "erreur inconnue";
    const fatal = data?.fatal ? "fatale" : "non fatale";
    log(`Erreur HLS ${fatal}: ${details}`);

    const shouldReload =
      data?.fatal ||
      details.includes("manifest") ||
      details.includes("levelLoad") ||
      details.includes("fragLoad") ||
      details.includes("keyLoad");

    if (shouldReload) {
      queueReload(`erreur HLS: ${details}`);
    }
  });

  hls.attachMedia(video);
}

async function loadWithNativeHls() {
  video.src = addCacheBuster(selectedStreamUrl);
  video.addEventListener("loadedmetadata", playWhenReady, { once: true });
  video.addEventListener("error", () => {
    queueReload("erreur vidéo native");
  }, { once: true });
}

async function reloadFreshPlaylist(reason = "chargement initial") {
  if (isReloading) return;
  isReloading = true;

  try {
    setState("Rechargement", "warn");
    log(`Début: ${reason}`);

    cleanupPlayer();

    const playlistText = await fetchSelectedStreamPlaylist();
    lastPlaylistText = playlistText;

    const expirationMs = getExpirationMs(playlistText);
    lastLoad.textContent = formatDate(Date.now());
    expiresAt.textContent = formatDate(expirationMs);
    scheduleRefresh(expirationMs);

    if (window.Hls && Hls.isSupported()) {
      await loadWithHlsJs(playlistText);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      await loadWithNativeHls();
      setState("Lecture native", "ok");
    } else {
      throw new Error("Ce navigateur ne supporte pas HLS. Essaie Chrome, Edge, Firefox ou Safari.");
    }

    log("Flux sélectionné relu avec succès.");
  } catch (error) {
    setState("Erreur", "error");
    showStatus(error.message, false);
    log(error.message);

    try {
      await loadMainPlaylist(true);
    } catch (playlistError) {
      log(playlistError.message);
    }

    queueReload("nouvel essai après erreur");
  } finally {
    isReloading = false;
  }
}

function queueReload(reason) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadFreshPlaylist(reason);
  }, ERROR_RELOAD_DELAY_MS);
}

controlsButton.addEventListener("click", () => {
  controlsPanel.classList.toggle("hidden");
});

reloadButton.addEventListener("click", () => {
  reloadFreshPlaylist("rechargement manuel");
});

reloadPlaylistButton.addEventListener("click", async () => {
  try {
    await loadMainPlaylist(false);
    await reloadFreshPlaylist("rechargement manuel de la playlist principale");
  } catch (error) {
    setState("Erreur", "error");
    showStatus(error.message, false);
    log(error.message);
  }
});

channelSelect.addEventListener("change", () => {
  selectChannel(Number(channelSelect.value));
  reloadFreshPlaylist("changement de chaîne");
});

muteButton.addEventListener("click", () => {
  video.muted = !video.muted;
  updateMuteButton();
});

playButton.addEventListener("click", () => {
  if (video.paused) {
    playWhenReady();
  } else {
    video.pause();
  }
  updatePlayButton();
});

video.addEventListener("play", updatePlayButton);
video.addEventListener("pause", updatePlayButton);
video.addEventListener("volumechange", updateMuteButton);

document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "m") {
    video.muted = !video.muted;
    updateMuteButton();
  }

  if (event.code === "Space") {
    event.preventDefault();
    if (video.paused) {
      playWhenReady();
    } else {
      video.pause();
    }
    updatePlayButton();
  }

  if (event.key.toLowerCase() === "r") {
    reloadFreshPlaylist("rechargement clavier");
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    const expirationMs = getExpirationMs(lastPlaylistText);
    if (expirationMs && expirationMs - Date.now() < REFRESH_MARGIN_MS) {
      reloadFreshPlaylist("retour onglet avec token proche de l'expiration");
    }
  }
});

async function boot() {
  try {
    updateMuteButton();
    updatePlayButton();
    await loadMainPlaylist(false);
    await reloadFreshPlaylist("chargement initial");
  } catch (error) {
    setState("Erreur", "error");
    showStatus(error.message, false);
    log(error.message);
    queueReload("nouvel essai après erreur au démarrage");
  }
}

boot();
