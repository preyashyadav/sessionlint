# claude-runner.ts manual verification (2026-07-13)

Not an automated test — every `claude -p` invocation is a real, billed API call, so this
must never run inside `bun test`. Recorded here instead, once, as the actual ground truth
`claude-runner.ts` was built against.

## Command run

```
claude -p "say ok" --output-format json
```

## Real output captured (v2.1.207, this machine)

```json
{"type":"result","subtype":"success","is_error":false,"api_error_status":null,"duration_ms":2050,"duration_api_ms":2038,"ttft_ms":1998,"ttft_stream_ms":1997,"time_to_request_ms":14,"num_turns":1,"result":"Ok","stop_reason":"end_turn","session_id":"f58f1774-fcb5-4406-b225-1d9467c57024","total_cost_usd":0.0278529,"usage":{"input_tokens":2,"cache_creation_input_tokens":3565,"cache_read_input_tokens":21273,"output_tokens":5,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":3565,"ephemeral_5m_input_tokens":0},"inference_geo":"not_available","iterations":[{"input_tokens":2,"output_tokens":5,"cache_read_input_tokens":21273,"cache_creation_input_tokens":3565,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":3565},"type":"message"}],"speed":"standard"},"modelUsage":{"claude-sonnet-5":{"inputTokens":2,"outputTokens":5,"cacheReadInputTokens":21273,"cacheCreationInputTokens":3565,"webSearchRequests":0,"costUSD":0.0278529,"contextWindow":1000000,"maxOutputTokens":64000}},"permission_denials":[],"terminal_reason":"completed","fast_mode_state":"off","uuid":"0ab94d13-616f-4d4a-b648-90f636c25a83"}
```

## What this confirms

- `is_error` (boolean), `total_cost_usd` (number), `num_turns` (number), `duration_ms`
  (number), `result` (string) all exist exactly as named — `claude-runner.ts` reads only
  these five fields.
- A research agent (via claude-code-guide) had independently claimed this same schema
  before this was run — this smoke test confirms that specific part of its research was
  accurate. The same research pass also claimed a `--max-turns` flag exists, which was
  checked separately against `claude -p --help` and does **not** exist — not every claim
  from that research was trustworthy, only the parts verified here and via `--help` are
  relied upon in code.
- `--output-format`, `--model`, `--max-budget-usd`, and `--permission-mode` were verified
  as real flags directly from `claude -p --help` (not from this run) before being used in
  `claude-runner.ts`.

## What was NOT verified

- The `--permission-mode` value that actually allows a fully unattended run to make edits/run
  bash without ever prompting for approval — the exact semantics of `acceptEdits` vs `auto`
  vs `bypassPermissions` vs `dontAsk` were not tested live, only the flag's existence and
  its list of choices. `sessionlint run` exposes `--permission-mode` as a pass-through flag
  rather than silently picking one on the user's behalf.
- `--output-format stream-json` was not exercised here — only the non-streaming `json` mode,
  which is all `claude-runner.ts` currently uses.
- Behavior when `--max-budget-usd` is actually exceeded mid-run (does it hard-stop, refuse to
  start a new turn, or something else?) was not tested — this run's cost was far under any
  plausible budget.
