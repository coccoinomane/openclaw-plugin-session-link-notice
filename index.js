import { sendDurableMessageBatch } from 'openclaw/plugin-sdk/channel-outbound';
import { resolveSendPolicy } from 'openclaw/plugin-sdk/session-store-runtime';
import { resolveAgentIdFromSessionKey } from 'openclaw/plugin-sdk/routing';
import { createNoticeHandler } from './notice.js';
import { sessionUrl } from './session-link.js';

export default {
  id: 'session-link-notice',
  name: 'Session Link Notice',
  register(api) {
    const handler = createNoticeHandler({
      store: api.runtime.state.openKeyedStore({ namespace: 'session-link-notice', retention: 'retained' }),
      config: () => api.runtime.config.current(),
      pluginOptions: () => api.runtime.config.current().plugins?.entries?.['session-link-notice']?.config ?? api.pluginConfig,
      readSession: (ctx, cfg) => {
        const entry = api.runtime.agent.session.getSessionEntry({
          agentId: ctx.agentId ?? resolveAgentIdFromSessionKey(ctx.sessionKey),
          sessionKey: ctx.sessionKey,
          readConsistency: 'latest',
        });
        if (resolveSendPolicy({ cfg, entry, sessionKey: ctx.sessionKey, channel: ctx.channel, chatType: entry?.chatType }) !== 'allow') return;
        return entry;
      },
      send: sendDurableMessageBatch,
      sessionUrl,
      warn: message => api.logger.warn('[session-link-notice] ' + message),
    });
    function observe(event, ctx) {
      // Copy only routing/identity metadata; never retain prompts or model messages.
      void handler.enqueue({ runId: ctx.runId ?? event.runId, sessionId: ctx.sessionId ?? event.sessionId }, {
        agentId: ctx.agentId, sessionKey: ctx.sessionKey, sessionId: ctx.sessionId ?? event.sessionId,
        channel: ctx.channel, accountId: ctx.accountId, trigger: ctx.trigger,
        senderId: ctx.senderId, inputProvenance: ctx.inputProvenance,
      });
    }
    // Observe identity after session initialization; return no prompt contribution.
    api.on('before_prompt_build', observe);
    api.on('gateway_stop', () => handler.drain());
  },
};
