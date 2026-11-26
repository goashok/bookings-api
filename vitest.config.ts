import { defineConfig } from 'vitest/config';

// Sandboxes and CI runners can be much slower than a laptop; a test that is merely slow there
// should not fail.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 20_000 } });
