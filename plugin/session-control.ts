// Local convenience plugin: gives the agent an on-demand context control tool.
//
// `compact` asks OpenCode to summarize the conversation at the next safe step.
// `clear` creates a new empty session and leaves the current one untouched, so
// the user can switch to a clean context without losing the old transcript.

import { Plugin } from '@opencode/plugin';

type Ctx = Parameters<Parameters<typeof Plugin.define>[0]['setup']>[0];
type ToolEditor = Parameters<Parameters<Ctx['tool']['transform']>[0]>[0];

type SessionAction = 'compact' | 'clear';
interface ControlInput {
  action: SessionAction;
}

const INPUT = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['compact', 'clear'],
      description:
        'compact: summarize older conversation now. clear: create a new empty ' +
        'session for a clean context, keeping the current session.',
    },
  },
  required: ['action'],
  additionalProperties: false,
};

const DESCRIPTION = [
  'Request a context reset for this session.',
  'Use `compact` when the conversation is long but the work should continue.',
  'Use `clear` when the task is finished or the context is too polluted to continue;',
  'it creates a new empty session and keeps the current one intact.',
  'After `clear`, tell the user the new session ID and that they can switch with /sessions.',
].join(' ');

async function compact(ctx: Ctx, sessionID: string) {
  const accepted = await ctx.session.compact({ sessionID });
  return {
    content:
      'Compaction requested. OpenCode runs it at the next safe step boundary; ' +
      'this conversation will be replaced by a summary plus the most recent messages.',
    metadata: { sessionID, inboxID: accepted.id },
  };
}

async function clear(ctx: Ctx, sessionID: string) {
  const current = await ctx.session.get({ sessionID });
  const created = await ctx.session.create({
    title: `Fresh session from ${current.title ?? sessionID}`,
    agent: current.agent,
    model: current.model,
    location: { directory: current.location.directory },
  });
  return {
    content:
      `Created a new empty session ${created.id}. The current session (${sessionID}) is ` +
      'unchanged. Ask the user to switch to the new session (/sessions) to continue with a clean context.',
    metadata: { previousSessionID: sessionID, sessionID: created.id },
  };
}

function registerTool(ctx: Ctx): Promise<unknown> {
  return ctx.tool.transform((editor: ToolEditor) => {
    editor.add({
      name: 'session_control',
      description: DESCRIPTION,
      input: INPUT,
      execute: async (raw, context) => {
        const { action } = raw as ControlInput;
        if (action === 'compact') return compact(ctx, context.sessionID);
        if (action === 'clear') return clear(ctx, context.sessionID);
        throw new Error(`Unknown session action: ${String(action)}`);
      },
    });
  });
}

export default Plugin.define({
  id: 'session-control',
  async setup(ctx: Ctx) {
    await registerTool(ctx);
  },
});
