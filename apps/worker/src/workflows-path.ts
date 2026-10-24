import { fileURLToPath } from 'node:url';

/** The workflows package entry point, bundled by Temporal's webpack bundler. */
export const workflowsPath = fileURLToPath(import.meta.resolve('@whataracket/workflows'));

/** Pre-built bundle, written by `pnpm build` (src/bundle.ts). */
export const workflowBundlePath = fileURLToPath(new URL('./workflow-bundle.js', import.meta.url));
