import type { ToolDefinition } from "../llm/openrouter.js";
import type { ContentRequest } from "../protocol/messages.js";

/** Tool schemas exposed to the LLM. */
export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_page",
      description:
        "Read the active tab: title, URL, and visible text (truncated). Use first to understand the page.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_links",
      description: "List links on the active page (text + href).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max links (default 30)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "click",
      description: "Click an element matching a CSS selector on the active page.",
      parameters: {
        type: "object",
        properties: { selector: { type: "string" } },
        required: ["selector"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Type into an input/textarea matching a CSS selector.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          text: { type: "string" },
          submit: { type: "boolean", description: "Press Enter after typing" },
        },
        required: ["selector", "text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract",
      description: "Extract text or an attribute from elements matching a CSS selector.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          attribute: { type: "string", description: "Optional attribute name (e.g. href)" },
        },
        required: ["selector"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tabs",
      description: "List open browser tabs (id, title, url).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description: "Save a fact or note into local persistent memory.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall",
      description: "Search local memory for relevant notes.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

export function toolArgsToContentRequest(
  name: string,
  args: Record<string, unknown>,
): ContentRequest | null {
  switch (name) {
    case "get_page":
      return { op: "get_page" };
    case "get_links":
      return {
        op: "get_links",
        limit: typeof args.limit === "number" ? args.limit : 30,
      };
    case "click":
      if (typeof args.selector !== "string") return null;
      return { op: "click", selector: args.selector };
    case "type_text":
      if (typeof args.selector !== "string" || typeof args.text !== "string") return null;
      return {
        op: "type_text",
        selector: args.selector,
        text: args.text,
        submit: Boolean(args.submit),
      };
    case "extract":
      if (typeof args.selector !== "string") return null;
      return {
        op: "extract",
        selector: args.selector,
        attribute: typeof args.attribute === "string" ? args.attribute : undefined,
      };
    default:
      return null;
  }
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
