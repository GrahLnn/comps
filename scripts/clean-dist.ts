import { rm } from "node:fs/promises";

/**
 * Build output must be recreated from source on every publish so removed
 * modules do not leave stale declarations in the package tarball.
 */
await rm(new URL("../dist", import.meta.url), {
  force: true,
  recursive: true,
});
