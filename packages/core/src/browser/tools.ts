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
        properties: { limit: { type: "number" } },
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
          submit: { type: "boolean" },
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
          attribute: { type: "string" },
        },
        required: ["selector"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scrape_tables",
      description:
        "Extract HTML tables from the page as row arrays (great for product/EAN lists). Optional CSS selector.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "Table selector, default all tables" },
          limit: { type: "number" },
        },
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
      name: "open_tab",
      description:
        "Open a URL in a new tab and focus it. Use this to go to allegro.pl, foodwell, etc.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "https URL" },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "activate_tab",
      description: "Focus an existing tab by id from list_tabs.",
      parameters: {
        type: "object",
        properties: { tabId: { type: "number" } },
        required: ["tabId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_csv",
      description:
        "Turn a 2D array of rows into a downloadable CSV (filename + rows). Use after scrape_tables or extract.",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string" },
          rows: {
            type: "array",
            items: { type: "array", items: { type: "string" } },
          },
        },
        required: ["filename", "rows"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_bookmark",
      description: "Save a bookmark (url + title + optional note) locally.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          note: { type: "string" },
        },
        required: ["url", "title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description: "Create a local reminder (fires via chrome notification when due, if permitted).",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          atIso: { type: "string", description: "ISO datetime" },
        },
        required: ["text", "atIso"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_report",
      description:
        "Create a local HTML report page (title + markdown-ish body). Returns a blob URL the user can open/download.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          bodyHtml: { type: "string" },
        },
        required: ["title", "bodyHtml"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_sessions",
      description: "Search past chat sessions by keyword.",
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
    case "scrape_tables":
      return {
        op: "scrape_tables",
        selector: typeof args.selector === "string" ? args.selector : undefined,
        limit: typeof args.limit === "number" ? args.limit : 20,
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

export function rowsToCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? "");
          if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        })
        .join(","),
    )
    .join("\n");
}
