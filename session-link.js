import { buildControlUiSessionPath } from 'openclaw/plugin-sdk/session-discussion';
import { resolveGatewayPublicOrigin } from 'openclaw/plugin-sdk/config-contracts';

export function sessionUrl(cfg, sessionKey) {
  if (cfg.gateway?.controlUi?.enabled === false) return;
  try {
    const raw = new URL(cfg.gateway?.publicOrigin);
    if (!['https:', 'http:'].includes(raw.protocol) || raw.username || raw.password ||
        raw.pathname !== '/' || raw.search || raw.hash) return;
    const origin = resolveGatewayPublicOrigin(cfg);
    if (!origin) return;
    const pathname = buildControlUiSessionPath({
      namespace: 'chat', sessionKey, exactKey: true,
      basePath: cfg.gateway?.controlUi?.basePath,
    });
    if (!pathname) return;
    const url = new URL(origin);
    url.pathname = pathname;
    return url.toString();
  } catch { return; }
}
