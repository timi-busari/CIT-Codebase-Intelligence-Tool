"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { api, Message, Citation } from "@/lib/api";
import { BookmarkButton } from "./BookmarkButton";

interface CitationPanelProps {
  citations: Citation[];
}

function CitationPanel({ citations }: CitationPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!citations || citations.length === 0) return null;

  return (
    <div className="citation-panel">
      <button 
        className="citation-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="citation-count">
          {citations.length} source{citations.length > 1 ? 's' : ''}
        </span>
        <span className={`citation-arrow ${expanded ? 'expanded' : ''}`}>
          ▼
        </span>
      </button>
      
      {expanded && (
        <div className="citation-list">
          {citations.map((citation, i) => (
            <div key={i} className="citation-item">
              <div className="citation-header">
                <span className="citation-number">[{i + 1}]</span>
                <Link 
                  href={`/repos/${citation.repoId}/file?path=${encodeURIComponent(citation.filePath)}&line=${citation.startLine}`}
                  className="citation-link"
                  title="Open file at this location"
                >
                  <span className="citation-file">📄 {citation.filePath}</span>
                  <span className="citation-lines">
                    Lines {citation.startLine}
                    {citation.endLine !== citation.startLine && `-${citation.endLine}`}
                  </span>
                </Link>
              </div>
              {citation.snippet && (
                <div className="citation-snippet">
                  <code>{citation.snippet.length > 100 ? `${citation.snippet.slice(0, 100)}...` : citation.snippet}</code>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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

    // Create initial assistant message for streaming
    const assistantMsgId = (Date.now() + 1).toString();
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      citations: [],
    };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      // Send conversation history for context-aware follow-ups
      const historyMsgs = messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      let fullContent = "";
      let citations: Citation[] = [];
      
      for await (const chunk of api.queryStream(q, repoIds, conversationId, historyMsgs)) {
        if (chunk.error) {
          throw new Error(chunk.error);
        }
        if (chunk.token) {
          fullContent += chunk.token;
          // Update the assistant message with streaming content
          setMessages((prev) => 
            prev.map((msg) => 
              msg.id === assistantMsgId 
                ? { ...msg, content: fullContent + "█" } // Add cursor
                : msg
            )
          );
        }
        if (chunk.citations) {
          citations = chunk.citations;
        }
        if (chunk.done) {
          // Remove cursor and set final content with citations
          setMessages((prev) => 
            prev.map((msg) => 
              msg.id === assistantMsgId 
                ? { ...msg, content: fullContent, citations }
                : msg
            )
          );
          break;
        }
      }
    } catch (err: unknown) {
      // Replace the streaming message with error message
      const errContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      setMessages((prev) => 
        prev.map((msg) => 
          msg.id === assistantMsgId 
            ? { ...msg, content: errContent, citations: [] }
            : msg
        )
      );
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
                <CitationPanel citations={msg.citations} />
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
