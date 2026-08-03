/**
 * Repeat-call guard — breaks the "try the same thing until the step limit" loop.
 *
 * Observed failure (Google Play Console, 2026-08-01): the agent navigated to
 * `…/app-content` four times, was silently redirected to `…/app-list` every
 * time, and burned a third of its step budget re-reading the same dashboard.
 * Nothing in the loop noticed that the call was identical AND the outcome was
 * identical, so there was no pressure to change approach.
 *
 * Policy: the first repeat is annotated (the model usually self-corrects), the
 * second is refused with concrete alternatives. Only *identical args producing
 * an identical result* count — legitimately re-polling a changing page (a
 * loading spinner, a queue) never trips the guard.
 *
 * Semantic stuck guard (2026-08-03): counts observation-only *model turns*
 * (batches), not each parallel read inside a turn — DEFAULT_SYSTEM tells the
 * model to batch reads; counting each tool fought that advice and stamped
 * ACT NOW mid-batch.
 */

/** Tools whose whole purpose is to re-observe changing state. */
const POLLING_TOOLS = new Set([
  "wait",
  "get_page",
  "page_digest",
  "get_interactive",
  "screenshot",
  "list_tabs",
  "page_metrics",
  "list_tasks",
]);

/**
 * Read-only tools: they observe page state without changing it. A long streak
 * of observation-only *turns* with no click/type/navigation in between is the
 * semantic version of the identical-call loop (observed 2026-08-03 on
 * app.base44.com: ~12 varied read calls hunting for a field that did not
 * exist, zero mutations — the identical-call guard never fired because args
 * and results kept changing).
 */
const OBSERVATION_TOOLS = new Set([
  "get_page",
  "page_digest",
  "get_interactive",
  "find_text",
  "query_all",
  "extract",
  "scrape_tables",
  "get_links",
  "scroll",
  "screenshot",
  "page_metrics",
  "element_rect",
  "list_form_fields",
  "list_tabs",
  "wait",
]);

export function isObservationTool(name: string): boolean {
  return OBSERVATION_TOOLS.has(name);
}

export type RepeatVerdict =
  | { kind: "ok" }
  | { kind: "warn"; repeats: number; note: string }
  | { kind: "block"; repeats: number; result: Record<string, unknown> };

/** `repeats` counts *duplicate outcomes*, not calls: it is 0 after the first. */
type Entry = { repeats: number; fingerprint: string };

/** Stable stringify so `{a:1,b:2}` and `{b:2,a:1}` hash alike. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

/** Cheap non-cryptographic digest — collisions here only cost a nudge. */
function fingerprint(value: unknown): string {
  const text = canonicalize(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${(h >>> 0).toString(36)}:${text.length}`;
}

function alternativesFor(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "navigate":
    case "open_tab":
      return (
        `The URL almost certainly redirected or requires a different entry point. ` +
        `Do NOT request ${String(args.url ?? "it")} again — instead read where you actually landed ` +
        `(page_digest), then reach the target by its on-page control: ` +
        `get_interactive({filter:"<link label>"}) or find_text({text:"<label>"}) and click_index.`
      );
    case "get_page":
      return (
        `Reading the same page again returns the same bytes. Change the query instead: ` +
        `get_page({filter:"<keyword>"}) to grep it, get_page({offset:<nextOffset>}) to continue, ` +
        `or page_digest / find_text to locate the part you need.`
      );
    case "get_interactive":
      return (
        `The control list has not changed. Narrow it instead: ` +
        `get_interactive({filter:"<label>"}), kind:"button", or region:"main". ` +
        `If you expected an overlay, press_key Escape first, or scope:"page".`
      );
    case "click_index":
    case "click":
      return (
        `The click produced no change. The element may be disabled, off-screen, or in a different layer. ` +
        `Re-read controls (get_interactive({filter:"…"})), scroll to it, or try the dialog scope.`
      );
    case "find_text":
      return `Same query, same misses. Try a shorter distinctive substring, or get_page({filter:"…"}).`;
    default:
      return (
        `Identical arguments return an identical result. Change the arguments, use a different tool, ` +
        `or report the blocker to the user instead of retrying.`
      );
  }
}

export class RepeatGuard {
  private readonly seen = new Map<string, Entry>();

  /**
   * Thresholds are in *duplicate outcomes*, so the timeline reads:
   *
   * | call | `repeats` before | check   | record  |
   * |------|------------------|---------|---------|
   * | 1st  | —                | ok      | ok  (repeats→0) |
   * | 2nd  | 0                | ok      | warn (repeats→1) |
   * | 3rd  | 1                | block   | —       |
   */
  private static readonly WARN_AT_REPEATS = 1;
  private static readonly BLOCK_AT_REPEATS = 1;

  /**
   * Semantic stuck guard: consecutive observation-only *batches* (one model
   * turn of parallel reads = +1) without an intervening mutation. `wait` inside
   * the streak marks deliberate polling — warned but never blocked.
   *
   * Warn fires at 3 observation-only turns (operators kill ~turn 5). Block at 8.
   */
  private observationBatches = 0;
  private waitInStreak = false;
  private static readonly STUCK_WARN_AT = 3;
  private static readonly STUCK_BLOCK_AT = 8;

  private key(name: string, args: Record<string, unknown>): string {
    return `${name}#${canonicalize(args)}`;
  }

  /**
   * Called before executing. Returns `block` once this exact call has produced
   * the same result twice — the tool is then not run at all.
   * Also refuses when observation-only batches hit the hard ceiling.
   */
  check(name: string, args: Record<string, unknown>): RepeatVerdict {
    if (!OBSERVATION_TOOLS.has(name)) {
      this.observationBatches = 0;
      this.waitInStreak = false;
    } else if (this.observationBatches >= RepeatGuard.STUCK_BLOCK_AT && !this.waitInStreak) {
      // The refusal IS the intervention — reset so recovery reads (list_tabs to
      // find a lost tab, a scoped re-read) are not themselves refused next.
      const observations = this.observationBatches;
      this.observationBatches = 0;
      this.waitInStreak = false;
      return {
        kind: "block",
        repeats: observations,
        result: {
          ok: false,
          error: "stuck_loop_blocked",
          observations,
          hint:
            `Refused: ${observations} consecutive read-only turns with no click/type/navigation. ` +
            `The page does not change by reading it again. Mutate (click_index/type_index), map the form with ` +
            `list_form_fields, cut noise with within/excludeSelector, or report BLOCKED with what you tried. ` +
            `Wrong tab? list_tabs then activate_tab or navigate back — this refusal reset the streak.`,
        },
      };
    }
    const entry = this.seen.get(this.key(name, args));
    if (!entry || entry.repeats < RepeatGuard.BLOCK_AT_REPEATS) return { kind: "ok" };
    const calls = entry.repeats + 1;
    return {
      kind: "block",
      repeats: entry.repeats,
      result: {
        ok: false,
        error: "repeated_call_blocked",
        repeats: entry.repeats,
        hint:
          `Refused: ${name} has already been called ${calls}× with these exact arguments ` +
          `and returned the same result each time. ${alternativesFor(name, args)}`,
      },
    };
  }

  /**
   * Record an outcome for the identical-call guard only.
   * Observation-batch streak is updated via {@link finalizeObservationBatch}.
   */
  record(name: string, args: Record<string, unknown>, result: unknown): RepeatVerdict {
    // Re-polling a mutating surface is normal; only flag it when the *result*
    // is byte-identical, which means nothing was learned.
    const key = this.key(name, args);
    const fp = fingerprint(result);
    const prev = this.seen.get(key);

    if (!prev || prev.fingerprint !== fp) {
      this.seen.set(key, { repeats: 0, fingerprint: fp });
      return { kind: "ok" };
    }
    const repeats = prev.repeats + 1;
    this.seen.set(key, { repeats, fingerprint: fp });
    if (repeats >= RepeatGuard.WARN_AT_REPEATS) {
      return {
        kind: "warn",
        repeats,
        note:
          `Repeated call: ${name} with these exact arguments returned an identical result ${repeats + 1}× ` +
          `— you learned nothing new. ${alternativesFor(name, args)}` +
          (POLLING_TOOLS.has(name) ? " If you are waiting for the page to change, wait() first." : "") +
          ` One more identical call will be refused.`,
      };
    }
    return { kind: "ok" };
  }

  /**
   * Call once per executed tool batch (parallel non-sensitive tools, or one
   * sensitive tool). Counts +1 for an observation-only batch; resets on any
   * mutation. Returns warn to annotate onto the last tool result in the batch.
   */
  finalizeObservationBatch(toolNames: string[]): RepeatVerdict {
    if (toolNames.length === 0) return { kind: "ok" };
    const allObservation = toolNames.every((n) => OBSERVATION_TOOLS.has(n));
    if (!allObservation) {
      this.observationBatches = 0;
      this.waitInStreak = false;
      return { kind: "ok" };
    }
    this.observationBatches += 1;
    if (toolNames.some((n) => n === "wait")) this.waitInStreak = true;
    if (this.observationBatches >= RepeatGuard.STUCK_WARN_AT) {
      return {
        kind: "warn",
        repeats: this.observationBatches,
        note:
          `ACT NOW — ${this.observationBatches} read-only turns with zero clicks/types/navigation. ` +
          `Batching more reads in the next turn still counts as recon. ` +
          `Pick the most plausible control and click it (the result reports dialogOpened — a wrong click is cheap and ` +
          `teaches more than another read), or map the form with list_form_fields, or scope with within:{text:"…"}. ` +
          `Do NOT take another broad read. If nothing is clickable for your goal, tell the user exactly what is ` +
          `blocking you instead of reading on. (Deliberately waiting? keep using wait() — that never blocks.)`,
      };
    }
    return { kind: "ok" };
  }

  /** Attach a repeat nudge to an object result without hiding its payload. */
  static annotate(result: unknown, note: string): unknown {
    if (result && typeof result === "object" && !Array.isArray(result)) {
      return { ...(result as Record<string, unknown>), _repeat: note };
    }
    return { value: result, _repeat: note };
  }
}

/**
 * Surface silent redirects. `navigate({url:"/app-content"})` landing on
 * `/app-list` used to look like success; the agent then re-read the wrong page.
 */
export function annotateRedirect(requested: string, result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const obj = result as Record<string, unknown>;
  const landed = typeof obj.url === "string" ? obj.url : undefined;
  if (!landed || !requested) return result;
  if (samePage(requested, landed)) return result;
  return {
    ...obj,
    redirected: true,
    requestedUrl: requested,
    hint:
      `Redirected: you asked for ${requested} but landed on ${landed}. ` +
      `That path is probably gated or renamed — do not retry the same URL. ` +
      `Navigate from the UI instead (get_interactive({filter:"…"}) then click_index).`,
  };
}

function samePage(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const parsed = new URL(u, "https://x.invalid");
      return `${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`.toLowerCase();
    } catch {
      return u.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
    }
  };
  return norm(a) === norm(b);
}
