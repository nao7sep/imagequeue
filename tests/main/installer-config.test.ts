import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const builderConfig = readFileSync(
  new URL("../../electron-builder.yml", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

describe("Windows installer configuration", () => {
  it("uses the assisted multi-user installer", () => {
    for (const setting of [
      "oneClick: false",
      "perMachine: false",
      "allowElevation: true",
      "createDesktopShortcut: true",
      "createStartMenuShortcut: true",
      "runAfterFinish: true",
    ]) {
      expect(builderConfig).toContain(`  ${setting}`);
    }
  });
});

describe("packaged license texts", () => {
  it("ships the app, Electron, and Chromium licenses", () => {
    for (const line of [
      "  - from: LICENSE",
      "    to: LICENSE.txt",
      "  - from: node_modules/electron/dist/LICENSE",
      "    to: electron/LICENSE",
      "  - from: node_modules/electron/dist/LICENSES.chromium.html",
      "    to: electron/LICENSES.chromium.html",
    ]) {
      expect(builderConfig).toContain(line);
    }
  });

  it("prepares Electron before every package-script builder invocation", () => {
    for (const script of Object.values(packageJson.scripts) as string[]) {
      if (script.includes("electron-builder")) {
        expect(script.indexOf("npm run prepare:electron")).toBeLessThan(
          script.indexOf("electron-builder"),
        );
      }
    }
  });
});

describe("node-pty package shape", () => {
  it("unpacks only runtime prebuilds and excludes development material", () => {
    expect(builderConfig).toContain("- '**/node_modules/node-pty/prebuilds/**'");
    expect(builderConfig).not.toContain("- '**/node_modules/node-pty/**'");

    for (const exclusion of [
      "!**/node_modules/node-pty/binding.gyp",
      "!**/node_modules/node-pty/{deps,scripts,src,third_party,typings}/**",
      "!**/node_modules/node-pty/lib/**/*.test.js",
    ]) {
      expect(builderConfig).toContain(`  - '${exclusion}'`);
    }
  });
});

describe("packaged development metadata", () => {
  it("excludes source maps and TypeScript declarations", () => {
    for (const exclusion of ["!**/*.map", "!**/*.d.ts", "!**/*.d.mts", "!**/*.d.cts"]) {
      expect(builderConfig).toContain(`  - '${exclusion}'`);
    }
  });
});
