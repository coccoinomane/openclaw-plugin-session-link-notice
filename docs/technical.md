# Session Link Notice

Sends a channel-only link to the current OpenClaw session. Default text: **Open in OpenClaw**.

By default, the first eligible human request observed in each session incarnation gets one notice. Inactivity notices are disabled. The plugin never announces subagents; it does not replace the subagent-launch-notice plugin.

## Options

Enable plugins.entries.session-link-notice.hooks.allowConversationAccess for the observation hook. This is an SDK requirement even though the implementation ignores conversation text. Do not set hooks.allowPromptInjection to false: the host blocks before_prompt_build entirely in that case. The handler itself returns no prompt contribution.

Configure under plugins.entries.session-link-notice.config:

~~~json
{
  "label": "Open in OpenClaw",
  "onSessionStart": { "enabled": true },
  "afterInactivity": { "enabled": false, "minutes": 60 }
}
~~~

Optional `allowedAgentIds` restricts notices to exact runtime agent IDs, for example `["main"]`. Omission allows all agents; `[]` allows none. With a configured list, a missing agent ID is rejected. The check runs before reading the session, touching notification state, or sending. Subagent exclusions still apply.

The switches are independent. Enable either, both, or neither. Inactivity is measured between eligible human turns, not between notices. The threshold only matters when inactivity notices are enabled. A first request does not count as returning after inactivity.

The URL comes from OpenClaw's gateway.publicOrigin and gateway.controlUi.basePath through public SDK helpers. No duplicate URL setting, token, localhost fallback, or channel-specific credentials are needed. A disabled Control UI or missing public origin suppresses the notice.

The current session's delivery record supplies channel, account, destination and thread/topic. The runtime sender, provider and account are checked before using it. The plugin uses OpenClaw's shared durable delivery API, so formatting and transport remain adapter-owned. Channels that do not support Markdown links may display text with the URL rather than a masked link.

## Runtime behavior

The before_prompt_build hook is used only to observe resolved identity after session initialization. It returns undefined, does not inspect the prompt or history, and contributes no text. Sending runs independently and does not hold up prompt construction. No tools, skills, model calls, or assistant instructions are registered.

Notices omit the delivery API's mirror and session fields. They are not appended as assistant messages and do not go through the message tool. Technical state is stored in a retained plugin namespace, outside the conversation transcript. The delivery queue may retain technical delivery records.

The plugin rejects hidden subagent keys, spawnedBy, positive spawnDepth, completion ownership, and spawn-created sessions. Cron/heartbeat triggers and explicitly classified inter-session/system inputs are skipped. Some channel producers omit external_user provenance; those remain supported only with a sender identity and a matching external delivery route. Missing provenance is not a general proof of human origin.

Discord excludes the receiving bot's own messages from automatic history. A user explicitly quoting the notice can put its text into context; this plugin does not filter human replies or rewrite transcripts.

## Deduplication and failures

State is keyed by session key, session ID and delivery destination/account/thread. It survives plugin and Gateway restarts. Existing sessions receive their first notice on the first eligible request after installation; historical first-request times are not reconstructed.

Per-session serialization, recent run IDs and an atomic notice reservation prevent duplicate callbacks from producing duplicate notices. Reservation occurs before sending. An ambiguous send is not retried by the plugin; OpenClaw owns queued delivery recovery. A crash between reservation and queue creation can lose a notice. Exactly-once delivery across process crashes is not promised.

Failures are logged and do not fail the agent turn. No ordering relative to the assistant's answer is guaranteed.

## Development and verification

Requires OpenClaw 2026.10.3 or later with the documented SDK helpers. Run npm test with OpenClaw available as a peer dependency. Tests use mocked delivery; they send no platform messages.

Acceptance checks after activation:

- Start a normal Discord or Telegram session: one notice with the expected link.
- Send another request: no new notice with default options.
- Restart/reload and send another request in the same incarnation: no duplicate.
- Start a hidden or visible subagent: no notice from this plugin.
- Enable inactivity, wait the configured interval, then send a request: one notice.
- Inspect the transcript/model input: no extra assistant turn or injected prompt text from this plugin.

A platform delivery test is separate from the automated suite. Never claim end-to-end verification from mocked tests alone.
