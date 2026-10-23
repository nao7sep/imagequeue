import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { readdir, rm } from "node:fs/promises";

// The helper derives ownership from os.tmpdir(), not HOME. Redirect that edge
// before importing it so tests cannot replace a running launcher's owner file.
const { ownershipDirectory } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { ownershipDirectory: await mkdtemp(join(tmpdir(), "imagequeue-launcher-test-")) };
});
vi.mock("node:os", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:os")>(),
  tmpdir: () => ownershipDirectory,
}));
afterAll(() => rm(ownershipDirectory, { recursive: true, force: true }));

// The launcher helper is plain ESM because both shell families execute it directly.
// @ts-expect-error The directly executed .mjs helper intentionally has no declaration file.
import { claimRuntime, isRuntimeOwner, ownsProcess, releaseRuntime, REPO_ROOT } from "../../scripts/launcher-runtime.mjs";

describe("launcher process identity", () => {
  const identity = { kind: "electron", label: "ImageQueue", executable: "ImageQueue" };

  it("owns only this repository's ImageQueue runtime", () => {
    expect(ownsProcess({
      pid: 10,
      parentPid: 1,
      executablePath: `${REPO_ROOT}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,
      commandLine: "",
    }, identity)).toBe(true);
    expect(ownsProcess({
      pid: 11,
      parentPid: 1,
      executablePath: `${REPO_ROOT}/dist/mac-arm64/ImageQueue.app/Contents/MacOS/ImageQueue`,
      commandLine: "",
    }, identity)).toBe(true);
    expect(ownsProcess({
      pid: 12,
      parentPid: 1,
      executablePath: `${REPO_ROOT}\\dist\\win-unpacked\\ImageQueue.exe`,
      commandLine: "",
    }, identity)).toBe(true);
    expect(ownsProcess({
      pid: 13,
      parentPid: 1,
      executablePath: "/another/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
      commandLine: "",
    }, identity)).toBe(false);
  });

  it("does not let a stale launcher generation clean up its replacement", async () => {
    const first = `first-${randomUUID()}`;
    const second = `second-${randomUUID()}`;
    try {
      await claimRuntime(first);
      expect(await readdir(ownershipDirectory)).toHaveLength(1);
      await claimRuntime(second);
      expect(await isRuntimeOwner(first)).toBe(false);
      expect(await isRuntimeOwner(second)).toBe(true);
    } finally {
      await releaseRuntime(second);
    }
    expect(await readdir(ownershipDirectory)).toEqual([]);
  });
});
