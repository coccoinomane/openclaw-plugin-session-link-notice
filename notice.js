export const DEFAULTS = Object.freeze({
  label: 'Open in OpenClaw',
  onSessionStart: { enabled: true },
  afterInactivity: { enabled: false, minutes: 60 },
});

export function options(raw = {}) {
  return {
    label: raw.label ?? DEFAULTS.label,
    onSessionStart: { enabled: raw.onSessionStart?.enabled ?? true },
    afterInactivity: {
      enabled: raw.afterInactivity?.enabled ?? false,
      minutes: raw.afterInactivity?.minutes ?? 60,
    },
  };
}

export function isSubagent(key, entry) {
  return /(?:^|:)subagent:/i.test(key) || Boolean(entry.spawnedBy) ||
    Boolean(entry.completionOwnerSessionKey) || (entry.spawnDepth ?? 0) > 0 ||
    entry.createdVia === 'spawn';
}

export function noticeText(label, url) {
  const clean = label.replace(/[\r\n]/g, ' ');
  const escaped = clean.replace(/[\\[\]()*_<>]/g, '\\$&');
  return '[' + escaped + '](' + url.replace(/[()]/g, c => c === '(' ? '%28' : '%29') + ')';
}

export function eligible(ctx, entry, sessionId) {
  if (!ctx.sessionKey || !sessionId || entry.sessionId !== sessionId) return false;
  if (isSubagent(ctx.sessionKey, entry)) return false;
  if (ctx.trigger && ctx.trigger !== 'user') return false;
  // Some channel producers omit external_user. Require a sender and a matching
  // external route below; explicitly classified internal inputs are always skipped.
  if (ctx.inputProvenance && ctx.inputProvenance.kind !== 'external_user') return false;
  if (!ctx.senderId || !ctx.channel || ['webchat', 'internal', 'cli'].includes(ctx.channel)) return false;
  return entry.delivery?.kind === 'external' && entry.delivery.context?.channel === ctx.channel &&
    (!ctx.accountId || ctx.accountId === entry.delivery.context.accountId);
}

export function createNoticeHandler({ store, readSession, send, config, pluginOptions, sessionUrl, now = Date.now, warn = () => {} }) {
  const queues = new Map();
  async function handle(event, ctx) {
    const cfg = config();
    const opt = options(pluginOptions());
    if (!opt.onSessionStart.enabled && !opt.afterInactivity.enabled) return;
    const entry = await readSession(ctx, cfg);
    const sessionId = ctx.sessionId ?? event.sessionId;
    if (!entry || !eligible(ctx, entry, sessionId)) return;
    const route = entry.delivery.context;
    if (!route.to || !event.runId) return;
    const key = JSON.stringify([ctx.sessionKey, sessionId, route.channel, route.accountId ?? '', route.to, route.threadId ?? null]);
    const previous = await store.lookup(key);
    if (previous?.recentRuns?.includes(event.runId)) return;
    const time = now();
    const idle = previous && time - previous.lastHumanAt >= opt.afterInactivity.minutes * 60000;
    const shouldSend = (!previous && opt.onSessionStart.enabled) || (idle && opt.afterInactivity.enabled);
    // Reserve before I/O: retries and hot reloads must not duplicate an ambiguous send.
    await store.register(key, { lastHumanAt: time, recentRuns: [...(previous?.recentRuns ?? []), event.runId].slice(-64) });
    if (!shouldSend) return;
    const url = sessionUrl(cfg, ctx.sessionKey);
    if (!url) { warn('No valid gateway.publicOrigin / Control UI URL; notice skipped.'); return; }
    // Read the current incarnation once more before handing off to delivery.
    const current = await readSession(ctx, cfg);
    if (!current || !eligible(ctx, current, sessionId) ||
        JSON.stringify(current.delivery.context) !== JSON.stringify(route)) return;
    const claim = 'notice:' + key + (previous ? ':' + event.runId : ':first');
    if (!await store.registerIfAbsent(claim, { attemptedAt: time })) return;
    const result = await send({
      cfg, channel: route.channel, accountId: route.accountId, to: route.to,
      threadId: route.threadId, payloads: [{ text: noticeText(opt.label, url) }],
      silent: true,
      // Deliberately omit mirror, session, runId and replyToId: channel-only notice.
    });
    if (result.status !== 'sent') warn('Notice delivery outcome: ' + result.status + '; no plugin retry.');
  }
  return {
    enqueue(event, ctx) {
      const key = ctx.sessionKey;
      if (!key) return Promise.resolve();
      const pending = (queues.get(key) ?? Promise.resolve()).then(() => handle(event, ctx))
        .catch(error => warn('Session link notice failed: ' + String(error?.message ?? error)));
      queues.set(key, pending);
      void pending.finally(() => { if (queues.get(key) === pending) queues.delete(key); });
      return pending;
    },
    async drain() { await Promise.all(queues.values()); },
  };
}
