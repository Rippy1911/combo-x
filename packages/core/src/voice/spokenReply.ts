export const SPOKEN_WORD_CAP = 40;

export const COMBO_VOICE_SYSTEM_ADDON =
  "Your reply will be spoken aloud. Answer in at most 2 short sentences. " +
  "No markdown, no URLs, no code. Confirm the action taken in plain language.";

/** @deprecated use COMBO_VOICE_SYSTEM_ADDON */
export const JARVIS_VOICE_SYSTEM_ADDON = COMBO_VOICE_SYSTEM_ADDON;

export function toSpokenReply(markdown: string, opts?: { wordCap?: number }): string {
  const wordCap = opts?.wordCap ?? SPOKEN_WORD_CAP;
  let s = markdown ?? "";

  // Drop fenced code blocks entirely.
  s = s.replace(/```[\s\S]*?```/g, " ");
  // Links → label only.
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Bare URLs → "link".
  s = s.replace(/https?:\/\/\S+/gi, "link");
  // Strip inline backticks, emphasis, heading markers, list bullets.
  s = s.replace(/`([^`]*)`/g, "$1");
  s = s.replace(/(\*\*|__)(.*?)\1/g, "$2");
  s = s.replace(/(\*|_)(.*?)\1/g, "$2");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\s*\d+\.\s+/gm, "");
  s = s.replace(/\s+/g, " ").trim();

  const rawWords = s.split(" ").filter(Boolean);
  const words = rawWords.map((w) =>
    w.length > 40 && !/\s/.test(w) ? "a long value" : w,
  );

  if (words.length <= wordCap) {
    return words.join(" ");
  }

  const capped = words.slice(0, wordCap);
  // Prefer last sentence boundary within the cap.
  let cut = capped.length;
  for (let i = capped.length - 1; i >= 0; i--) {
    if (/[.!?]$/.test(capped[i]!)) {
      cut = i + 1;
      break;
    }
  }
  const out = capped.slice(0, cut).join(" ");
  if (/[.!?…]$/.test(out)) return out;
  return out + "…";
}
