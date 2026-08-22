import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const releaseWorkflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

describe("release workflow", () => {
  it("passes the untrusted tag to the shell as environment data", () => {
    expect(releaseWorkflow).toContain("IMAGEQUEUE_RELEASE_TAG: ${{ github.ref_name }}");
    expect(releaseWorkflow).toContain(
      'run: npm run check:release-version -- "$IMAGEQUEUE_RELEASE_TAG"',
    );
    expect(releaseWorkflow).not.toMatch(/run:.*\$\{\{\s*github\.ref_name\s*\}\}/);
  });
});
