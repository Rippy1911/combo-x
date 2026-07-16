import type { ToolDefinition } from "../llm/openrouter.js";
import type { ContentRequest } from "../protocol/messages.js";

/** Tool schemas exposed to the LLM. */
export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_page",
      description:
        "Read the active tab. Prefer page_digest in budget mode. mode=snippet|structure|full; maxChars caps text. Prefer extract/query_all for fields.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["snippet", "structure", "full"] },
          maxChars: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "page_digest",
      description:
        "Cheap page map: title, url, headings, EAN/catalog label hits, short main sample — NOT full nav chrome. Prefer this over get_page for PDPs/invoices.",
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
      name: "get_interactive",
      description:
        "Compact indexed list of clickable/inputs (prefer over guessing CSS). Then use click_index / type_index.",
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
      name: "click_index",
      description: "Click interactive element by index from the last get_interactive on this page.",
      parameters: {
        type: "object",
        properties: { index: { type: "number" } },
        required: ["index"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type_index",
      description: "Type into interactive element by index from get_interactive.",
      parameters: {
        type: "object",
        properties: {
          index: { type: "number" },
          text: { type: "string" },
          submit: { type: "boolean" },
        },
        required: ["index", "text"],
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
      name: "query_all",
      description:
        "Batch extract nodes by CSS into {text,href,attrs[]} — efficient for product cards / EAN lists.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          limit: { type: "number" },
          attributes: { type: "array", items: { type: "string" } },
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
        "Extract HTML tables from the page as row arrays. Optional CSS selector.",
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
      name: "scroll",
      description: "Scroll the page or a container (up/down/top/bottom/percent).",
      parameters: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["up", "down", "top", "bottom", "percent"],
          },
          percent: { type: "number" },
          selector: { type: "string" },
        },
        required: ["direction"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "wait",
      description: "Wait up to 10s for page settle after navigation/click.",
      parameters: {
        type: "object",
        properties: { ms: { type: "number" } },
        required: ["ms"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_text",
      description: "Search visible text; optionally scroll first match into view.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          scrollIntoView: { type: "boolean" },
          limit: { type: "number" },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate the active tab to a URL (same tab).",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "go_back",
      description: "Browser history back in the active tab.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
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
      description: "Open a URL in a new tab and focus it.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "https URL" } },
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
      name: "close_tab",
      description: "Close a tab by id from list_tabs.",
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
      name: "parse_data",
      description:
        "Cheap worker LLM: extract structured JSON rows from text (or current page) for a given intent. Use after query_all/scrape_tables/get_page — do not dump huge HTML into the orchestrator.",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            description: "What to extract, e.g. product name, EAN, price",
          },
          text: { type: "string", description: "Raw text to parse; omit if use_page" },
          use_page: {
            type: "boolean",
            description: "If true, read truncated visible page text first",
          },
          schema_hint: {
            type: "string",
            description: "Optional JSON shape hint, e.g. [{name,ean,price}]",
          },
        },
        required: ["intent"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rag_search",
      description:
        "Search the locally granted repo folder index (device RAG). Returns path + scored snippets. Prefer this for codebase questions when a folder is granted.",
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
      name: "rag_read_file",
      description: "Read a file path from the local RAG index (relative path from grant root).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          maxChars: { type: "number" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rag_status",
      description: "Local RAG index status (folder name, file/chunk counts, last indexed).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_attachments",
      description:
        "List files the user uploaded in chat (PDF, CSV, XLSX, txt, images). Prefer read_attachment for full text.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Optional session filter" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_attachment",
      description:
        "Read extracted text from an uploaded chat attachment by id or filename. Images are vision-attached on upload; this returns a short note for images.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Attachment id (preferred)" },
          name: { type: "string", description: "Filename if id unknown" },
          maxChars: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_csv",
      description: "Download rows as CSV (after scrape / parse_data).",
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
      name: "save_view",
      description:
        "Save a named table view (rows snapshot) to the Views tab for later reopen / export / charts. Prefer after scrape_catalog or parse_data.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          rows: {
            type: "array",
            items: { type: "array", items: { type: "string" } },
            description: "Header row first, then data rows",
          },
          columns: { type: "array", items: { type: "string" } },
          filter: { type: "string" },
          note: { type: "string" },
          chart: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["bar", "line"] },
              valueColumn: { type: "number" },
              labelColumn: { type: "number" },
            },
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_views",
      description: "List saved Views (name, id, row counts).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_view",
      description: "Load a saved view by id or name (returns row snapshot, capped).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
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
      description: "Create a local reminder (chrome notification when due).",
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
      description: "Create a local HTML report and download it.",
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
      description:
        "Save a durable agent memory. scope=global (all agents) or scope=agent (this profile). Memories are always prepended to the next user turn (not mid-stream).",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          scope: {
            type: "string",
            enum: ["global", "agent"],
            description: "global = shared; agent = bound to agentId (defaults to active agent)",
          },
          agentId: {
            type: "string",
            description: "Required for scope=agent when no active agent is set",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "Alias of remember — persist agent memory (global or per-agent). Always prepended on the next user turn, never mid-stream.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          scope: { type: "string", enum: ["global", "agent"] },
          agentId: { type: "string" },
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
      description: "Search local memory (global + active agent) for relevant notes.",
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
      name: "memory_list",
      description:
        "List recent durable local memories (same store as remember/recall / first-turn inject). Use after writes to refresh.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "skill_search",
      description:
        "Search on-demand skills (playbooks). Returns name/description/toolHints only — does NOT unlock tools. Call skill_read to load body and unlock gated tools for this run.",
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
      name: "skill_read",
      description:
        "Load a skill body by id and unlock its toolHints (skill-gated tools) for the rest of this user turn. Skill name/description are already in the system skill index — use this for the full body + unlocks.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string", description: "Optional name lookup if id unknown" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "skill_save",
      description: "Create or update a skill (playbook). scope=global|agent. Use when this tool is in the ceiling.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          body: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          scope: { type: "string", enum: ["global", "agent"] },
          agentId: { type: "string" },
          toolHints: { type: "array", items: { type: "string" } },
        },
        required: ["name", "description", "body"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_custom_tools",
      description: "List user-defined custom tools (schemas merged into the tool list).",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "custom_tool_save",
      description:
        "Create or update a user-defined custom tool (name/description/JSON-schema parameters). kind=guide|echo. Requires this tool in the ceiling.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: {
            type: "string",
            description: "snake_case tool name matching /^[a-z][a-z0-9_]{1,63}$/",
          },
          description: { type: "string" },
          parametersJson: {
            type: "string",
            description: "JSON string of OpenAI function.parameters schema object",
          },
          kind: { type: "string", enum: ["guide", "echo"] },
          handlerNote: { type: "string" },
        },
        required: ["name", "description"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_site_profile",
      description:
        "Save a site login + scrape recipe to the encrypted vault as site_profile:<name>. Set up once, then login/scrape_catalog reuse it without re-entering. Example: {name:'foodwell', loginUrl, username, password, usernameSelector, passwordSelector, submitSelector, selector, nextSelector|nextText, intent}.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          loginUrl: { type: "string" },
          username: { type: "string" },
          password: { type: "string" },
          usernameSelector: { type: "string" },
          passwordSelector: { type: "string" },
          submitSelector: { type: "string" },
          selector: { type: "string", description: "CSS for product cards/rows" },
          nextSelector: { type: "string", description: "CSS for the next-page button" },
          nextText: { type: "string", description: "Text to find+click for next page (alt to nextSelector)" },
          intent: { type: "string", description: "parse_data intent for one page's items" },
          schemaHint: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_site_profile",
      description: "Read a saved site profile (login + scrape recipe) from the vault.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "login",
      description:
        "Log into a site using a saved profile (by name) or inline selectors. Fills username+password and clicks submit. Approval-gated.",
      parameters: {
        type: "object",
        properties: {
          profile: { type: "string", description: "Saved profile name" },
          loginUrl: { type: "string" },
          username: { type: "string" },
          password: { type: "string" },
          usernameSelector: { type: "string" },
          passwordSelector: { type: "string" },
          submitSelector: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scrape_catalog",
      description:
        "Paginate a whole catalog in ONE call: per page query_all(selector) → parse_data(intent) (cheap worker) → accumulate rows → click nextSelector/find nextText → repeat. Dedupes rows. Returns {rows, pages, count}. Use a saved profile for defaults or pass args directly.",
      parameters: {
        type: "object",
        properties: {
          profile: { type: "string", description: "Saved profile name for defaults" },
          selector: { type: "string", description: "CSS for one product card/row" },
          intent: { type: "string", description: "parse_data intent per page" },
          nextSelector: { type: "string" },
          nextText: { type: "string" },
          schemaHint: { type: "string" },
          maxPages: { type: "number", description: "Cap (1-100, default 20)" },
        },
        required: ["selector", "intent"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ensure_scrape_table",
      description:
        "Create or open a durable scrape table in Views (IndexedDB). Call BEFORE navigating PDPs so rows persist each step.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "View name e.g. foodwell-ean-map" },
          columns: {
            type: "array",
            items: { type: "string" },
            description: "Header columns e.g. ean,packagedEan,sap,name,qty_per_box",
          },
          keyColumns: {
            type: "array",
            items: { type: "string" },
            description: "Columns used for upsert merge (default first column)",
          },
        },
        required: ["name", "columns"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_scrape_rows",
      description: "Merge rows into a scrape table by key columns. Call after every successful PDP.",
      parameters: {
        type: "object",
        properties: {
          viewId: { type: "string", description: "View id or name" },
          rows: {
            type: "array",
            items: { type: "array", items: { type: "string" } },
            description: "Data rows (no header) matching ensure_scrape_table columns",
          },
          keyColumns: { type: "array", items: { type: "string" } },
        },
        required: ["viewId", "rows"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_scrape_table",
      description: "Read current scrape table rows (progress check).",
      parameters: {
        type: "object",
        properties: {
          viewId: { type: "string" },
          limit: { type: "number" },
        },
        required: ["viewId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scrape_pdps",
      description:
        "Batch scrape product pages in ONE tool turn: for each SAP or URL → navigate → page_digest → upsert row. Prefer over N× get_page. Creates the view if missing.",
      parameters: {
        type: "object",
        properties: {
          saps: { type: "array", items: { type: "string" }, description: "Catalog/SAP codes → /s/{sap}" },
          urls: { type: "array", items: { type: "string" } },
          baseUrl: {
            type: "string",
            description: "Origin for /s/{sap} (default current tab origin)",
          },
          viewName: { type: "string", description: "Default scrape-pdps" },
          columns: {
            type: "array",
            items: { type: "string" },
            description: "Default ean,packagedEan,sap,title,url",
          },
          keyColumns: { type: "array", items: { type: "string" } },
          waitMs: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rest_request",
      description:
        "Call a configured REST connector (Settings → Connectors). Headers resolve vault secret refs. No hardcoded hosts.",
      parameters: {
        type: "object",
        properties: {
          connectorId: { type: "string" },
          method: { type: "string" },
          path: { type: "string" },
          query: { type: "object", additionalProperties: { type: "string" } },
          body: {},
        },
        required: ["connectorId", "path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mcp_list_tools",
      description: "List tools from a remote MCP connector (HTTP transport).",
      parameters: {
        type: "object",
        properties: { connectorId: { type: "string" } },
        required: ["connectorId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mcp_call",
      description: "Call a tool on a remote MCP connector.",
      parameters: {
        type: "object",
        properties: {
          connectorId: { type: "string" },
          tool: { type: "string" },
          arguments: { type: "object", additionalProperties: true },
        },
        required: ["connectorId", "tool"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ux_critique",
      description:
        "Capture the current page (or a component) and attach it for vision UX critique. Always-on — does not require combo-media. Prefer this over raw screenshot_* for design feedback. Runtime attaches the image for the next model turn (or a vision worker if the orchestrator lacks vision).",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["viewport", "element", "full"],
            description: "What to capture (default viewport)",
          },
          selector: { type: "string", description: "CSS selector when scope=element" },
          index: { type: "number", description: "Interactive index when scope=element" },
          focus: {
            type: "string",
            description: "Optional critique focus, e.g. hero CTA, mobile nav, form density",
          },
          detail: {
            type: "string",
            enum: ["auto", "low", "high"],
            description: "Image detail for vision (default from settings, usually low)",
          },
          tabId: { type: "number" },
          windowId: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_preview",
      description:
        "Show a non-blocking preview inside chat (and side drawer): table, HTML prototype, text, image, or before/after compare. Use after UX critique to display an interactive HTML redesign (sandbox allow-scripts) or a mock image.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["table", "html", "text", "image", "compare"],
          },
          title: { type: "string" },
          headers: { type: "array", items: { type: "string" } },
          rows: { type: "array", items: { type: "array" } },
          html: { type: "string", description: "HTML/CSS/JS prototype for kind=html" },
          text: { type: "string" },
          src: { type: "string", description: "image src (data: or https:)" },
          beforeSrc: { type: "string", description: "before image for kind=compare" },
          afterSrc: { type: "string", description: "after image for kind=compare" },
          interactive: {
            type: "boolean",
            description: "For html: allow scripts in sandbox (default from settings)",
          },
        },
        required: ["kind", "title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "screenshot_viewport",
      description:
        "Capture visible tab screenshot. Image is stored and vision-attached for the next model turn (not returned as base64 in the tool result). Unlock via skill_read combo-media, or prefer ux_critique.",
      parameters: {
        type: "object",
        properties: { windowId: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "screenshot_element",
      description: "Capture + crop an element by CSS selector or interactive index.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          index: { type: "number" },
          tabId: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "screenshot_full",
      description: "Best-effort full-page screenshot (scroll-stitch, capped).",
      parameters: {
        type: "object",
        properties: { tabId: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_recording",
      description: "Start tab screen recording (webm). Requires recent user gesture/approval.",
      parameters: {
        type: "object",
        properties: { tabId: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stop_recording",
      description: "Stop tab recording; download webm and/or return data URL.",
      parameters: {
        type: "object",
        properties: {
          download: { type: "boolean" },
          filename: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_agent",
      description:
        "Create a reusable agent profile. Prefer skill_gated (default when skills installed); autoPickTools true builds a static fat allowlist for expensive orch.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          goal: { type: "string", description: "Used for auto tool picking when autoPickTools is true" },
          systemPrompt: { type: "string" },
          orchestratorModel: { type: "string" },
          workerModel: { type: "string" },
          budgetMode: { type: "string", enum: ["normal", "budget"] },
          maxSteps: { type: "number" },
          toolMode: {
            type: "string",
            enum: ["skill_gated", "static"],
          },
          autoPickTools: {
            type: "boolean",
            description: "Default false when skills installed; true runs pickToolsForGoal",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_agent",
      description:
        "Update an agent profile (partial fields: systemPrompt, models, toolAllowlist, maxSteps, canDelegate, canSelfEdit, budgetMode).",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          name: { type: "string" },
          systemPrompt: { type: "string" },
          orchestratorModel: { type: "string" },
          workerModel: { type: "string" },
          toolAllowlist: { type: "array", items: { type: "string" } },
          connectorIds: { type: "array", items: { type: "string" } },
          budgetMode: { type: "string", enum: ["normal", "budget"] },
          approvalMode: { type: "string", enum: ["ask", "auto_llm", "auto_all"] },
          maxSteps: { type: "number" },
          canDelegate: { type: "boolean" },
          canSelfEdit: { type: "boolean" },
          nestingDepth: { type: "number" },
          ragEnabled: { type: "boolean" },
        },
        required: ["agentId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_agents",
      description: "List saved agent profiles (id, name, models, tool counts).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "spawn_subagent",
      description:
        "Run a focused sub-task in an isolated agent loop. Returns summary only — not full child messages.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string" },
          agentId: { type: "string", description: "Optional AgentProfile id" },
          tools: {
            type: "array",
            items: { type: "string" },
            description: "Tool allowlist override; default = parent tools minus spawn_subagent",
          },
          maxSteps: { type: "number" },
          budgetMode: { type: "string", enum: ["normal", "budget"] },
        },
        required: ["goal"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Create a task on the agent task board (todo/doing/done/blocked).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          sessionId: { type: "string" },
          note: { type: "string" },
          planMarkdown: { type: "string" },
          status: { type: "string", enum: ["todo", "doing", "done", "blocked"] },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "Update task status, title, note, or planMarkdown.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["todo", "doing", "done", "blocked"] },
          title: { type: "string" },
          note: { type: "string" },
          planMarkdown: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "List tasks filtered by session, status, or global-only scope.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          globalOnly: { type: "boolean" },
          status: { type: "string", enum: ["todo", "doing", "done", "blocked"] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_page_extension",
      description:
        "Create a MAIN-world page extension (userscript). Isolated from Combo DB. Starts as draft — approve then enable then inject. Source uses ComboX API: export/storage/log.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          source: { type: "string", description: "JavaScript body using ComboX" },
          patterns: {
            type: "array",
            items: { type: "string" },
            description: "URL match globs e.g. https://allegro.pl/*",
          },
          pattern: { type: "string" },
          runAt: { type: "string", enum: ["document_idle", "document_end", "document_start"] },
        },
        required: ["name", "source"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_page_extension",
      description: "Update page extension fields. Changing source resets approval to draft.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          source: { type: "string" },
          patterns: { type: "array", items: { type: "string" } },
          enabled: { type: "boolean" },
          runAt: { type: "string", enum: ["document_idle", "document_end", "document_start"] },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_page_extensions",
      description: "List page extensions (metadata; no full source).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_page_extension",
      description: "Get full page extension including source + bridge + hashes.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_page_extension",
      description: "Approve a draft page extension for injection (sensitive).",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "revoke_page_extension",
      description: "Revoke approval and disable a page extension.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inject_page_extension",
      description:
        "Inject approved+enabled page extension(s) into a tab (MAIN world). Omit id to inject all matching the tab URL.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          ids: { type: "array", items: { type: "string" } },
          tabId: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_page_extension_bridge",
      description:
        "ONLY path for page→host data. Set exportChannels + allowStorage, or clear:true. Without a bridge, page scripts cannot write host storage or export payloads.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          exportChannels: { type: "array", items: { type: "string" } },
          allowStorage: { type: "boolean" },
          maxPayloadBytes: { type: "number" },
          clear: { type: "boolean" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "page_ext_data_list",
      description: "List keys in an extension's isolated data store (not Combo sessions/vault).",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "page_ext_data_get",
      description: "Read isolated extension data (key or all:true). Agent bridge into Combo context.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          key: { type: "string" },
          all: { type: "boolean" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "page_ext_data_clear",
      description: "Clear all isolated data for a page extension.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_page_extension_audit",
      description: "Traceability: audit log for page extensions (create/approve/inject/export/…).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          limit: { type: "number" },
        },
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
      return {
        op: "get_page",
        mode:
          args.mode === "snippet" || args.mode === "structure" || args.mode === "full"
            ? args.mode
            : undefined,
        maxChars: typeof args.maxChars === "number" ? args.maxChars : undefined,
      };
    case "page_digest":
      return { op: "page_digest" };
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
    case "scroll": {
      const direction = String(args.direction ?? "");
      if (!["up", "down", "top", "bottom", "percent"].includes(direction)) return null;
      return {
        op: "scroll",
        direction: direction as "up" | "down" | "top" | "bottom" | "percent",
        percent: typeof args.percent === "number" ? args.percent : undefined,
        selector: typeof args.selector === "string" ? args.selector : undefined,
      };
    }
    case "wait":
      if (typeof args.ms !== "number") return null;
      return { op: "wait", ms: Math.min(Math.max(1, Math.floor(args.ms)), 10_000) };
    case "find_text":
      if (typeof args.text !== "string") return null;
      return {
        op: "find_text",
        text: args.text,
        scrollIntoView: Boolean(args.scrollIntoView),
        limit: typeof args.limit === "number" ? args.limit : 20,
      };
    case "get_interactive":
      return {
        op: "get_interactive",
        limit: typeof args.limit === "number" ? args.limit : 80,
      };
    case "click_index":
      if (typeof args.index !== "number") return null;
      return { op: "click_index", index: Math.floor(args.index) };
    case "type_index":
      if (typeof args.index !== "number" || typeof args.text !== "string") return null;
      return {
        op: "type_index",
        index: Math.floor(args.index),
        text: args.text,
        submit: Boolean(args.submit),
      };
    case "query_all":
      if (typeof args.selector !== "string") return null;
      return {
        op: "query_all",
        selector: args.selector,
        limit: typeof args.limit === "number" ? args.limit : 80,
        attributes: Array.isArray(args.attributes) ? args.attributes.map(String) : undefined,
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
