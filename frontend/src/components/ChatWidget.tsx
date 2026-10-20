import { useEffect, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../api";

// html:false stops raw tags in a model reply from being injected into the page.
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

type ChatMessage = { role: "user" | "assistant"; text: string };
type PanelPosition = { left: number; top: number };
type Frame = PanelPosition & { width: number; height: number };
type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const VIEWPORT_MARGIN = 8;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 240;

const RESIZE_HANDLES: { edge: ResizeEdge; label: string; className: string }[] = [
  { edge: "n", label: "Resize top", className: "left-3 right-3 top-0 h-1.5 cursor-ns-resize" },
  { edge: "s", label: "Resize bottom", className: "left-3 right-3 bottom-0 h-1.5 cursor-ns-resize" },
  { edge: "e", label: "Resize right", className: "right-0 top-3 bottom-3 w-1.5 cursor-ew-resize" },
  { edge: "w", label: "Resize left", className: "left-0 top-3 bottom-3 w-1.5 cursor-ew-resize" },
  { edge: "nw", label: "Resize top left", className: "left-0 top-0 h-3 w-3 cursor-nwse-resize" },
  { edge: "ne", label: "Resize top right", className: "right-0 top-0 h-3 w-3 cursor-nesw-resize" },
  { edge: "sw", label: "Resize bottom left", className: "left-0 bottom-0 h-3 w-3 cursor-nesw-resize" },
  { edge: "se", label: "Resize bottom right", className: "right-0 bottom-0 h-3 w-3 cursor-nwse-resize" },
];

function placeInView(left: number, top: number, width: number, height: number): PanelPosition {
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
  return {
    left: Math.min(Math.max(left, VIEWPORT_MARGIN), maxLeft),
    top: Math.min(Math.max(top, VIEWPORT_MARGIN), maxTop),
  };
}

function clampSize(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function resizeFrame(start: Frame, edge: ResizeEdge, dx: number, dy: number): Frame {
  let { left, top, width, height } = start;
  const right = left + width;
  const bottom = top + height;
  if (edge.includes("e")) width += dx;
  if (edge.includes("w")) width -= dx;
  if (edge.includes("s")) height += dy;
  if (edge.includes("n")) height -= dy;
  width = clampSize(width, MIN_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
  height = clampSize(height, MIN_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2);
  if (edge.includes("w")) left = right - width;
  if (edge.includes("n")) top = bottom - height;
  const placed = placeInView(left, top, width, height);
  return {
    left: placed.left,
    top: placed.top,
    width: Math.min(width, Math.max(MIN_WIDTH, window.innerWidth - placed.left - VIEWPORT_MARGIN)),
    height: Math.min(height, Math.max(MIN_HEIGHT, window.innerHeight - placed.top - VIEWPORT_MARGIN)),
  };
}

export function ChatWidget({ open, onOpen }: { open: boolean; onOpen: (open: boolean) => void }) {
  const { projectId } = useParams();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const resize = useRef<{ pointerId: number; edge: ResizeEdge; x: number; y: number; frame: Frame } | null>(null);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    function keepOnScreen() {
      const node = panel.current;
      if (!node) return;
      setFrame((current) => {
        if (!current) return current;
        const width = Math.min(current.width, Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2));
        const height = Math.min(current.height, Math.max(MIN_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2));
        return { ...placeInView(current.left, current.top, width, height), width, height };
      });
    }
    window.addEventListener("resize", keepOnScreen);
    return () => window.removeEventListener("resize", keepOnScreen);
  }, []);

  function startDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const node = panel.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture needs a real pointer; dragging still follows pointermove.
    }
  }

  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    const current = drag.current;
    const node = panel.current;
    if (!current || current.pointerId !== event.pointerId || !node) return;
    const width = frame?.width ?? node.offsetWidth;
    const height = frame?.height ?? node.offsetHeight;
    setFrame({ ...placeInView(event.clientX - current.offsetX, event.clientY - current.offsetY, width, height), width, height });
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  }

  function startResize(event: React.PointerEvent<HTMLElement>, edge: ResizeEdge) {
    if (event.button !== 0) return;
    const node = panel.current;
    if (!node) return;
    event.preventDefault();
    const rect = node.getBoundingClientRect();
    resize.current = {
      pointerId: event.pointerId,
      edge,
      x: event.clientX,
      y: event.clientY,
      frame: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture needs a real pointer; resizing still follows pointermove.
    }
  }

  function moveResize(event: React.PointerEvent<HTMLElement>) {
    const current = resize.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setFrame(resizeFrame(current.frame, current.edge, event.clientX - current.x, event.clientY - current.y));
  }

  function endResize(event: React.PointerEvent<HTMLElement>) {
    if (resize.current?.pointerId === event.pointerId) resize.current = null;
  }

  async function send() {
    const text = message.trim();
    if (!text || busy) return;
    const history = messages.map((item) => ({ role: item.role, content: item.text }));
    setMessage("");
    setMessages((current) => [...current, { role: "user", text }]);
    setBusy(true);
    try {
      const result = await api<{ reply: string; refused: boolean }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, project_id: projectId ?? null, history }),
      });
      setMessages((current) => [...current, { role: "assistant", text: result.reply }]);
    } catch (err) {
      const textReply = err instanceof ApiError ? err.message : "The chat request failed.";
      setMessages((current) => [...current, { role: "assistant", text: textReply }]);
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    if (busy) return;
    setMessages([]);
    setMessage("");
    setCopiedIndex(null);
  }

  async function copyReply(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      setCopiedIndex(null);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open chat"
        className="fixed bottom-4 left-4 z-40 h-12 w-12 rounded-full bg-cobalt text-on-cobalt shadow-glaze border border-hairline"
        onClick={() => onOpen(true)}
      >
        <span className="material-symbols-outlined">forum</span>
      </button>
    );
  }

  return (
    <section
      ref={panel}
      aria-label="Chat with analyst"
      className={`fixed z-40 flex flex-col rounded-lg border border-hairline bg-panel shadow-glaze ${frame ? "" : "bottom-4 left-4 w-[min(420px,calc(100vw-2rem))] h-[480px]"}`}
      style={frame ? { left: frame.left, top: frame.top, width: frame.width, height: frame.height } : undefined}
    >
      <header
        className="flex items-center justify-between px-3 py-2 border-b border-hairline cursor-grab touch-none select-none"
        title="Drag to move"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="font-headline font-semibold">Chat with analyst</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Clear chat"
            title="Clear chat"
            className="icon-btn"
            disabled={busy || (messages.length === 0 && !message.trim())}
            onClick={clearChat}
          >
            <span className="material-symbols-outlined text-base">delete_sweep</span>
          </button>
          <button type="button" aria-label="Close chat" title="Close" className="icon-btn" onClick={() => onOpen(false)}>
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      </header>
      <div ref={scroller} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-[0.703125rem] text-muted">Ask about this solution design or the knowledge inventory.</p>
        )}
        {messages.map((item, index) => (
          <div key={index} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}>
            {item.role === "user" ? (
              <p className="max-w-[85%] whitespace-pre-wrap break-words text-[0.703125rem] leading-relaxed px-3 py-2 rounded-2xl rounded-br-sm bg-cobalt text-on-cobalt">
                {item.text}
              </p>
            ) : (
              <div className="max-w-[85%] group relative">
                <div
                  className="chat-md break-words text-[0.703125rem] leading-relaxed px-3 py-2 rounded-2xl rounded-bl-sm bg-inset text-ink border border-hairline"
                  dangerouslySetInnerHTML={{ __html: markdown.render(item.text) }}
                />
                <button
                  type="button"
                  className="icon-btn mt-1 opacity-70 hover:opacity-100"
                  aria-label={copiedIndex === index ? "Copied" : "Copy response"}
                  title={copiedIndex === index ? "Copied" : "Copy response"}
                  onClick={() => void copyReply(item.text, index)}
                >
                  <span className="material-symbols-outlined text-base">{copiedIndex === index ? "check" : "content_copy"}</span>
                </button>
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <p className="text-[0.703125rem] text-accent bg-inset border border-hairline rounded-2xl rounded-bl-sm px-3 py-2">Thinking…</p>
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
          className="field flex-1 resize-none text-[0.703125rem] leading-relaxed"
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
      {RESIZE_HANDLES.map((handle) => (
        <button
          key={handle.edge}
          type="button"
          aria-label={handle.label}
          title="Drag to resize"
          className={`absolute z-10 border-0 bg-transparent p-0 touch-none ${handle.className}`}
          onPointerDown={(event) => startResize(event, handle.edge)}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        >
          {handle.edge === "se" && <span className="pointer-events-none absolute bottom-0.5 right-0.5 h-2 w-2 border-b-2 border-r-2 border-muted" />}
        </button>
      ))}
    </section>
  );
}
