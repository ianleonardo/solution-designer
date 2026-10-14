import { useEffect, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../api";

// html:false stops raw tags in a model reply from being injected into the page.
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function ChatWidget({ open, onOpen }: { open: boolean; onOpen: (open: boolean) => void }) {
  const { projectId } = useParams();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  async function send() {
    const text = message.trim();
    if (!text || busy) return;
    setMessage("");
    setMessages((current) => [...current, { role: "user", text }]);
    setBusy(true);
    try {
      const result = await api<{ reply: string; refused: boolean }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, project_id: projectId ?? null }),
      });
      setMessages((current) => [...current, { role: "assistant", text: result.reply }]);
    } catch (err) {
      const textReply = err instanceof ApiError ? err.message : "The chat request failed.";
      setMessages((current) => [...current, { role: "assistant", text: textReply }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open chat"
        className="fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full bg-cobalt text-on-cobalt shadow-glaze border border-hairline"
        onClick={() => onOpen(true)}
      >
        <span className="material-symbols-outlined">forum</span>
      </button>
    );
  }

  return (
    <section className="fixed bottom-4 right-4 z-40 w-[min(420px,calc(100vw-2rem))] h-[480px] flex flex-col rounded-lg border border-hairline bg-panel shadow-glaze">
      <header className="flex items-center justify-between px-3 py-2 border-b border-hairline">
        <span className="font-headline font-semibold">Chat with analyst</span>
        <button type="button" aria-label="Close chat" className="btn" onClick={() => onOpen(false)}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>
      <div ref={scroller} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-[0.5625rem] text-muted">Ask about this solution design or the knowledge inventory.</p>
        )}
        {messages.map((item, index) => (
          <div key={index} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}>
            {item.role === "user" ? (
              <p className="max-w-[85%] whitespace-pre-wrap break-words text-[0.5625rem] leading-relaxed px-3 py-2 rounded-2xl rounded-br-sm bg-cobalt text-on-cobalt">
                {item.text}
              </p>
            ) : (
              <div
                className="chat-md max-w-[85%] break-words text-[0.5625rem] leading-relaxed px-3 py-2 rounded-2xl rounded-bl-sm bg-inset text-ink border border-hairline"
                dangerouslySetInnerHTML={{ __html: markdown.render(item.text) }}
              />
            )}
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <p className="text-[0.5625rem] text-accent bg-inset border border-hairline rounded-2xl rounded-bl-sm px-3 py-2">Thinking…</p>
          </div>
        )}
      </div>
      <form
        className="p-3 border-t border-hairline flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          className="field flex-1 resize-none text-[0.5625rem] leading-relaxed"
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="Ask about the design (Enter to send, Shift+Enter for a new line)"
          aria-label="Chat message"
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Send
        </button>
      </form>
    </section>
  );
}
