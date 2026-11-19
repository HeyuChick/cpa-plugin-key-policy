import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetKeyCache,
  obfuscateData,
  deobfuscateData,
  readPanelAuth,
  type PanelAuth,
} from "./panelAuth";

const STORAGE_KEY = "cli-proxy-auth";

// Build a panel-style persisted auth blob: zustand persist envelope
// {state, version} serialized to JSON, then obfuscated with the shared algo.
function storePanelAuth(auth: PanelAuth & { sessionMode?: string; sessionPanelBase?: string }): void {
  const envelope = JSON.stringify({
    state: {
      ...auth,
      rememberPassword: true,
    },
    version: 0,
  });
  localStorage.setItem(STORAGE_KEY, obfuscateData(envelope));
}

describe("panelAuth obfuscation", () => {
  it("round-trips through obfuscate/deobfuscate", () => {
    const original = JSON.stringify({ state: { apiBase: "http://h:1", managementKey: "k" } });
    const encoded = obfuscateData(original);
    expect(encoded).toMatch(/^enc::v2::/);
    expect(deobfuscateData(encoded)).toBe(original);
  });

  it("still reads the v1 format used by older panels", () => {
    const original = '{"state":{"managementKey":"old-secret"}}';
    const key = "cli-proxy-api-webui::secure-storage|" + window.location.host + "|" + navigator.userAgent;
    const encoded = btoa(Array.from(original, (char, i) =>
      String.fromCharCode(char.charCodeAt(0) ^ key.charCodeAt(i % key.length)),
    ).join(""));
    expect(deobfuscateData("enc::v1::" + encoded)).toBe(original);
  });
});

describe("readPanelAuth", () => {
  const realSelf = window.self;
  const realTop = window.top;

  beforeEach(() => {
    localStorage.clear();
    _resetKeyCache();
  });

  afterEach(() => {
    localStorage.clear();
    _resetKeyCache();
    // Restore embedded state.
    Object.defineProperty(window, "self", { value: realSelf, configurable: true });
    Object.defineProperty(window, "top", { value: realTop, configurable: true });
  });

  function setEmbedded(embedded: boolean) {
    // window.self !== window.top → embedded
    Object.defineProperty(window, "self", { value: window, configurable: true });
    Object.defineProperty(window, "top", {
      value: embedded ? { location: window.location } : window,
      configurable: true,
    });
  }

  it("returns null when not embedded (direct page open)", () => {
    setEmbedded(false);
    storePanelAuth({ apiBase: window.location.origin, managementKey: "secret-xyz" });
    expect(readPanelAuth()).toBeNull();
  });

  it("reads apiBase + managementKey when embedded and remember-password was set", () => {
    setEmbedded(true);
    storePanelAuth({ apiBase: window.location.origin, managementKey: "secret-xyz" });
    expect(readPanelAuth()).toEqual({
      apiBase: window.location.origin,
      managementKey: "secret-xyz",
    });
  });

  it("uses the Manager Server panel base in an embedded session", () => {
    setEmbedded(true);
    storePanelAuth({
      apiBase: "https://api.example.com",
      sessionMode: "manager_embedded",
      sessionPanelBase: window.location.origin,
      managementKey: "manager-key",
    });
    expect(readPanelAuth()).toEqual({
      apiBase: window.location.origin,
      managementKey: "manager-key",
    });
  });

  it("leaves a different API origin for manual login", () => {
    setEmbedded(true);
    storePanelAuth({ apiBase: "https://api.example.com", managementKey: "api-key" });
    expect(readPanelAuth()).toBeNull();
  });

  it("does not restore panel auth when embedded by a different origin", () => {
    Object.defineProperty(window, "top", {
      value: { location: { origin: "https://other.example.com" } },
      configurable: true,
    });
    storePanelAuth({ apiBase: window.location.origin, managementKey: "secret-xyz" });
    expect(readPanelAuth()).toBeNull();
  });

  it("returns null when managementKey is empty (remember password unchecked)", () => {
    setEmbedded(true);
    const envelope = JSON.stringify({
      state: { apiBase: "http://h:1", managementKey: "", rememberPassword: false },
      version: 0,
    });
    localStorage.setItem(STORAGE_KEY, obfuscateData(envelope));
    expect(readPanelAuth()).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    setEmbedded(true);
    expect(readPanelAuth()).toBeNull();
  });

  it("returns null when the stored value is garbage", () => {
    setEmbedded(true);
    localStorage.setItem(STORAGE_KEY, "not-valid-json-or-obfuscated");
    expect(readPanelAuth()).toBeNull();
  });
});
