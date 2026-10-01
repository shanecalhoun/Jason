/* Calhoun Performance Photography — Watermark & Upload to Drive
   Single-user client-side app. No backend: OAuth happens in-browser via
   Google Identity Services, uploads go straight from the browser to the
   Google Drive REST API using a short-lived access token. */

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FULL_SCOPE = "https://www.googleapis.com/auth/drive";
const DEFAULT_CLIENT_ID = "845304710957-7s9bqota0bi3gv69r4so2lie9m1ts582.apps.googleusercontent.com";
const DEFAULT_LOGO_PATH = "assets/watermark-logo.png";
const SETTINGS_KEY = "watermarkAppSettings.v1";

const defaultSettings = {
  clientId: DEFAULT_CLIENT_ID,
  useExistingFolder: false,
  existingFolderId: "",
  ownedFolderName: "Watermarked Photos",
  ownedFolderId: "",
  logoEnabled: true,
  logoDataUrl: null, // null = use bundled default logo
  logoPosition: "bottom-right",
  logoScalePct: 20,
  logoOpacityPct: 85,
  logoMarginPx: 40,
  textEnabled: false,
  textContent: "© Calhoun Performance Photography",
  textPosition: "bottom-left",
  textScalePct: 3,
  textOpacityPct: 80,
  textColor: "#ffffff",
  textMarginPx: 40,
  outputFormat: "image/jpeg",
  outputQuality: 92,
};

let settings = loadSettings();
let accessToken = null;
let tokenClient = null;
let tokenScope = null;
let defaultLogoImage = null; // Image element for bundled logo
let selectedPhotos = []; // { id, file, status, thumbUrl }

const el = (id) => document.getElementById(id);

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function log(message, kind = "") {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
  if (kind) li.classList.add(kind);
  el("logList").prepend(li);
}

/* ---------------- Auth ---------------- */

function currentScope() {
  return settings.useExistingFolder ? DRIVE_FULL_SCOPE : DRIVE_FILE_SCOPE;
}

function ensureTokenClient() {
  const scope = currentScope();
  if (!tokenClient || tokenScope !== scope || tokenClient._clientId !== settings.clientId) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: settings.clientId,
      scope,
      callback: () => {}, // overridden per-request
    });
    tokenClient._clientId = settings.clientId;
    tokenScope = scope;
    accessToken = null; // scope/client changed, discard any old token
    setSignedIn(false);
  }
  return tokenClient;
}

function getAccessToken({ interactive = true } = {}) {
  return new Promise((resolve, reject) => {
    const client = ensureTokenClient();
    if (accessToken) {
      resolve(accessToken);
      return;
    }
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      accessToken = resp.access_token;
      setSignedIn(true);
      resolve(accessToken);
    };
    client.requestAccessToken({ prompt: interactive ? "" : "none" });
  });
}

function setSignedIn(isSignedIn) {
  const pill = el("authStatus");
  if (isSignedIn) {
    pill.textContent = "Signed in";
    pill.className = "status-pill status-signed-in";
    el("signInBtn").textContent = "Switch Account";
  } else {
    pill.textContent = "Signed out";
    pill.className = "status-pill status-signed-out";
    el("signInBtn").textContent = "Sign in with Google";
  }
  refreshUploadEnabled();
}

/* ---------------- Drive API ---------------- */

async function driveFetch(url, options = {}) {
  const token = await getAccessToken();
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  const resp = await fetch(url, { ...options, headers });
  if (resp.status === 401) {
    // token expired/invalid — force a fresh one and retry once
    accessToken = null;
    const retryToken = await getAccessToken();
    const retryHeaders = { ...(options.headers || {}), Authorization: `Bearer ${retryToken}` };
    return fetch(url, { ...options, headers: retryHeaders });
  }
  return resp;
}

function extractFolderId(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/[-\w]{25,}/);
  return match ? match[0] : trimmed;
}

async function findExistingAppFolder(name) {
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const resp = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`
  );
  if (!resp.ok) throw new Error(`Folder lookup failed (${resp.status})`);
  const data = await resp.json();
  return data.files && data.files.length ? data.files[0].id : null;
}

async function createAppFolder(name) {
  const resp = await driveFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!resp.ok) throw new Error(`Folder creation failed (${resp.status})`);
  const data = await resp.json();
  return data.id;
}

async function ensureOwnedFolder() {
  if (settings.ownedFolderId) return settings.ownedFolderId;
  const name = settings.ownedFolderName || defaultSettings.ownedFolderName;
  let id = await findExistingAppFolder(name);
  if (!id) id = await createAppFolder(name);
  settings.ownedFolderId = id;
  saveSettings();
  return id;
}

async function getTargetFolderId() {
  if (settings.useExistingFolder) {
    if (!settings.existingFolderId) throw new Error("No existing folder ID set in Settings.");
    return settings.existingFolderId;
  }
  return ensureOwnedFolder();
}

async function uploadFileToDrive(blob, filename, folderId) {
  const metadata = { name: filename, parents: [folderId] };
  const boundary = "-------watermarkapp" + Math.random().toString(16).slice(2);
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const metaPart = `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`;
  const mediaHeader = `Content-Type: ${blob.type}\r\n\r\n`;

  const bodyBlob = new Blob(
    [delimiter, metaPart, delimiter, mediaHeader, blob, closeDelim],
    { type: `multipart/related; boundary=${boundary}` }
  );

  const resp = await driveFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: bodyBlob,
    }
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Upload failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  return resp.json();
}

/* ---------------- Watermark rendering ---------------- */

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = reject;
    img.src = url;
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function positionFor(key, canvasW, canvasH, boxW, boxH, margin) {
  switch (key) {
    case "top-left":
      return { x: margin, y: margin };
    case "top-right":
      return { x: canvasW - boxW - margin, y: margin };
    case "bottom-left":
      return { x: margin, y: canvasH - boxH - margin };
    case "center":
      return { x: (canvasW - boxW) / 2, y: (canvasH - boxH) / 2 };
    case "bottom-right":
    default:
      return { x: canvasW - boxW - margin, y: canvasH - boxH - margin };
  }
}

async function getLogoImageElement() {
  if (settings.logoDataUrl) return loadImage(settings.logoDataUrl);
  if (!defaultLogoImage) defaultLogoImage = await loadImage(DEFAULT_LOGO_PATH);
  return defaultLogoImage;
}

async function renderWatermarkedCanvas(sourceImg) {
  const canvas = document.createElement("canvas");
  canvas.width = sourceImg.naturalWidth;
  canvas.height = sourceImg.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(sourceImg, 0, 0);

  if (settings.logoEnabled) {
    try {
      const logoImg = await getLogoImageElement();
      const targetW = canvas.width * (settings.logoScalePct / 100);
      const ratio = logoImg.naturalHeight / logoImg.naturalWidth;
      const targetH = targetW * ratio;
      const pos = positionFor(settings.logoPosition, canvas.width, canvas.height, targetW, targetH, settings.logoMarginPx);
      ctx.save();
      ctx.globalAlpha = settings.logoOpacityPct / 100;
      ctx.drawImage(logoImg, pos.x, pos.y, targetW, targetH);
      ctx.restore();
    } catch (e) {
      console.error("Logo watermark failed", e);
    }
  }

  if (settings.textEnabled && settings.textContent) {
    const fontSize = Math.round(canvas.width * (settings.textScalePct / 100));
    ctx.save();
    ctx.globalAlpha = settings.textOpacityPct / 100;
    ctx.font = `600 ${fontSize}px -apple-system, Helvetica, Arial, sans-serif`;
    ctx.fillStyle = settings.textColor;
    ctx.textBaseline = "top";
    const metrics = ctx.measureText(settings.textContent);
    const pos = positionFor(settings.textPosition, canvas.width, canvas.height, metrics.width, fontSize * 1.2, settings.textMarginPx);
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = fontSize * 0.08;
    ctx.fillText(settings.textContent, pos.x, pos.y);
    ctx.restore();
  }

  return canvas;
}

function canvasToBlob(canvas, type, qualityPct) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, qualityPct / 100);
  });
}

/* ---------------- Preview ---------------- */

async function updatePreview() {
  if (!selectedPhotos.length) return;
  const first = selectedPhotos[0];
  const canvas = await renderWatermarkedCanvas(first.imgEl);
  const previewCanvas = el("previewCanvas");
  const maxW = 640;
  const scale = Math.min(1, maxW / canvas.width);
  previewCanvas.width = canvas.width * scale;
  previewCanvas.height = canvas.height * scale;
  const ctx = previewCanvas.getContext("2d");
  ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  ctx.drawImage(canvas, 0, 0, previewCanvas.width, previewCanvas.height);
}

/* ---------------- Photo list UI ---------------- */

function renderPhotoGrid() {
  const grid = el("photoGrid");
  grid.innerHTML = "";
  selectedPhotos.forEach((p) => {
    const card = document.createElement("div");
    card.className = "photo-card";
    const img = document.createElement("img");
    img.src = p.thumbUrl;
    const badge = document.createElement("div");
    badge.className = `badge ${p.status}`;
    badge.textContent = statusLabel(p.status);
    card.appendChild(img);
    card.appendChild(badge);
    grid.appendChild(card);
  });
  el("photoCount").textContent = selectedPhotos.length ? `(${selectedPhotos.length})` : "";
  refreshUploadEnabled();
}

function statusLabel(status) {
  switch (status) {
    case "pending": return "Ready";
    case "uploading": return "Uploading…";
    case "done": return "Uploaded";
    case "error": return "Failed";
    default: return status;
  }
}

function refreshUploadEnabled() {
  const hasPending = selectedPhotos.some((p) => p.status === "pending" || p.status === "error");
  el("uploadAllBtn").disabled = !hasPending;
  el("clearBtn").disabled = selectedPhotos.length === 0;
}

async function handleFilesSelected(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  for (const file of files) {
    const { img, url } = await loadImageFromFile(file);
    selectedPhotos.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      imgEl: img,
      thumbUrl: url,
      status: "pending",
    });
  }
  renderPhotoGrid();
  updatePreview();
}

async function uploadAll() {
  el("uploadAllBtn").disabled = true;
  try {
    const folderId = await getTargetFolderId();
    for (const photo of selectedPhotos) {
      if (photo.status === "done") continue;
      photo.status = "uploading";
      renderPhotoGrid();
      try {
        const canvas = await renderWatermarkedCanvas(photo.imgEl);
        const blob = await canvasToBlob(canvas, settings.outputFormat, settings.outputQuality);
        const ext = settings.outputFormat === "image/png" ? "png" : "jpg";
        const baseName = photo.file.name.replace(/\.[^.]+$/, "");
        const filename = `${baseName}-watermarked.${ext}`;
        const result = await uploadFileToDrive(blob, filename, folderId);
        photo.status = "done";
        log(`Uploaded "${result.name}"`, "success");
      } catch (err) {
        photo.status = "error";
        log(`Failed to upload "${photo.file.name}": ${err.message}`, "error");
      }
      renderPhotoGrid();
    }
  } catch (err) {
    log(`Could not resolve destination folder: ${err.message}`, "error");
  }
  refreshUploadEnabled();
}

/* ---------------- Settings UI ---------------- */

function populateSettingsForm() {
  el("clientIdInput").value = settings.clientId;
  el("useExistingFolderChk").checked = settings.useExistingFolder;
  el("existingFolderInput").value = settings.existingFolderId;
  el("ownedFolderNameInput").value = settings.ownedFolderName;
  el("logoEnabledChk").checked = settings.logoEnabled;
  el("logoPositionSelect").value = settings.logoPosition;
  el("logoScaleInput").value = settings.logoScalePct;
  el("logoOpacityInput").value = settings.logoOpacityPct;
  el("logoMarginInput").value = settings.logoMarginPx;
  el("textEnabledChk").checked = settings.textEnabled;
  el("textContentInput").value = settings.textContent;
  el("textPositionSelect").value = settings.textPosition;
  el("textScaleInput").value = settings.textScalePct;
  el("textOpacityInput").value = settings.textOpacityPct;
  el("textColorInput").value = settings.textColor;
  el("textMarginInput").value = settings.textMarginPx;
  el("outputFormatSelect").value = settings.outputFormat;
  el("outputQualityInput").value = settings.outputQuality;
  toggleFolderRows();
  updateRangeLabels();
  el("folderStatus").textContent = settings.ownedFolderId
    ? `Using folder ID: ${settings.ownedFolderId}`
    : "";
}

function updateRangeLabels() {
  el("logoScaleValue").textContent = `${el("logoScaleInput").value}%`;
  el("logoOpacityValue").textContent = `${el("logoOpacityInput").value}%`;
  el("textScaleValue").textContent = `${el("textScaleInput").value}%`;
  el("textOpacityValue").textContent = `${el("textOpacityInput").value}%`;
  el("outputQualityValue").textContent = `${el("outputQualityInput").value}%`;
}

function toggleFolderRows() {
  const useExisting = el("useExistingFolderChk").checked;
  el("existingFolderRow").classList.toggle("hidden", !useExisting);
  el("ownedFolderRow").classList.toggle("hidden", useExisting);
}

function readSettingsFromForm() {
  settings.clientId = el("clientIdInput").value.trim() || DEFAULT_CLIENT_ID;
  settings.useExistingFolder = el("useExistingFolderChk").checked;
  settings.existingFolderId = extractFolderId(el("existingFolderInput").value || "");
  settings.ownedFolderName = el("ownedFolderNameInput").value.trim() || defaultSettings.ownedFolderName;
  settings.logoEnabled = el("logoEnabledChk").checked;
  settings.logoPosition = el("logoPositionSelect").value;
  settings.logoScalePct = Number(el("logoScaleInput").value);
  settings.logoOpacityPct = Number(el("logoOpacityInput").value);
  settings.logoMarginPx = Number(el("logoMarginInput").value);
  settings.textEnabled = el("textEnabledChk").checked;
  settings.textContent = el("textContentInput").value;
  settings.textPosition = el("textPositionSelect").value;
  settings.textScalePct = Number(el("textScaleInput").value);
  settings.textOpacityPct = Number(el("textOpacityInput").value);
  settings.textColor = el("textColorInput").value;
  settings.textMarginPx = Number(el("textMarginInput").value);
  settings.outputFormat = el("outputFormatSelect").value;
  settings.outputQuality = Number(el("outputQualityInput").value);
}

function openSettings() {
  populateSettingsForm();
  el("settingsModal").classList.remove("hidden");
}

function closeSettings() {
  el("settingsModal").classList.add("hidden");
}

/* ---------------- Wiring ---------------- */

function wireEvents() {
  el("signInBtn").addEventListener("click", async () => {
    try {
      await getAccessToken({ interactive: true });
      log("Signed in to Google.");
    } catch (e) {
      log(`Sign-in failed: ${e.message}`, "error");
    }
  });

  el("settingsBtn").addEventListener("click", openSettings);
  el("closeSettingsBtn").addEventListener("click", closeSettings);

  el("useExistingFolderChk").addEventListener("change", toggleFolderRows);

  [
    "logoScaleInput", "logoOpacityInput", "textScaleInput", "textOpacityInput", "outputQualityInput",
  ].forEach((id) => el(id).addEventListener("input", updateRangeLabels));

  el("createFolderBtn").addEventListener("click", async () => {
    readSettingsFromForm();
    saveSettings();
    el("folderStatus").textContent = "Working…";
    try {
      settings.ownedFolderId = ""; // force fresh lookup/create with current name
      const id = await ensureOwnedFolder();
      el("folderStatus").textContent = `Using folder ID: ${id}`;
      log(`Drive folder ready: ${settings.ownedFolderName} (${id})`);
    } catch (e) {
      el("folderStatus").textContent = `Error: ${e.message}`;
      log(`Folder setup failed: ${e.message}`, "error");
    }
  });

  el("logoFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      settings.logoDataUrl = reader.result;
      saveSettings();
      updatePreview();
      log("Logo image updated.");
    };
    reader.readAsDataURL(file);
  });

  el("saveSettingsBtn").addEventListener("click", () => {
    readSettingsFromForm();
    saveSettings();
    ensureTokenClient();
    closeSettings();
    updatePreview();
    updateFolderHint();
    log("Settings saved.");
  });

  el("photoInput").addEventListener("change", (e) => handleFilesSelected(e.target.files));
  el("uploadAllBtn").addEventListener("click", uploadAll);
  el("clearBtn").addEventListener("click", () => {
    selectedPhotos.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
    selectedPhotos = [];
    renderPhotoGrid();
    const ctx = el("previewCanvas").getContext("2d");
    ctx.clearRect(0, 0, el("previewCanvas").width, el("previewCanvas").height);
  });
}

function updateFolderHint() {
  el("folderHint").textContent = settings.useExistingFolder
    ? (settings.existingFolderId
        ? `Uploading into existing folder: ${settings.existingFolderId}`
        : "Set an existing folder ID in Settings before uploading.")
    : `Uploading into app folder "${settings.ownedFolderName}" (created automatically on first upload).`;
}

function init() {
  wireEvents();
  ensureTokenClient();
  updateFolderHint();
}

window.addEventListener("load", () => {
  // google script loads async; poll briefly until available
  const tryInit = () => {
    if (window.google && google.accounts && google.accounts.oauth2) {
      init();
    } else {
      setTimeout(tryInit, 100);
    }
  };
  tryInit();
});
