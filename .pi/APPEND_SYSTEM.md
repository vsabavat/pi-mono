# Browser Bridge (Midscene)

When UI automation is required, use `browser_bridge`. Prefer `steps` over `task`.

Step types: `act`, `wait_for`, `assert`, `tap`, `input`, `scroll`, `hover`, `number`, `string`, `boolean`, `query`, `navigate`, `reload`, `back`, `sleep`.

Defaults:
- `attach: current_tab`; `new_tab` requires `url`.
- `runtime: "bridge"`; only use `runtime: "playwright"` when you need full-page snapshots, an isolated session, or bridge is unavailable.
- Snapshots are included by default; set `snapshot: false` to suppress.
- Snapshots are downscaled (max 448px) for faster LLM review.

Guidelines:
- Use short, concrete locators for `tap`/`hover`/`input` (visible label or aria label).
- Use `wait_for` before interacting.
- Use `query` to list candidates, then `tap` the exact value returned.
- Prefer instant actions (`tap`, `input`, `scroll`, `hover`) over `act`.
- Prefer structured extraction (`query`, `number`, `string`, `boolean`) over `act`.
- Steps accept typed form (`type`, `target`, `prompt`, `text`/`value`) or ai* shorthand (`aiTap`, `aiInput`, `aiAssert`, `aiWaitFor`, `aiQuery`, `aiNumber`, `aiString`, `aiBoolean`, `aiHover`, `aiScroll`, `aiAct`).
- Use `saveAs` for values you need later.
- Use `expect` on steps to validate after each action.
- For custom dropdowns: `tap` the trigger/chevron, `wait_for` the list, `query` options, then `tap` the exact option.
- `scrollType` values: `singleAction`, `scrollToBottom`, `scrollToTop`, `scrollToRight`, `scrollToLeft` (legacy aliases `page`, `once`, `toTop`, `toBottom`, `toLeft`, `toRight` are mapped).
- Caching: `cache: { id: "my-cache", strategy: "read-write" }` or `cache: false` (`MIDSCENE_CACHE=1` + `MIDSCENE_CACHE_ID`).
- Use `closeOnComplete` when you want to release the session.
- Use `aiAct` only for a single stable high-level instruction; otherwise use structured + instant actions.

Failure recovery:
- On step failure, request a snapshot (bridge or Playwright) or `query` visible headings/links, then retry.
- Use `query` for candidates before retrying `tap` or `input`.

External knowledge:
- If the task requires unknown URLs or flows, use `bash` with `curl https://www.google.com/search?q=...` before starting browser steps.