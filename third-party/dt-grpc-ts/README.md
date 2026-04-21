# Third-party code: dt-grpc-ts

These files are **not written by us**. They are copied or adapted from an external
open-source project. Do not treat them as application source and do not edit them.

## Origin

Repository: https://github.com/kcjerrell/dt-grpc-ts  
Commit: 60c843d1d3bb0b3993c987d3826c2755d15c1aae  
License: MIT (declared in package.json; no LICENSE file in the repository)

## What is here

- `generated/` — TypeScript FlatBuffer stubs auto-generated from the Draw Things
  configuration schema (`config.fbs`). Copied verbatim from `src/generated/data/`
  in the source repo.
- `flatbuf-config.ts` — Adapted from `src/config.ts`. Builds the
  `GenerationConfigurationT` FlatBuffer object that encodes generation parameters
  for the Draw Things gRPC API.
- `type-converters.ts` — Adapted from `src/typeConverters.ts`. Maps sampler and
  seed-mode name strings to the integer values expected by the FlatBuffer schema.

## Why copied instead of installed as a dependency

`dt-grpc-ts` is not published to npm — it is a GitHub-only repository. It also
depends on `sharp`, a native Node.js addon that requires recompilation against the
Electron ABI (`@electron/rebuild`), which adds build complexity. Since we only need
the FlatBuffer encoding layer (not image I/O), copying the relevant files avoids the
native module entirely. Image decoding is handled separately in
`src/main/dt-grpc/image-decoder.ts` using `pngjs` (pure JS).

## Updating

If the Draw Things gRPC protocol changes, re-copy the relevant files from the
upstream repository at the commit above (or a newer one) and update this README.
