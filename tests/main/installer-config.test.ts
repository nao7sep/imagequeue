import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const builderConfig = readFileSync(
  new URL("../../electron-builder.yml", import.meta.url),
  "utf8",
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
