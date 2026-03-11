"use client";
import { useState, useRef, useEffect } from "react";
import { api, Message } from "@/lib/api";
import { BookmarkButton } from "./BookmarkButton";

interface ChatPanelProps {
  repoIds?: string[];
  conversationId?: string;
  onMessagesChange?: (msgs: Message[]) => void;
  initialMessages?: Message[];
}

export function ChatPanel({
  repoIds,
  conversationId,
  onMessagesChange,
  initialMessages = [],
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [ui, setUi] = useState({ input: "", loading: false });
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  const send = async () => {
    const q = ui.input.trim();
    if (!q || ui.loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: q,
    };
    setMessages((prev) => [...prev, userMsg]);
    setUi((s) => ({ ...s, input: "" }));
    setUi((s) => ({ ...s, loading: true }));

    try {
      // Send conversation history for context-aware follow-ups
      const historyMsgs = messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      const res = await api.query(q, repoIds, conversationId, historyMsgs);
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: res.answer,
        citations: res.citations,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setUi((s) => ({ ...s, loading: false }));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="chat-layout">
      {/* Messages */}
      <div className="messages-list">
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">💬</div>
            <div className="empty-state-title">Start a conversation</div>
            <p style={{ fontSize: "0.85rem" }}>
              Ask anything about the ingested codebase.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === "user" ? "👤" : "🤖"}
            </div>
            <div className="message-bubble">
              <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
              {msg.citations && msg.citations.length > 0 && (
                <div className="citations">
                  {msg.citations.map((c, i) => (
                    <span
                      key={i}
                      className="citation-chip"
                      title={`Lines ${c.startLine}-${c.endLine}`}
                    >
                      [{i + 1}] {c.filePath.split("/").pop()}:{c.startLine}
                    </span>
                  ))}
                </div>
              )}
              {msg.role === "assistant" && (
                <BookmarkButton
                  question={messages[messages.indexOf(msg) - 1]?.content ?? ""}
                  answer={msg.content}
                  sources={msg.citations}
                  repoIds={repoIds}
                />
              )}
            </div>
          </div>
        ))}
        {ui.loading && (
          <div className="message">
            <div className="message-avatar">🤖</div>
            <div
              className="message-bubble"
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                color: "var(--text-muted)",
              }}
            >
              <span className="spinner" /> Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <div className="chat-input-row">
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder="Ask a question about the codebase… (Enter to send, Shift+Enter for newline)"
            value={ui.input}
            onChange={(e) => setUi((s) => ({ ...s, input: e.target.value }))}
            onKeyDown={handleKeyDown}
            disabled={ui.loading}
            rows={1}
          />
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={ui.loading || !ui.input.trim()}
          >
            {ui.loading ? <span className="spinner" /> : "↑ Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
