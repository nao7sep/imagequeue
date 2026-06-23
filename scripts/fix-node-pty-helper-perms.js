const fs = require("node:fs");
const path = require("node:path");

// node-pty spawns ptys through a `spawn-helper` executable (the Draw Things import
// jobs use a pty). A copied or re-extracted node_modules can land it without its
// exec bit, and node-pty then fails at runtime with an opaque EACCES. node-pty
// resolves the helper from whichever of build/Release, build/Debug, or
// prebuilds/<platform>-<arch>/ won the install — so chmod every spawn-helper it
// ships rather than guessing the active one. Scanning the package tree (not a
// hard-coded subdir) is what keeps this correct across node-pty layout changes.
// macOS only — Windows uses conpty/winpty and has no spawn-helper.
if (process.platform !== "darwin") process.exit(0);

const ptyDir = path.join(__dirname, "..", "node_modules", "node-pty");
if (!fs.existsSync(ptyDir)) process.exit(0); // node-pty not installed

const helpers = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walk(path.join(dir, entry.name));
    } else if (entry.name === "spawn-helper") {
      helpers.push(path.join(dir, entry.name));
    }
  }
})(ptyDir);

if (helpers.length === 0) {
  // node-pty is present but ships no spawn-helper anywhere we looked — its layout
  // has changed enough that this guard no longer finds the file. Warn rather than
  // let pty spawns fail with an opaque EACCES at runtime.
  console.warn("[fix-node-pty-helper-perms] node-pty present but no spawn-helper found; this guard may need revisiting.");
  process.exit(0);
}

for (const helper of helpers) {
  const { mode } = fs.statSync(helper);
  const withExec = mode | 0o111;
  if (withExec !== mode) fs.chmodSync(helper, withExec);
}
