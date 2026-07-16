import {
  AgentLoop,
  MemoryStore,
  OpenRouterClient,
  Vault,
  getProtocolVersion,
  type AgentEvent,
  type ChatMessage,
  type LlmUsage,
} from "@combo-x/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createChromeBridge } from "../lib/chrome-bridge";

const DEFAULT_MODEL = "x-ai/grok-4.5-fast";
const KEY_LABEL = "openrouter_api_key";

type UiMessage =
  | { id: string; role: "user" | "assistant"; content: string }
  | { id: string; role: "system"; content: string };

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

export function App() {
  const vault = useMemo(() => new Vault(), []);
  const memory = useMemo(() => new MemoryStore(), []);
  const bridge = useMemo(() => createChromeBridge(), []);

  const [ready, setReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [sessionUsage, setSessionUsage] = useState<LlmUsage>({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  });
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      const initialized = await vault.isInitialized();
      setNeedsOnboarding(!initialized);
      setReady(true);
    })();
  }, [vault]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const unlockExisting = useCallback(async () => {
    const ok = await vault.unlock(passphrase);
    if (!ok) {
      setStatus("Wrong passphrase");
      return;
    }
    const key = await vault.getByLabel(KEY_LABEL);
    if (!key) {
      setNeedsOnboarding(true);
      setStatus("Vault unlocked but no API key — paste OpenRouter key");
      return;
    }
    setApiKey(key);
    setNeedsOnboarding(false);
    setStatus("Unlocked");
  }, [passphrase, vault]);

  const completeOnboarding = useCallback(async () => {
    if (!passphrase || !apiKey.trim()) {
      setStatus("Passphrase + OpenRouter key required");
      return;
    }
    const initialized = await vault.isInitialized();
    if (!initialized) {
      await vault.setPassphrase(passphrase);
      await vault.put(KEY_LABEL, apiKey.trim());
    } else {
      const ok = await vault.unlock(passphrase);
      if (!ok) {
        setStatus("Wrong passphrase");
        return;
      }
      // replace key if present — simple path: put new entry (list may grow; ok for v0.1)
      await vault.put(KEY_LABEL, apiKey.trim());
    }
    setNeedsOnboarding(false);
    setStatus("Ready — ask me about the active tab");
  }, [apiKey, passphrase, vault]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setStatus("Stopped");
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || running) return;
    if (!vault.isUnlocked()) {
      setStatus("Unlock vault first");
      return;
    }
    const key = apiKey || (await vault.getByLabel(KEY_LABEL));
    if (!key) {
      setStatus("Missing OpenRouter key");
      return;
    }

    setInput("");
    const userMsg: UiMessage = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    setRunning(true);
    setStatus("Starting…");

    const controller = new AbortController();
    abortRef.current = controller;

    const llm = new OpenRouterClient({ apiKey: key });
    const agent = new AgentLoop(llm, bridge, memory);
    const assistantId = crypto.randomUUID();
    setMessages((m) => [...m, { id: assistantId, role: "assistant", content: "" }]);

    const onEvent = (event: AgentEvent) => {
      if (event.type === "status" && event.message) setStatus(event.message);
      if (event.type === "tool_start") {
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `⚙ ${event.tool}(${JSON.stringify(event.args ?? {})})`,
          },
        ]);
      }
      if (event.type === "tool_result") {
        const preview = JSON.stringify(event.result).slice(0, 280);
        setMessages((m) => [
          ...m,
          { id: crypto.randomUUID(), role: "system", content: `↳ ${preview}` },
        ]);
      }
      if (event.type === "assistant_delta" && event.message) {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId && msg.role === "assistant"
              ? { ...msg, content: event.message ?? "" }
              : msg,
          ),
        );
      }
      if (event.type === "error" && event.message) setStatus(event.message);
      if (event.usage) {
        setSessionUsage((u: LlmUsage) => ({
          promptTokens: u.promptTokens + event.usage!.promptTokens,
          completionTokens: u.completionTokens + event.usage!.completionTokens,
          totalTokens: u.totalTokens + event.usage!.totalTokens,
          estimatedCostUsd: u.estimatedCostUsd + event.usage!.estimatedCostUsd,
        }));
      }
    };

    try {
      const result = await agent.run({
        model,
        userMessage: text,
        history: historyRef.current,
        signal: controller.signal,
        onEvent,
      });
      historyRef.current = result.messages.filter((m: ChatMessage) => m.role !== "system");
      if (!result.finalText) {
        // ensure bubble has something if only tools ran
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId && msg.role === "assistant" && !msg.content
              ? { ...msg, content: "(no text — see tool results)" }
              : msg,
          ),
        );
      } else {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId && msg.role === "assistant"
              ? { ...msg, content: result.finalText }
              : msg,
          ),
        );
      }
      setStatus(result.aborted ? "Stopped" : "Done");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "system", content: `Error: ${msg}` },
      ]);
      setStatus("Error");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [apiKey, bridge, input, memory, model, running, vault]);

  if (!ready) {
    return (
      <div className="app">
        <div className="onboarding">
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (needsOnboarding) {
    return (
      <div className="app">
        <header className="header">
          <div className="brand">
            Combo<span>-X</span>
          </div>
          <div className="meta">v{getProtocolVersion()}</div>
        </header>
        <div className="onboarding">
          <h1>Local agent. Your keys.</h1>
          <p>
            Encrypted vault + OpenRouter BYOK + real page tools. Nothing leaves your machine except
            the model calls you pay for.
          </p>
          <label className="hint">Master passphrase</label>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="passphrase"
            autoComplete="new-password"
          />
          <label className="hint">OpenRouter API key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-or-v1-…"
            autoComplete="off"
          />
          <div className="row">
            <button type="button" className="primary" onClick={() => void completeOnboarding()}>
              Start
            </button>
            <button type="button" onClick={() => void unlockExisting()}>
              Unlock existing
            </button>
          </div>
          {status ? <p className="hint">{status}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          Combo<span>-X</span>
        </div>
        <div className="meta">
          {formatUsd(sessionUsage.estimatedCostUsd)} · {sessionUsage.totalTokens} tok
        </div>
      </header>

      <div className="messages">
        {messages.length === 0 ? (
          <div className="bubble system">
            Try: “Summarize this page” or “List the main links and remember the site name”.
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {status && running ? <div className="bubble system">{status}</div> : null}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <div className="row">
          <input
            style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            title="OpenRouter model id"
          />
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the active tab…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="row">
          <button type="button" className="primary" disabled={running || !input.trim()} onClick={() => void send()}>
            Send
          </button>
          <button type="button" className="danger" disabled={!running} onClick={stop}>
            STOP
          </button>
          <span className="hint" style={{ marginLeft: "auto" }}>
            ⌘↵ send
          </span>
        </div>
      </div>
    </div>
  );
}
