# Paging, search, and prompt-cache economics (v1.8.0)

Why the agent used to stall on big web apps, and what changed.

## The incident

On 2026-08-01 an operator asked Combo-X to walk through Google Play Console
publishing for `airon.coach`. The run consumed its entire 48-turn budget and
never reached step 1 of the actual task. The transcript shows the same six
moves repeated: read the dashboard, get a wall of Polish sidebar labels, try a
URL, get silently redirected, read the dashboard again.

Five distinct defects, all of which are now fixed and regression-tested.

### 1. Page reads returned nav chrome, not content

`get_page` served `document.body` text, and `mode:"snippet"` capped it at 2,500
characters. Play Console's sidebar is roughly 1,500 characters of
`arrow_rightPodsumowaniearrow_right…`, so every read spent its whole budget on
navigation the agent had already seen. It called `get_page` six times and never
saw the dashboard body once.

**Now:** `mode:"main"` is the default. It prefers `<main>`/`[role=main]`/
`<article>`, and otherwise takes the body minus `nav`/`header`/`footer`/`aside`.
The reply reports `region` and `chromeSkippedChars` so the omission is visible,
and `mode:"full"` still returns everything.

While fixing this we found a second, older bug: text extraction ran
`innerText` on a **detached** clone. Per spec `innerText` falls back to
`textContent` for non-rendered nodes, so every paragraph boundary was lost and
the whole page came back as one line. `blockAwareText()` now inserts newlines
for block elements — which is also what makes line filtering possible.

### 2. Truncation was terminal, and it produced invalid JSON

Tool results were capped by slicing the serialized JSON string. In the
transcript `get_interactive({limit:100})` was cut mid-object at item 19: the
model got unparseable text, no count, and no way to ask for the rest. It
reasonably concluded "the interactive list is truncated" and moved on.

**Now:** every list-shaped tool result loses whole *entries*, never characters,
and carries a `_truncated` envelope:

```json
{ "field": "items", "shown": 22, "of": 100, "dropped": 78,
  "hint": "78 more items were dropped… Re-call with offset:22 to continue…" }
```

Unstructured blobs still fall back to a preview, but that preview is now valid
JSON with a hint attached.

### 3. Nothing could be paged or searched

There was no `offset` anywhere and no way to say "just the Save button".

**Now:**

| Tool | New arguments | Reply carries |
|------|---------------|---------------|
| `get_page` | `mode:"main"`, `offset`, `filter` | `totalChars`, `offset`, `nextOffset`, `hasMore`, `region` |
| `get_interactive` | `offset`, `filter`, `kind`, `region` | `matched`, `total`, `nextOffset`, `hasMore`, `regionCounts` |
| `find_text` | `offset`, `context` | `total`, `nextOffset`, `interactiveIndex`, `clickable` |
| `get_links` | `offset`, `filter`, `region` | `total`, `nextOffset`, `hasMore` |

Two design points worth knowing:

- **`item.i` is absolute.** `get_interactive` scans a superset (up to 600
  controls), stores that whole list as the click map, and reports each item's
  index *into that list*. Filtering and paging therefore never invalidate
  `click_index` — `get_interactive({filter:"Save"})` returns `i: 87` and
  `click_index({index:87})` hits the right control.
- **`find_text` is now actionable.** Each hit reports the `interactiveIndex` of
  its nearest interactive ancestor, so "find the Publish button and click it" is
  two calls instead of a 100-item dump plus a guess. It reuses an existing click
  map when one is live, so it never invalidates indices you already have.

There is also an adaptive default: when the caller passes no `region` and the
control count exceeds the limit, `get_interactive` scopes to main content and
says so in the hint, including how many nav controls it hid and how to get them
back. Passing `region:"any"` explicitly always wins.

### 4. Identical calls repeated until the budget ran out

The agent requested `…/app-content` four times. Each one silently redirected to
`…/app-list`, and each looked like `{ok:true}`.

**Now:** `RepeatGuard` fingerprints `(tool, canonical args) → result`. The second
identical call+result gets a `_repeat` nudge with tool-specific alternatives; the
third is refused before it runs. Re-polling a *changing* page never trips it —
only a byte-identical result counts, because that is the case where nothing was
learned. Separately, `navigate` now returns `redirected: true` with
`requestedUrl` whenever the landing URL differs from the requested one.

### 5. Stale click maps in single-page apps

The interactive map is keyed on `document`, which survives client-side
navigation. After an in-app route change the map still looked populated, so
`click_index` "succeeded" against detached nodes. `liveInteractiveMap()` now
drops a map whose elements have left the DOM and returns an error that says to
re-list.

## Prompt-cache economics (DeepSeek V4 and friends)

DeepSeek, Moonshot, OpenAI, Gemini and Grok cache automatically on an **exact
token prefix**. Cache reads bill at roughly a tenth of fresh tokens, which is why
a 2.3M-token DeepSeek session costs about eight cents. The cache only pays off
while the prompt is append-only: the first byte that changes invalidates
everything after it.

Two changes follow from that.

### The system message is now ordered stable-first

It used to be:

```
systemBase · memories · TASKS · skills · TOOL INDEX
```

The task list changes on every `create_task`/`update_task`, and it sat **in front
of the largest block in the prompt**. Creating four tasks therefore re-billed the
entire tool catalog at full price on the next turn.

Now the system message holds only stable content —
`systemBase · skills · TOOL INDEX` — and the volatile memory/task blocks ride as
a separate message immediately before the user turn. They are still injected
every turn (and are now *more* recent for the model to act on), but a change
invalidates only the tail.

### Compaction is hysteretic

Mid-run compaction rewrote the prompt whenever it exceeded the cap — potentially
every step. Each rewrite is a full cache reset, so aggressive compaction can cost
more than the tokens it saves.

`shouldCompactNow()` now applies:

| Knob | Value | Why |
|------|-------|-----|
| `COMPACT_TRIGGER_RATIO` | 1.25× cap | Ignore marginal overflow |
| `COMPACT_TARGET_RATIO` | 0.5× cap | Cut deep once, then coast |
| `COMPACT_COOLDOWN_STEPS` | 3 | Never rewrite on consecutive steps |
| `COMPACT_HARD_CEILING_RATIO` | 2× cap | Correctness overrides the cooldown |

`deepseek/deepseek-v4-flash-0731` and `deepseek/deepseek-v4-0731` are now model
presets, so the id no longer has to be typed by hand.

## What the model is told

`DEFAULT_SYSTEM` gained three rules that make the above reachable rather than
merely available: search instead of dumping; always read `hasMore`/`nextOffset`
before declaring a list complete; and never repeat an identical call, because
the third one is refused.

## Honest limits

- The 600-control scan is one style pass per `get_interactive`. That is a few
  milliseconds on a large page — far cheaper than the extra model round trip it
  replaces, but it is not free.
- Region detection is structural (`<nav>`, `[role=navigation]`, `<main>`…).
  A site that builds its sidebar from bare `<div>`s will be classified as main
  content; `filter` still works there.
- The repeat guard compares whole results. A page with a changing timestamp
  produces a different fingerprint every call and will never trip the guard.
