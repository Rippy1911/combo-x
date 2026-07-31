/**
 * Voice panel visibility — hide when the browser cannot run mic/wake (no
 * chrome.offscreen), and honor an explicit Settings preference.
 */

export type VoicePanelMode = "auto" | "show" | "hide";

export const VOICE_PANEL_KEY = "combo_x_voice_panel";

/** True when MV3 offscreen + mic wake path can run (Chrome/Edge). Firefox = false. */
export function isVoiceMicSupported(
  chromeLike: { offscreen?: { createDocument?: unknown } } | undefined = (
    globalThis as { chrome?: { offscreen?: { createDocument?: unknown } } }
  ).chrome,
): boolean {
  try {
    return typeof chromeLike?.offscreen?.createDocument === "function";
  } catch {
    return false;
  }
}

export function parseVoicePanelMode(raw: string | null | undefined): VoicePanelMode {
  if (raw === "show" || raw === "hide" || raw === "auto") return raw;
  return "auto";
}

/**
 * - hide: never show the strip
 * - show: always show (Firefox gets Test Speech without wake)
 * - auto: show only when mic/wake is supported
 */
export function shouldShowVoicePanel(
  mode: VoicePanelMode,
  micSupported: boolean = isVoiceMicSupported(),
): boolean {
  if (mode === "hide") return false;
  if (mode === "show") return true;
  return micSupported;
}
