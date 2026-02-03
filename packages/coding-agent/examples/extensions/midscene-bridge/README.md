# Midscene Browser Bridge Extension

This extension adds a `browser_bridge` tool that lets pi control a Chrome tab via Midscene Bridge Mode. It opens a new tab by default; use `attach: "current_tab"` to reuse the active tab. It is designed for tasks that the CLI cannot complete (web UIs, logged-in flows, etc.).

## Setup

1. Install dependencies:

```bash
cd packages/coding-agent/examples/extensions/midscene-bridge
npm install
```

2. Add Midscene environment variables to `packages/coding-agent/examples/extensions/midscene-bridge/.env`.
   The `.env` file is ignored by git.

3. (Playwright mode) Install browsers once:

```bash
npx playwright install
```

## Loading

Use `pi -e /path/to/midscene-bridge` or copy it under `.pi/extensions/`.

## Runtime modes

`browser_bridge` can run in:
- `runtime: "bridge"` (default) — connect to a new desktop Chrome tab (viewport snapshots). Use `attach: "current_tab"` to target the active tab.
- `runtime: "playwright"` — launch a Playwright browser (supports full-page screenshots).

Prefer `runtime: "bridge"` and only use Playwright when you need full-page snapshots, an isolated session, or bridge is unavailable.
Snapshots are included by default; set `snapshot: false` to suppress.
Snapshots are downscaled (max 448px) for faster LLM review.
When opening a new tab without `url`, the bridge starts at `about:blank`.

## Caching

Midscene supports caching planning/locate results. Enable it per tool call or via env:

- Tool call: `cache: { id: "my-cache", strategy: "read-write" }`
- Env defaults: `MIDSCENE_CACHE=1` with optional `MIDSCENE_CACHE_ID`

## Timeouts

Defaults are lowered for faster runs:

- `waitForNavigationTimeout`: 3000ms
- `waitForNetworkIdleTimeout`: 1000ms

Override per tool call:

```
Use browser_bridge with waitForNavigationTimeout 5000 and waitForNetworkIdleTimeout 2000 and steps:
- act: "open https://example.com"
```

## Planning limits

Midscene limits replanning cycles. The extension defaults to `60` unless you set:

- Tool call: `replanningCycleLimit: 80`
- Env var: `MIDSCENE_REPLANNING_CYCLE_LIMIT=80`

## Tool usage

High-level task:

```
Use browser_bridge to open amazon and add a laptop to cart.
```

Structured steps (preferred for reliability):

```
Use browser_bridge with steps:
- act: "open https://www.amazon.com"
- wait_for: "the search bar is visible"
- input: target "search bar", text "Noise cancelling headphones", mode "replace"
- tap: target "search button"
- wait_for: "the results grid becomes visible"
- number: "price of the first headphone", saveAs "firstPrice"
- tap: target "the first result card"
- act: "add to cart"
- assert: "the cart is visible"
```

Steps can also use ai* shorthand (`aiTap`, `aiInput`, `aiAssert`, `aiWaitFor`, `aiQuery`, `aiNumber`, `aiString`, `aiBoolean`, `aiHover`, `aiScroll`, `aiAct`). For `input`, use `text` or `value`.

Validated steps (use `expect` to assert after each step):

```
Use browser_bridge with steps:
- type: navigate
  url: "https://example.com/login"
  expect: "the login page is visible"
- type: input
  target: "email"
  text: "user@example.com"
  expect: "the email input shows user@example.com"
- type: tap
  target: "Sign in"
  expect: "the dashboard is visible"
```

Planned tasks (flow-based):

```
Use browser_bridge with plan:
target:
  url: https://app.docusign.com
  bridgeMode: newTabWithUrl
tasks:
  - name: login
    flow:
      - aiAct: >
          navigate to https://app.docusign.com
          login with username: ${DOCUSIGN_USERNAME} and password: ${DOCUSIGN_PASSWORD}
      - aiAssert: Welcome back
  - name: download completed
    flow:
      - aiAct: click on the "Agreements" tab
      - aiAssert: Inbox
      - aiAct: click on Completed tab on the left sidebar
      - aiAssert: Completed
      - aiAct: select date and click on All time and click Apply
      - aiAssert: find list of documents in the table with status "Completed"
      - aiAct: download all documents one by one and save them in the "Downloads" folder
      - aiAct: scroll down to the bottom of the page and click next pages to download all pages
      - aiAssert: no more pages to download
```

YAML plan (runs `agent.runYaml` tasks):

```
Use browser_bridge with planYaml: |
  tasks:
    - name: Search for weather
      flow:
        - aiAct: Search for "today's weather"
        - sleep: 3000
        - aiAssert: The results show weather information
```

Snapshot only (Bridge or Playwright):

```
Use browser_bridge with snapshot true.
```

```
Use browser_bridge with runtime "playwright" and url "https://example.com" and snapshot true.
```

## Commands

- `/browser status` — show bridge connection status
- `/browser close` — close the current bridge session
