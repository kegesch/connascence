// Coupling sensor — opencode plugin (PLAN.md §8, M0).
//
// Wires the archived engine (git tag archive/pre-restart-2026-10-13) into the
// agent loop as-is: a session baseline at first model call, a crude session
// diff after each turn, a crude advisory payload, and coupling_scan /
// coupling_health tools. No engine code changes; M0's falsifiable question —
// do agents act on the signal? — is answered with real sessions, and the
// observation log under .coupling/ is the evidence.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Plugin } from '@opencode/plugin';
import { parseOptions } from './options.js';
import { createLoop } from './loop.js';

type Ctx = Parameters<Parameters<typeof Plugin.define>[0]['setup']>[0];

export default Plugin.define({
  id: 'coupling-sensor',
  async setup(ctx: Ctx) {
    const opts = parseOptions(ctx.options as Record<string, unknown> | undefined);
    const engineEntry = opts.engineEntry ?? fileURLToPath(new URL('../dist/cli.js', import.meta.url));
    if (!existsSync(engineEntry)) {
      console.error(
        `[coupling-sensor] engine CLI not found at ${engineEntry} — run \`npm run build\` ` +
          'in the connascence repo first. Plugin disabled.',
      );
      return;
    }
    const loop = createLoop(ctx, {
      ...opts,
      engineEntry,
      cwd: ctx.location.directory,
      logDirAbs: path.resolve(ctx.location.directory, opts.logDir),
    });
    await loop.registerTools();
    await loop.registerContextHook();
    loop.start();
    return loop.cleanup;
  },
});
