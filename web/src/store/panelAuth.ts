// Reuse the official CPA management panel's saved management key when this
// web UI is loaded as a same-origin iframe inside that panel.
//
// The panel stores its auth state (apiBase +, only when "remember password"
// is checked, managementKey) in localStorage under key "cli-proxy-auth", run
// through a reversible XOR+base64 obfuscation (see the panel's
// src/utils/encryption.ts). Because the panel and this plugin resource are
// same-origin (both served by CPA), they share the SAME localStorage and the
// SAME obfuscation key (host + userAgent are identical), so we can decode the
// panel's stored blob here and skip a second login.
//
// SECURITY: This only reads the panel's already-persisted key; it never writes
// the key to storage itself. The plugin's own "key in memory only" rule stands.
// Cross-origin iframes have a separate localStorage that does not contain
// "cli-proxy-auth", so a malicious site embedding this plugin cannot read the
// panel key. We additionally gate on window.self !== window.top (embedded only).

const ENC_PREFIX_V1 = "enc::v1::";
const ENC_PREFIX_V2 = "enc::v2::";
const SECRET_SALT = "cli-proxy-api-webui::secure-storage";
const STORAGE_KEY = "cli-proxy-auth";

export interface PanelAuth {
  apiBase: string;
  managementKey: string;
}

type StorageVersion = "v1" | "v2";
const cachedKeyBytes: Partial<Record<StorageVersion, Uint8Array>> = {};

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function getKeyBytes(version: StorageVersion): Uint8Array {
  return (cachedKeyBytes[version] ??= encodeText(version === "v2"
    ? `${SECRET_SALT}|v2|${window.location.host}`
    : `${SECRET_SALT}|${window.location.host}|${navigator.userAgent}`));
}

// Exposed for tests: clear the cached key so a changed host/userAgent is used.
export function _resetKeyCache(): void {
  delete cachedKeyBytes.v1;
  delete cachedKeyBytes.v2;
}

function xorBytes(data: Uint8Array, keyBytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ keyBytes[i % keyBytes.length];
  }
  return result;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Reversible obfuscation, identical to the panel's obfuscateData().
export function obfuscateData(value: string): string {
  if (!value) return value;
  try {
    return `${ENC_PREFIX_V2}${toBase64(xorBytes(encodeText(value), getKeyBytes("v2")))}`;
  } catch {
    return value;
  }
}

// Deobfuscation, identical to the panel's deobfuscateData().
export function deobfuscateData(payload: string): string {
  const version = payload.startsWith(ENC_PREFIX_V2) ? "v2"
    : payload.startsWith(ENC_PREFIX_V1) ? "v1"
    : null;
  if (!version) return payload;
  try {
    const prefix = version === "v2" ? ENC_PREFIX_V2 : ENC_PREFIX_V1;
    const encrypted = fromBase64(payload.slice(prefix.length));
    return decodeText(xorBytes(encrypted, getKeyBytes(version)));
  } catch {
    return payload;
  }
}

// True when this page is running inside an iframe (the panel embeds us here).
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access to window.top throws → treat as not-embedded/safe.
    return false;
  }
}

// The panel's zustand persist envelope: { state: {...}, version: number }.
// managementKey is present only when the user checked "remember password".
function extractAuth(parsed: unknown): PanelAuth | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  // The persisted shape is { state, version }; fall back to the object itself
  // in case the envelope is absent (older/different storage layouts).
  const state =
    (root.state as Record<string, unknown> | undefined) ?? (root as Record<string, unknown>);
  const savedBase = state.sessionMode === "manager_embedded" && state.sessionPanelBase
    ? state.sessionPanelBase
    : state.apiBase;
  const managementKey = typeof state.managementKey === "string" ? state.managementKey : "";
  if (typeof savedBase !== "string" || !managementKey) return null;
  const base = new URL(savedBase);
  // A remembered key belongs to the panel serving this iframe.
  if (base.origin !== window.location.origin || base.username || base.password) return null;
  return { apiBase: savedBase, managementKey };
}

// Read the panel's saved auth from shared same-origin localStorage.
// Returns null when: not embedded, no stored value, decode failure, or the
// user did not choose "remember password" (no managementKey persisted).
export function readPanelAuth(): PanelAuth | null {
  if (!isEmbedded()) return null;
  let raw: string | null;
  try {
    if (window.top?.location.origin !== window.location.origin) return null;
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = deobfuscateData(raw);
  } catch {
    return null;
  }
  try {
    return extractAuth(JSON.parse(decoded));
  } catch {
    return null;
  }
}
