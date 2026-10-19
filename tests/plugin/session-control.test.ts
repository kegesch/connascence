import { describe, it, expect, vi } from 'vitest';
import plugin from '../../plugin/session-control.ts';

interface Tool {
  execute: (input: unknown, context: { sessionID: string }) => Promise<{
    content: string;
    metadata?: Record<string, unknown>;
  }>;
}

function harness() {
  const tools: Tool[] = [];
  const session = {
    compact: vi.fn().mockResolvedValue({ id: 'inb_compact' }),
    get: vi.fn().mockResolvedValue({
      id: 'ses_old',
      title: 'Refactor auth',
      agent: 'build',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4-5' },
      location: { directory: 'C:/work/project' },
    }),
    create: vi.fn().mockResolvedValue({ id: 'ses_new' }),
    remove: vi.fn(),
  };
  const ctx = {
    session,
    tool: {
      transform: async (callback: (editor: { add: (tool: Tool) => void }) => void) => {
        callback({ add: (tool) => tools.push(tool) });
      },
    },
  };
  return { ctx, tools, session };
}

async function setup() {
  const h = harness();
  await plugin.setup(h.ctx as never);
  return h;
}

describe('session_control', () => {
  it('compact requests compaction for the calling session', async () => {
    const { tools, session } = await setup();
    const result = await tools[0]!.execute({ action: 'compact' }, { sessionID: 'ses_old' });

    expect(session.compact).toHaveBeenCalledWith({ sessionID: 'ses_old' });
    expect(result.metadata?.inboxID).toBe('inb_compact');
  });

  it('clear creates a new session and keeps the old one', async () => {
    const { tools, session } = await setup();
    const result = await tools[0]!.execute({ action: 'clear' }, { sessionID: 'ses_old' });

    expect(session.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Fresh session from Refactor auth' }),
    );
    expect(session.remove).not.toHaveBeenCalled();
    expect(result.metadata).toEqual({
      previousSessionID: 'ses_old',
      sessionID: 'ses_new',
    });
  });
});
