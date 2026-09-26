import { describe, expect, it } from "vitest";
import type { MessageKey } from "../../src/shared/i18n/catalogues";
import { createTranslator, message } from "../../src/shared/i18n/translate";

describe("createTranslator", () => {
  it("fills placeholders and formats numbers for the locale", () => {
    expect(createTranslator("en").t("about.version", { version: "1.2.0" })).toBe("Version 1.2.0");
    expect(createTranslator("en", "en-US").t("dependencies.entries", { count: 12345 })).toBe("12,345 entries");
    expect(createTranslator("de").t("dependencies.entries", { count: 12345 })).toContain("12.345");
  });

  it("chooses the plural form by the language's own rules", () => {
    const en = createTranslator("en");
    expect(en.t("dependencies.entries", { count: 1 })).toBe("1 entry");
    expect(en.t("dependencies.entries", { count: 0 })).toBe("0 entries");
    const ru = createTranslator("ru");
    expect(ru.t("dependencies.entries", { count: 1 })).not.toBe(ru.t("dependencies.entries", { count: 3 }));
    expect(ru.t("dependencies.entries", { count: 3 })).not.toBe(ru.t("dependencies.entries", { count: 5 }));
    expect(ru.t("dependencies.entries", { count: 21 })).toBe(ru.t("dependencies.entries", { count: 1 }).replace("1", "21"));
  });

  it("renders a message placed inside another in the same language", () => {
    const en = createTranslator("en");
    const nested = message("statusIcon.join", { first: message("statusIcon.paused"), rest: message("statusIcon.queued", { count: 2 }) });
    expect(en.text(nested)).toBe("paused · 2 queued");
  });

  it("splits an entry around its placeholders for markup", () => {
    expect(createTranslator("en").parts("about.version")).toEqual(["Version ", "version", ""]);
  });

  it("formats an instant for the locale and shows stored text that is not one as it is", () => {
    expect(createTranslator("en", "en-US").dateTime("2026-06-04T09:30:15.000Z")).toMatch(/2026/);
    expect(createTranslator("de").dateTime(new Date(Date.UTC(2026, 5, 4, 12)))).toMatch(/2026/);
    expect(createTranslator("ja").dateTime("not a date")).toBe("not a date");
  });

  it("shows a key the catalogue lacks instead of failing the render", () => {
    // Types keep this out of the app; a stale build or a half-merged catalogue
    // could still reach it, and a window must not go down over one string.
    const missing = "gone.missing" as unknown as MessageKey;
    expect(createTranslator("ja").t(missing)).toBe("gone.missing");
  });
});
