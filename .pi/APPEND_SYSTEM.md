# Browser Bridge (Midscene)

When UI automation is required, use the `browser_bridge` tool. Prefer `steps` over a single `task`.

Step types: `act`, `wait_for`, `assert`, `tap`, `input`, `scroll`, `hover`, `number`, `string`, `boolean`, `query`, `navigate`, `reload`, `back`, `sleep`.

Guidelines:
- Use short, concrete locators for `tap`/`hover`/`input` (visible label text or aria label). Avoid long sentences.
- Use `wait_for` before interacting.
- Use `query` to list candidates, then `tap` the exact value returned.
- Prefer instant actions (`tap`, `input`, `scroll`, `hover`) over `act` when possible.
- Prefer structured extraction (`query`, `number`, `string`, `boolean`) over `act` for data and decisions.
- Use `query` to list items, then loop: check with `boolean` and `tap` as needed.
- Structured APIs: `aiBoolean`, `aiString`, `aiNumber`, `aiQuery` for state extraction.
- Instant actions: `aiTap`, `aiInput`, `aiScroll`, `aiHover` for direct UI interaction.
- `scrollType` values: `singleAction`, `scrollToBottom`, `scrollToTop`, `scrollToRight`, `scrollToLeft`.
  - Legacy aliases `page`, `once`, `toTop`, `toBottom`, `toLeft`, `toRight` are mapped.
- Use `saveAs` for values you need later.
- Default `attach: current_tab`; `new_tab` requires `url`.
- Set `closeOnComplete` when you want to release the bridge.
- Caching: set `cache: { id: "my-cache", strategy: "read-write" }` or `cache: false`.
  - Env defaults: `MIDSCENE_CACHE=1` with `MIDSCENE_CACHE_ID`.
- Performance: prefer faster models for planning/insight when latency matters.
- Failure recovery:
  - If a `browser_bridge` step fails, ask the browser for what is visible and then choose a new route.
  - Use `query` to get short page summaries and candidate actions before retrying `tap` or `input`.
  - Example recovery steps: `wait_for` → `query` visible headings/links → pick new target → retry.
- Planning vs insight:
  - Planning is used primarily by `act` (and `task`/`aiAct`), while instant actions rely on locate/insight.

Example:
```
Use browser_bridge with steps:
- wait_for: "repo file list is visible"
- query: "string[], folder names in the list", saveAs: "folders"
- tap: target "desktop-agent"
```

Example (search flow):
```
Use browser_bridge with steps:
- wait_for: "search input is visible"
- input: target "search", text "noise cancelling headphones", mode "replace"
- tap: target "search button"
- wait_for: "results grid is visible"
- number: "price of the first item", saveAs: "firstPrice"
```

Example (cache enabled):
```
Use browser_bridge with cache: { id: "amazon-search", strategy: "read-write" } and steps:
- wait_for: "search input is visible"
- input: target "search", text "wireless mouse", mode "replace"
- tap: target "search button"
- wait_for: "results grid is visible"
```

Structured vs `aiAct`:
- Prefer structured extraction (`aiQuery`, `aiBoolean`, `aiString`, `aiNumber`) plus instant actions (`aiTap`, `aiInput`, `aiScroll`, `aiHover`) for reliability.
- Use `aiAct` only when a single high-level instruction is clearly stable and short.
- Avoid `aiAct` when it fails after retries, needs heavy prompt tuning, or when you need step-by-step debugging.
- Example pattern:
```
Use browser_bridge with steps:
- query: "string[], record list", saveAs: "records"
- boolean: "does record {records[0]} contain completed", saveAs: "isCompleted"
- tap: target "{records[0]}"  # only if isCompleted is false
```