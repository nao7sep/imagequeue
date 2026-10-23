import { describe, expect, it } from "vitest";
import { loadCatalogue, type Catalogue, type MessageKey } from "../../src/shared/i18n/catalogues";
import { createTranslator, isMessage, loadTranslator, message } from "../../src/shared/i18n/translate";

describe("createTranslator", () => {
  it("fills placeholders and formats numbers for the locale", async () => {
    expect((await loadTranslator("en")).t("about.version", { version: "1.2.0" })).toBe("Version 1.2.0");
    expect((await loadTranslator("en", "en-US")).t("dependencies.entries", { count: 12345 })).toBe("12,345 entries");
    expect((await loadTranslator("de")).t("dependencies.entries", { count: 12345 })).toContain("12.345");
  });

  it("chooses the plural form by the language's own rules", async () => {
    const en = await loadTranslator("en");
    expect(en.t("dependencies.entries", { count: 1 })).toBe("1 entry");
    expect(en.t("dependencies.entries", { count: 0 })).toBe("0 entries");
    const ru = await loadTranslator("ru");
    expect(ru.t("dependencies.entries", { count: 1 })).not.toBe(ru.t("dependencies.entries", { count: 3 }));
    expect(ru.t("dependencies.entries", { count: 3 })).not.toBe(ru.t("dependencies.entries", { count: 5 }));
    expect(ru.t("dependencies.entries", { count: 21 })).toBe(ru.t("dependencies.entries", { count: 1 }).replace("1", "21"));
  });

  it("renders a message placed inside another in the same language", async () => {
    const en = await loadTranslator("en");
    const nested = message("statusIcon.join", { first: message("statusIcon.paused"), rest: message("statusIcon.queued", { count: 2 }) });
    expect(en.text(nested)).toBe("paused · 2 queued");
  });

  it("splits an entry around its placeholders for markup", async () => {
    expect((await loadTranslator("en")).parts("about.version")).toEqual(["Version ", "version", ""]);
  });

  it("formats an instant for the locale and shows stored text that is not one as it is", async () => {
    expect((await loadTranslator("en", "en-US")).dateTime("2026-06-04T09:30:15.000Z")).toMatch(/2026/);
    expect((await loadTranslator("de")).dateTime(new Date(Date.UTC(2026, 5, 4, 12)))).toMatch(/2026/);
    expect((await loadTranslator("ja")).dateTime("not a date")).toBe("not a date");
  });

  it("reads a key the catalogue lacks in English, by English plural rules", async () => {
    const partial: Record<string, unknown> = { ...(await loadCatalogue("ru")) };
    delete partial["about.version"];
    delete partial["dependencies.entries"];
    const ru = createTranslator("ru", partial as Catalogue);
    expect(ru.t("about.version", { version: "1.2.0" })).toBe("Version 1.2.0");
    expect(ru.t("dependencies.entries", { count: 21 })).toBe("21 entries");
  });

  it("shows a key English lacks too instead of failing the render", async () => {
    // Types keep this out of the app; a stale build or a half-merged catalogue
    // could still reach it, and a window must not go down over one string.
    const missing = "gone.missing" as unknown as MessageKey;
    expect((await loadTranslator("ja")).t(missing)).toBe("gone.missing");
  });
});

describe("isMessage", () => {
  it.each([null, [], { key: 2 }, { key: "x", values: null }, { key: "x", values: [] },
    ...[null, true, undefined, [], {}, NaN, Infinity].map(value => ({ key: "x", values: { value } })),
    { key: "x", values: { nested: { key: "y", values: { bad: false } } } },
  ])("rejects invalid message values: %j", value => {
    expect(isMessage(value)).toBe(false);
  });

  it("accepts unknown keys and shared nested messages", async () => {
    const nested = { key: "unknown.key", values: { count: 2, text: "ok" } };
    expect(isMessage({ key: "x", values: { first: nested, second: nested } })).toBe(true);
    expect(isMessage(nested)).toBe(true);
    expect((await loadTranslator("en")).text(nested as ReturnType<typeof message>)).toBe("unknown.key");
  });

  it("rejects cycles without imposing a depth limit", () => {
    const cyclic: { key: string; values?: Record<string, unknown> } = { key: "x" };
    cyclic.values = { self: cyclic };
    expect(isMessage(cyclic)).toBe(false);
    let nested: unknown = { key: "leaf" };
    for (let index = 0; index < 20_000; index++) nested = { key: "x", values: { nested } };
    expect(isMessage(nested)).toBe(true);
  });
});
