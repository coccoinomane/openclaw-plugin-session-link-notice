import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoticeHandler, options, noticeText, isSubagent } from './notice.js';
import { sessionUrl } from './session-link.js';
import plugin from './index.js';

const cfg = { gateway: { publicOrigin: 'https://claw.example' } };
function fixture(opt = {}, shared) {
  const rows = shared ?? new Map();
  const sent = [], warnings = [];
  let time = 1000000, serial = 0;
  const entry = { sessionId: 'session-1', delivery: { kind: 'external', context: {
    channel: 'discord', accountId: 'a', to: 'channel:123', threadId: 'thread-1',
  } } };
  const ctx = { sessionKey: 'agent:main:discord:channel:123', sessionId: 'session-1',
    agentId: 'main', channel: 'discord', accountId: 'a', trigger: 'user', senderId: 'human',
    inputProvenance: { kind: 'external_user' } };
  const args = {
    store: {
      lookup: async k => rows.get(k),
      register: async (k, v) => { rows.set(k, v); },
      registerIfAbsent: async (k, v) => { if (rows.has(k)) return false; rows.set(k, v); return true; },
    },
    readSession: async () => entry, config: () => cfg, pluginOptions: () => opt,
    sessionUrl, now: () => time, warn: x => warnings.push(x),
    send: async x => { sent.push(x); return { status: 'sent' }; },
  };
  let handler = createNoticeHandler(args);
  return { rows, entry, ctx, args, sent, warnings,
    advance: ms => { time += ms; },
    run: (id = 'run-' + ++serial) => handler.enqueue({ runId: id, sessionId: ctx.sessionId }, ctx),
    reload: () => { handler = createNoticeHandler(args); },
  };
}

test('defaults only enable session start', () => {
  assert.equal(options().label, 'Open in OpenClaw');
  assert.equal(options().onSessionStart.enabled, true);
  assert.equal(options().afterInactivity.enabled, false);
});
for (const start of [true, false]) for (const idle of [true, false]) {
  test('independent switches start=' + start + ' idle=' + idle, async () => {
    const f = fixture({ onSessionStart: { enabled: start }, afterInactivity: { enabled: idle, minutes: 1 } });
    await f.run();
    assert.equal(f.sent.length, Number(start));
    f.advance(60001); await f.run();
    assert.equal(f.sent.length, Number(start) + Number(idle));
    await f.run(); assert.equal(f.sent.length, Number(start) + Number(idle));
  });
}
test('inactivity measured from last human turn, not last notice', async () => {
  const f = fixture({ afterInactivity: { enabled: true, minutes: 1 } });
  await f.run();
  for (let i = 0; i < 4; i++) { f.advance(50000); await f.run(); }
  assert.equal(f.sent.length, 1);
  f.advance(60000); await f.run(); assert.equal(f.sent.length, 2);
});
test('same run and delayed previous run cannot trigger idle notice', async () => {
  const f = fixture({ afterInactivity: { enabled: true, minutes: 1 } });
  await f.run('a'); await f.run('b'); f.advance(120000); await f.run('a');
  assert.equal(f.sent.length, 1);
});
test('concurrent callbacks emit one notice', async () => {
  const f = fixture(); await Promise.all([f.run('a'), f.run('a'), f.run('b')]);
  assert.equal(f.sent.length, 1);
});
test('reload keeps once-per-session state', async () => {
  const f = fixture(); await f.run(); f.reload(); await f.run(); assert.equal(f.sent.length, 1);
});
test('new incarnation of same session key notifies again', async () => {
  const f = fixture(); await f.run(); f.entry.sessionId = f.ctx.sessionId = 'session-2';
  await f.run(); assert.equal(f.sent.length, 2);
});
test('stale incarnation is skipped', async () => {
  const f = fixture(); f.entry.sessionId = 'other'; await f.run(); assert.equal(f.sent.length, 0);
});
for (const marker of [{ spawnedBy: 'parent' }, { spawnDepth: 1 }, { completionOwnerSessionKey: 'parent' }, { createdVia: 'spawn' }]) {
  test('visible child metadata excluded: ' + JSON.stringify(marker), async () => {
    const f = fixture(); Object.assign(f.entry, marker); await f.run(); assert.equal(f.sent.length, 0);
  });
}
test('hidden subagent key excluded', async () => {
  const f = fixture(); f.ctx.sessionKey = 'agent:main:subagent:uuid'; await f.run(); assert.equal(f.sent.length, 0);
});
test('ordinary thread parent is not automatically a spawned child', () => {
  assert.equal(isSubagent('agent:main:discord:channel:1', { parentSessionKey: 'parent' }), false);
});
for (const trigger of ['cron', 'heartbeat', 'internal']) test('skip trigger ' + trigger, async () => {
  const f = fixture(); f.ctx.trigger = trigger; await f.run(); assert.equal(f.sent.length, 0);
});
for (const kind of ['inter_session', 'internal_system']) test('skip provenance ' + kind, async () => {
  const f = fixture(); f.ctx.inputProvenance.kind = kind; await f.run(); assert.equal(f.sent.length, 0);
});
test('skip web UI and missing human sender', async () => {
  const f = fixture(); delete f.ctx.senderId; await f.run(); assert.equal(f.sent.length, 0);
  f.ctx.senderId = 'human'; f.ctx.channel = 'webchat'; await f.run(); assert.equal(f.sent.length, 0);
});
for (const channel of ['discord', 'telegram', 'slack']) test('portable route ' + channel, async () => {
  const f = fixture(); f.ctx.channel = f.entry.delivery.context.channel = channel;
  await f.run();
  const s = f.sent[0];
  assert.equal(s.channel, channel); assert.equal(s.to, 'channel:123');
  assert.equal(s.accountId, 'a'); assert.equal(s.threadId, 'thread-1');
  assert.equal(s.mirror, undefined); assert.equal(s.session, undefined); assert.equal(s.runId, undefined);
  assert.equal(s.payloads[0].text, '[Open in OpenClaw](https://claw.example/chat/main/discord/channel/123)');
});
test('channel/account mismatch skipped', async () => {
  const f = fixture(); f.ctx.accountId = 'other'; await f.run(); assert.equal(f.sent.length, 0);
  f.ctx.accountId = 'a'; f.ctx.channel = 'telegram'; await f.run(); assert.equal(f.sent.length, 0);
});
test('failure does not reject hook or retry ambiguously', async () => {
  const f = fixture(); f.args.send = async () => { throw new Error('network'); }; f.reload();
  await f.run('a'); await f.run('a'); await f.run('b');
  assert.equal(f.warnings.length, 1);
});
test('URL uses public origin and base path', () => {
  assert.equal(sessionUrl({ gateway: { publicOrigin: 'https://claw.example', controlUi: { basePath: '/ui/' } } }, 'agent:main:telegram:group:-100:topic:4'),
    'https://claw.example/ui/chat/main/telegram/group/-100/topic/4');
});
for (const origin of [undefined, 'javascript:alert(1)', 'https://u:p@claw.example', 'https://claw.example/?token=x', 'https://claw.example/base', 'invalid']) {
  test('reject unsafe or absent origin ' + origin, () => assert.equal(sessionUrl({ gateway: { publicOrigin: origin } }, 'agent:main:main'), undefined));
}
test('disabled UI suppresses link', () => assert.equal(sessionUrl({ gateway: { publicOrigin: 'https://claw.example', controlUi: { enabled: false } } }, 'agent:main:main'), undefined));
test('custom label is escaped', () => assert.equal(noticeText('View [chat]\nnow', 'https://example.com'), '[View \\[chat\\] now](https://example.com)'));
test('registration exposes no tools, skills or prompt changes', async () => {
  const hooks = new Map();
  plugin.register({
    runtime: { state: { openKeyedStore: () => ({}) }, config: { current: () => cfg } },
    logger: { warn() {} }, on: (name, fn) => hooks.set(name, fn),
  });
  assert.deepEqual([...hooks.keys()], ['before_prompt_build', 'gateway_stop']);
  const event = Object.freeze({ prompt: 'human', historyMessages: Object.freeze([]) });
  assert.equal(hooks.get('before_prompt_build')(event, {}), undefined);
  await hooks.get('gateway_stop')();
  assert.equal(event.prompt, 'human');
});

test('legacy human channel turn without provenance remains supported', async () => {
  const f = fixture(); delete f.ctx.inputProvenance; await f.run(); assert.equal(f.sent.length, 1);
});
test('missing public URL produces no send and no guessed localhost link', async () => {
  const f = fixture(); f.args.config = () => ({}); f.reload(); await f.run();
  assert.equal(f.sent.length, 0); assert.equal(f.warnings.length, 1);
});
test('route changes before I/O suppress stale delivery', async () => {
  const f = fixture(); let reads = 0;
  f.args.readSession = async () => ++reads === 1 ? f.entry : { ...f.entry, sessionId: 'replacement' };
  f.reload(); await f.run(); assert.equal(f.sent.length, 0);
});
test('cross-instance reservation suppresses duplicate first notice', async () => {
  const rows = new Map(), a = fixture({}, rows), b = fixture({}, rows);
  await Promise.all([a.run(), b.run()]); assert.equal(a.sent.length + b.sent.length, 1);
});

for (const agentId of ['main', 'famiglia', 'mamma']) {
  test('omitted agent filter preserves notifications for ' + agentId, async () => {
    const f = fixture(); f.ctx.agentId = agentId;
    await f.run(); assert.equal(f.sent.length, 1);
  });
}
test('main-only filter allows main', async () => {
  const f = fixture({ allowedAgentIds: ['main'] });
  await f.run(); assert.equal(f.sent.length, 1);
});
for (const agentId of ['famiglia', 'mamma', 'main-other', undefined]) {
  test('main-only filter rejects before session/state access: ' + agentId, async () => {
    const f = fixture({ allowedAgentIds: ['main'] }); f.ctx.agentId = agentId;
    let reads = 0; f.args.readSession = async () => { reads++; return f.entry; }; f.reload();
    await f.run(); assert.equal(reads, 0); assert.equal(f.rows.size, 0); assert.equal(f.sent.length, 0);
  });
}
for (const allowedAgentIds of [[], null, 'main']) {
  test('empty or invalid filter denies all: ' + JSON.stringify(allowedAgentIds), async () => {
    const f = fixture({ allowedAgentIds }); await f.run();
    assert.equal(f.rows.size, 0); assert.equal(f.sent.length, 0);
  });
}
test('agent filter does not re-enable subagents', async () => {
  const f = fixture({ allowedAgentIds: ['main'] }); f.entry.spawnDepth = 1;
  await f.run(); assert.equal(f.sent.length, 0); assert.equal(f.rows.size, 0);
});
test('live options update excludes an agent without touching its idle state', async () => {
  const opt = { afterInactivity: { enabled: true, minutes: 1 } };
  const f = fixture(opt); f.ctx.agentId = 'mamma'; await f.run();
  const before = JSON.stringify([...f.rows]);
  opt.allowedAgentIds = ['main']; f.advance(60001); await f.run();
  assert.equal(f.sent.length, 1); assert.equal(JSON.stringify([...f.rows]), before);
});
