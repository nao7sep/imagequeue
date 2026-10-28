import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../../src/shared/i18n/languages";
import { APP_AUTHOR, APP_COPYRIGHT_YEAR, APP_NAME, APP_REPOSITORY_URL } from "../../src/shared/app-identity";

// Packaging repeats values whose source lives elsewhere: the interface
// languages and the app identity. Each is checked against that source here
// (app-release-conventions: one source per repeated value).

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const builderConfig = read("../../electron-builder.yml");
const packageJson = JSON.parse(read("../../package.json")) as {
  author: { name: string }; license: string; repository: { url: string }
};

/** One top-level block of electron-builder.yml, from its key to the next top-level key. */
function section(key: string): string {
  const match = builderConfig.match(new RegExp(`^${key}:\\n((?:[ #\\n].*\\n?)*)`, "m"));
  return match ? match[1] : "";
}

/** The items of a YAML list nested under `key` inside a block. */
function listUnder(block: string, key: string): string[] {
  const match = block.match(new RegExp(`^(\\s*)${key}:\\n((?:\\1\\s+- .*\\n?)*)`, "m"));
  return match ? [...match[2].matchAll(/- (\S+)/g)].map((item) => item[1]) : [];
}

const primarySubtag = (tag: string): string => tag.split(/[-_]/)[0]!.toLowerCase();

describe("packaged identity", () => {
  it("packages the app under the name, author, copyright and repository it shows", () => {
    expect(/^productName: (.+)$/m.exec(builderConfig)?.[1]).toBe(APP_NAME);
    expect(/^copyright: (.+)$/m.exec(builderConfig)?.[1]).toBe(`Copyright © ${APP_COPYRIGHT_YEAR} ${APP_AUTHOR}`);
    expect(packageJson.author.name).toBe(APP_AUTHOR);
    expect(packageJson.repository.url).toBe(APP_REPOSITORY_URL);
  });

  // About says "GNU GPL v3 or later"; the package declares the same licence.
  it("declares the licence About names", () => {
    expect(packageJson.license).toBe("GPL-3.0-or-later");
  });
});

describe("packaged interface languages", () => {
  it("lists exactly the app's languages for AppKit, in the app's order", () => {
    expect(listUnder(section("mac"), "CFBundleLocalizations")).toEqual([...LANGUAGES]);
  });

  it("offers an installer language for each app language, in the app's order", () => {
    expect(listUnder(section("nsis"), "installerLanguages").map(primarySubtag)).toEqual(LANGUAGES.map(primarySubtag));
  });
});
