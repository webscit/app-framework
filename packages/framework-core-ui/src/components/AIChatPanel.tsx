import { useEffect, useRef, useState } from "react";

import { ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Textarea } from "./ui/textarea";
import { LayoutDiffViewer } from "./LayoutDiffViewer";
import type { ShellLayout } from "../shellTypes";
import type { WidgetRegistry, WidgetDefinition } from "../widgetRegistry";
import "./AIChatPanel.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single message in the chat history.
 */
export interface ChatMessage {
  /** Unique identifier for React keys. */
  id: string;
  /** Who sent this message. */
  role: "user" | "assistant";
  /** Visible text content of the message. */
  content: string;
  /** AI-proposed layout, present only on assistant messages. */
  proposedLayout?: ShellLayout;
  /** Explanation from the AI for the proposed layout change. */
  layoutExplanation?: string;
  /** Whether the user approved the proposed layout. Undefined until acted on. */
  approved?: boolean;
}

/** A turn in the conversation history sent to the backend. */
interface ConversationTurn {
  user: string;
  assistant: string;
}

/**
 * Props for {@link AIChatPanel}.
 */
export interface AIChatPanelProps {
  /** Whether the Sheet panel is open. */
  open: boolean;
  /** Called when the open state changes. */
  onOpenChange: (open: boolean) => void;
  /** The current shell layout shown in the diff viewer. */
  currentLayout: ShellLayout;
  /** Called when the user approves a proposed layout. */
  onApplyLayout: (layout: ShellLayout) => void;
  /** Widget registry used to build the serialised catalog sent to the API. */
  registry: WidgetRegistry;
  /**
   * Base URL for the layout generation endpoint.
   * Defaults to `"/ai/layout"`.
   */
  apiUrl?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip the React factory function so the registry can be JSON-serialised. */
function serializeRegistry(
  registry: WidgetRegistry,
): Omit<WidgetDefinition, "factory">[] {
  return registry.list().map(({ factory: _factory, ...rest }) => rest);
}

let _nextId = 0;
function nextId(): string {
  return String(++_nextId);
}

// ─── TypingIndicator ──────────────────────────────────────────────────────────

/**
 * Animated three-dot typing indicator shown while the AI is responding.
 *
 * @returns Three pulsing dots.
 */
function TypingIndicator(): React.ReactElement {
  return (
    <div className="sct-AIChatPanel-typing" aria-label="AI is typing">
      <span />
      <span />
      <span />
    </div>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: ChatMessage;
  currentLayout: ShellLayout;
  onApprove: (messageId: string, layout: ShellLayout) => void;
  onReject: (messageId: string) => void;
}

/**
 * Renders a single chat message bubble.
 *
 * User messages are right-aligned; assistant messages are left-aligned.
 * Assistant messages that carry a `proposedLayout` include an inline
 * {@link LayoutDiffViewer} with Approve/Reject controls.
 *
 * @param props - {@link MessageBubbleProps}
 * @returns A styled message bubble element.
 */
function MessageBubble({
  message,
  currentLayout,
  onApprove,
  onReject,
}: MessageBubbleProps): React.ReactElement {
  const isUser = message.role === "user";
  const bubbleClass = isUser
    ? "sct-AIChatPanel-bubble sct-AIChatPanel-bubble--user"
    : "sct-AIChatPanel-bubble sct-AIChatPanel-bubble--assistant";

  const showDiff =
    message.proposedLayout !== undefined && message.approved === undefined;

  return (
    <div className={`sct-AIChatPanel-row sct-AIChatPanel-row--${message.role}`}>
      <div className={bubbleClass}>
        {/* Hide bubble text while the diff viewer is showing — the explanation
            is already rendered inside LayoutDiffViewer to avoid duplication. */}
        {!showDiff && <p className="sct-AIChatPanel-bubble-text">{message.content}</p>}

        {showDiff && message.proposedLayout && message.layoutExplanation && (
          <div className="sct-AIChatPanel-diff">
            <LayoutDiffViewer
              current={currentLayout}
              proposed={message.proposedLayout}
              explanation={message.layoutExplanation}
              onApprove={() => onApprove(message.id, message.proposedLayout!)}
              onReject={() => onReject(message.id)}
            />
          </div>
        )}

        {message.approved === true && (
          <p className="sct-AIChatPanel-status sct-AIChatPanel-status--approved">
            Layout applied.
          </p>
        )}
        {message.approved === false && (
          <p className="sct-AIChatPanel-status sct-AIChatPanel-status--rejected">
            Layout rejected.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── AIChatPanel ─────────────────────────────────────────────────────────────

/**
 * A slide-in Sheet panel providing a conversational interface for AI-driven
 * shell layout generation.
 *
 * The panel serialises the widget registry and the approved conversation history
 * and POSTs them to `POST /ai/layout`. When the AI proposes a layout, a
 * {@link LayoutDiffViewer} is rendered inline inside the assistant bubble so the
 * user can Approve or Reject the change. Only approved turns are included in
 * subsequent requests so rejected proposals do not pollute the AI's context.
 *
 * @param props - {@link AIChatPanelProps}
 * @returns The chat panel Sheet element.
 *
 * @example
 * ```tsx
 * <AIChatPanel
 *   open={chatOpen}
 *   onOpenChange={setChatOpen}
 *   currentLayout={layout}
 *   onApplyLayout={setLayout}
 *   registry={registry}
 * />
 * ```
 */
export function AIChatPanel({
  open,
  onOpenChange,
  currentLayout,
  onApplyLayout,
  registry,
  apiUrl = "/ai/layout",
}: AIChatPanelProps): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Only approved turns are forwarded to the AI in subsequent requests. */
  const approvedHistory = useRef<ConversationTurn[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to latest message on every change.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSend(): Promise<void> {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);

    const userMsg: ChatMessage = { id: nextId(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          history: approvedHistory.current,
          registry: serializeRegistry(registry),
          current_layout: currentLayout,
        }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(
          detail?.detail?.errors?.join("; ") ??
            `Request failed with status ${response.status}`,
        );
      }

      const data = (await response.json()) as {
        layout: ShellLayout;
        explanation: string;
      };

      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        content: data.explanation,
        proposedLayout: data.layout,
        layoutExplanation: data.explanation,
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Store raw assistant text for use in history if the user approves.
      // We keep the assistant message id so we can match it on approval.
      // Store it temporarily as a pending turn keyed by assistant message id.
      _pendingTurns.set(assistantMsg.id, {
        user: text,
        assistant: data.explanation,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function handleApprove(messageId: string, layout: ShellLayout): void {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, approved: true } : m)),
    );
    onApplyLayout(layout);

    const turn = _pendingTurns.get(messageId);
    if (turn) {
      approvedHistory.current = [...approvedHistory.current, turn];
      _pendingTurns.delete(messageId);
    }
  }

  function handleReject(messageId: string): void {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, approved: false } : m)),
    );
    _pendingTurns.delete(messageId);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="sct-AIChatPanel-sheet"
        showCloseButton={false}
      >
        <SheetHeader className="sct-AIChatPanel-header">
          <SheetTitle>AI Layout Assistant</SheetTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            className="sct-AIChatPanel-collapse"
            onClick={() => onOpenChange(false)}
            aria-label="Collapse chat panel"
          >
            <ChevronRight size={18} aria-hidden />
          </Button>
        </SheetHeader>

        <ScrollArea className="sct-AIChatPanel-messages">
          <div className="sct-AIChatPanel-messages-inner">
            {messages.length === 0 && (
              <p className="sct-AIChatPanel-empty">
                Describe the dashboard layout you want and I'll build it for you.
              </p>
            )}

            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                currentLayout={currentLayout}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}

            {loading && (
              <div className="sct-AIChatPanel-row sct-AIChatPanel-row--assistant">
                <div className="sct-AIChatPanel-bubble sct-AIChatPanel-bubble--assistant">
                  <TypingIndicator />
                </div>
              </div>
            )}

            {error && (
              <p className="sct-AIChatPanel-error" role="alert">
                {error}
              </p>
            )}

            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <div className="sct-AIChatPanel-input-row">
          <Textarea
            placeholder="Ask AI to build or modify your layout…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            rows={2}
            className="sct-AIChatPanel-textarea"
            aria-label="Chat input"
          />
          <Button
            onClick={() => void handleSend()}
            disabled={loading || input.trim() === ""}
            aria-label="Send message"
          >
            Send
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Module-level map for pending (not-yet-approved) conversation turns.
// Keyed by assistant message id.
const _pendingTurns = new Map<string, ConversationTurn>();
