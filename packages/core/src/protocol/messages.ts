import { z } from "zod";

/** Wire protocol between side panel ↔ service worker ↔ content script. */
export const PROTOCOL_VERSION = 1 as const;

export const BrowserToolNameSchema = z.enum([
  "get_page",
  "get_links",
  "click",
  "type_text",
  "extract",
  "remember",
  "recall",
  "list_tabs",
]);
export type BrowserToolName = z.infer<typeof BrowserToolNameSchema>;

export const ContentRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("get_page") }),
  z.object({ op: z.literal("get_links"), limit: z.number().int().positive().max(100).optional() }),
  z.object({ op: z.literal("click"), selector: z.string().min(1) }),
  z.object({
    op: z.literal("type_text"),
    selector: z.string().min(1),
    text: z.string(),
    submit: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("extract"),
    selector: z.string().min(1),
    attribute: z.string().optional(),
  }),
]);
export type ContentRequest = z.infer<typeof ContentRequestSchema>;

export const ContentResponseSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});
export type ContentResponse = z.infer<typeof ContentResponseSchema>;

export const RuntimeMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("content"),
    tabId: z.number().int().optional(),
    request: ContentRequestSchema,
  }),
  z.object({ type: z.literal("list_tabs") }),
  z.object({ type: z.literal("ping") }),
]);
export type RuntimeMessage = z.infer<typeof RuntimeMessageSchema>;

export function getProtocolVersion(): number {
  return PROTOCOL_VERSION;
}
