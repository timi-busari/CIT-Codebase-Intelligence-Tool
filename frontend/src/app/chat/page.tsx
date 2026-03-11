"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/Header";
import { ChatPanel } from "@/components/ChatPanel";
import { api, Repo, Conversation, Message } from "@/lib/api";

function ChatInner() {
  const params = useSearchParams();
  const convId = params.get("conv") ?? undefined;

  const [state, setState] = useState<{
    repos: Repo[];
    selectedRepos: string[];
    conversation: Conversation | null;
    convIdState: string | undefined;
  }>({ repos: [], selectedRepos: [], conversation: null, convIdState: convId });

  useEffect(() => {
    api
      .listRepos()
      .then((r) =>
        setState((s) => ({
          ...s,
          repos: r.filter((x) => x.status === "done"),
        })),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (convId) {
      api
        .getConversation(convId)
        .then((c) => setState((s) => ({ ...s, conversation: c, convIdState: convId })))
        .catch(() => {});
    }
  }, [convId]);

  const handleMessagesChange = useCallback(
    async (msgs: Message[]) => {
      if (msgs.length === 0) return;
      if (!state.convIdState) {
        try {
          const conv = await api.createConversation({
            title: msgs[0]?.content?.slice(0, 60) ?? "New Chat",
            repoIds: state.selectedRepos,
            messages: msgs,
          });
          setState((s) => ({ ...s, convIdState: conv.id }));
          window.history.replaceState({}, "", `/chat?conv=${conv.id}`);
        } catch {
          /* background save */
        }
      } else {
        try {
          await api.updateConversation(state.convIdState, { messages: msgs });
        } catch {
          /* background save */
        }
      }
    },
    [state.convIdState, state.selectedRepos],
  );

  return (
    <>
      <Header
        title={state.conversation?.title ?? "Chat"}
        actions={
          state.repos.length > 0 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.8rem",
              }}
            >
              <span style={{ color: "var(--text-muted)" }}>Repos:</span>
              {state.repos.map((r) => (
                <button
                  key={r.id}
                  className={`btn btn-sm ${state.selectedRepos.includes(r.id) ? "btn-primary" : "btn-secondary"}`}
                  onClick={() =>
                    setState((s) => ({
                      ...s,
                      selectedRepos: s.selectedRepos.includes(r.id)
                        ? s.selectedRepos.filter((x) => x !== r.id)
                        : [...s.selectedRepos, r.id],
                    }))
                  }
                >
                  {r.name}
                </button>
              ))}
              {state.selectedRepos.length > 0 && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setState((s) => ({ ...s, selectedRepos: [] }))}
                >
                  Clear
                </button>
              )}
            </div>
          ) : null
        }
      />
      {/* BUG-006: Don't mount ChatPanel until conversation is loaded; otherwise
           useState(initialMessages) captures [] and never re-syncs. */}
      {!convId || state.conversation !== null ? (
        <ChatPanel
          repoIds={
            state.selectedRepos.length > 0 ? state.selectedRepos : undefined
          }
          conversationId={state.convIdState}
          onMessagesChange={handleMessagesChange}
          initialMessages={state.conversation?.messages ?? []}
        />
      ) : (
        <div className="page">
          <span className="spinner" />
        </div>
      )}
    </>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="spinner" />
        </div>
      }
    >
      <ChatInner />
    </Suspense>
  );
}
