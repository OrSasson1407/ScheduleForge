import { Storage } from "happy-dom";

/**
 * Node's own built-in `localStorage` global (added in recent Node versions)
 * shadows happy-dom's implementation and is a non-functional stub without a
 * `--localstorage-file` flag: `setItem` is not even defined on it. Swap in
 * happy-dom's real Storage so code under test (and translate.ts, loaded by
 * nearly every engine module) can actually read and write it.
 */
if (typeof window.localStorage?.setItem !== "function") {
  Object.defineProperty(window, "localStorage", {
    value: new Storage(),
    configurable: true,
  });
}
