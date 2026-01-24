# Midscene Browser Bridge Extension

This extension adds a `browser_bridge` tool that lets pi control your active Chrome tab via Midscene Bridge Mode. It is designed for tasks that the CLI cannot complete (web UIs, logged-in flows, etc.).

## Setup

1. Install dependencies:

```bash
cd .pi/extensions/midscene-bridge
npm install
```

2. Add Midscene environment variables to `.pi/extensions/midscene-bridge/.env`.
   The `.env` file is ignored by git.

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

## Commands

- `/browser status` — show bridge connection status
- `/browser close` — close the current bridge session
