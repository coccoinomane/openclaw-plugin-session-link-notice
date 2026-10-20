# OpenClaw Session Link Notice

Jump from a chat message to its conversation in the OpenClaw Control UI. The plugin posts an **Open in OpenClaw** link automatically.

- Stay in Discord, Telegram or another supported channel until you need the full session.
- Show the link once per session, after inactivity, or both.
- Keep notifications out of the assistant transcript, with no extra model calls or prompt text.
- Leave subagent notifications to your existing plugin.

## Install

Requires OpenClaw **2026.10.3+** and a configured `gateway.publicOrigin`. Links use your existing Control UI address and require normal access.

```bash
openclaw plugins install git:github.com/coccoinomane/openclaw-plugin-session-link-notice@v0.1.1
openclaw config set plugins.entries.session-link-notice.hooks.allowConversationAccess true
```

The hook permission lets the plugin observe session metadata; its handler ignores conversation text and returns no prompt changes.

## Options

Under `plugins.entries.session-link-notice.config`, the defaults are:

```json
{
  "label": "Open in OpenClaw",
  "onSessionStart": { "enabled": true },
  "afterInactivity": { "enabled": false, "minutes": 60 }
}
```

The switches are independent. Enable `afterInactivity` for a fresh link on the first request after an hour of silence. Routing follows the current channel and thread; no per-channel plugin setup is needed.

To restrict notices to one agent, add `"allowedAgentIds": ["main"]` to the same config. Omit it for all agents, or use `[]` to disable notices for everyone.

[Technical details and testing](docs/technical.md) · [MIT license](LICENSE)
