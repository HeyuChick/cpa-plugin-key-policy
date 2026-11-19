import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKey, listKeys, patchKey } from "../api/keys";
import { fetchCatalog } from "../api/models";
import type { KeyPublic } from "../types";
import KeyEdit from "./KeyEdit";
import KeyNew from "./KeyNew";
import ModelPick from "./ModelPick";

vi.mock("../api/keys", () => ({ createKey: vi.fn(), listKeys: vi.fn(), patchKey: vi.fn() }));
vi.mock("../api/models", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/models")>(),
  fetchCatalog: vi.fn(),
}));
vi.mock("../api/mappings", () => ({ fetchAliases: vi.fn().mockResolvedValue([]) }));
vi.mock("../store/modelPrices", () => ({
  getPriceTable: vi.fn().mockResolvedValue(null),
  lookupPrice: vi.fn(),
}));
vi.mock("../i18n", () => ({
  useT: () => (key: string) => key,
}));

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

function TestNavigation() {
  const navigate = useNavigate();
  return (
    <>
      <button data-test="browser-back" onClick={() => navigate(-1)}>Back</button>
      <button data-test="edit" onClick={() => navigate("/keys/beta-key/edit")}>Edit</button>
    </>
  );
}

const existingKey: KeyPublic = {
  id: "beta-key",
  name: "Saved name",
  enabled: true,
  key_preview: "",
  rpm: 0,
  models: [{
    alias: "my-gemini",
    provider: "gemini",
    target_model: "gemini-4-hydrogen",
    input_price_per_million: 0.25,
  }],
  daily_limit_usd: 0,
  weekly_limit_usd: 0,
  usage: { daily_usd: 0, weekly_usd: 0, daily_limit_usd: 0, weekly_limit_usd: 0 },
};

describe("key model picker navigation", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.mocked(createKey).mockResolvedValue({ key: existingKey, plain_key: "", generated: true });
    vi.mocked(listKeys).mockResolvedValue([existingKey]);
    vi.mocked(patchKey).mockResolvedValue(existingKey);
    vi.mocked(fetchCatalog).mockResolvedValue([
      { model: "gemini-4-hydrogen", provider: "gemini" },
      { model: "gemini-3-flash", provider: "gemini" },
    ]);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(
      <MemoryRouter initialEntries={["/keys/new"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <TestNavigation />
        <Routes>
          <Route path="/keys/new" element={<KeyNew />} />
          <Route path="/keys/new/models" element={<ModelPick />} />
          <Route path="/keys/:id/edit" element={<KeyEdit />} />
          <Route path="/keys/:id/edit/models" element={<ModelPick />} />
          <Route path="/keys" element={<div />} />
        </Routes>
      </MemoryRouter>,
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function input(selector: string): HTMLInputElement {
    const element = container.querySelector<HTMLInputElement>(selector);
    if (!element) throw new Error(`No input matches ${selector}`);
    return element;
  }

  function enter(element: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function click(selector: string) {
    const button = container.querySelector<HTMLButtonElement>(selector);
    if (!button) throw new Error(`No button matches ${selector}`);
    await act(async () => button.click());
  }

  async function select(model: string) {
    const label = [...container.querySelectorAll<HTMLLabelElement>(".pg-models label")]
      .find((item) => item.textContent?.trim() === model);
    expect(label).toBeDefined();
    await act(async () => label!.querySelector("input")!.click());
  }

  const idInput = '.mobile-hidden input[placeholder="keyForm.idPlaceholder"]';
  const nameInput = '.mobile-hidden input[placeholder="keyForm.namePlaceholder"]';
  const add = ".mobile-hidden .mc-add";
  const done = ".mp-head .primary";

  it("retains form fields and pricing after picking models twice and submits them", async () => {
    enter(input(idInput), "beta-key");
    enter(input(nameInput), "Beta client");
    const numbers = () => container.querySelectorAll<HTMLInputElement>('.mobile-hidden input[type="number"]');
    enter(numbers()[0], "72");
    enter(numbers()[1], "4.5");
    enter(numbers()[2], "12");
    act(() => input('.mobile-hidden input[type="checkbox"]').click());
    act(() => input('label[title="keyForm.allowModelsTitle"] input').click());

    await click(add);
    await select("gemini-4-hydrogen");
    await click(done);
    expect(input(idInput).value).toBe("beta-key");
    expect(input(nameInput).value).toBe("Beta client");
    enter(input('tbody input[type="number"]'), "0.75");

    await click(add);
    await select("gemini-3-flash");
    await click(done);
    await click('button[type="submit"]');

    expect(createKey).toHaveBeenCalledWith(expect.objectContaining({
      id: "beta-key",
      name: "Beta client",
      rpm: 72,
      enabled: false,
      daily_limit_usd: 4.5,
      weekly_limit_usd: 12,
      allow_models_endpoint: true,
      models: [
        expect.objectContaining({ alias: "gemini-4-hydrogen", input_price_per_million: 0.75 }),
        expect.objectContaining({ alias: "gemini-3-flash", input_price_per_million: 0 }),
      ],
    }));
  });

  it("keeps the draft when leaving the picker without confirming", async () => {
    enter(input(idInput), "unsaved-id");
    enter(input(nameInput), "Unsaved name");
    await click(add);
    await select("gemini-4-hydrogen");
    await click(".mp-head button:first-child");
    expect(input(idInput).value).toBe("unsaved-id");
    expect(input(nameInput).value).toBe("Unsaved name");
    expect(container.querySelectorAll(".mc-chip")).toHaveLength(0);

    await click(add);
    await click('[data-test="browser-back"]');
    expect(input(idInput).value).toBe("unsaved-id");
  });

  it("keeps unsaved edits and the custom alias of a retained model", async () => {
    await click('[data-test="edit"]');
    enter(input(nameInput), "Edited name");
    await click(add);
    await select("gemini-3-flash");
    await click(done);
    await click('button[type="submit"]');

    expect(patchKey).toHaveBeenCalledWith(expect.objectContaining({
      id: "beta-key",
      name: "Edited name",
      models: [
        expect.objectContaining({ alias: "my-gemini", target_model: "gemini-4-hydrogen", input_price_per_million: 0.25 }),
        expect.objectContaining({ alias: "gemini-3-flash" }),
      ],
    }));
  });
});
