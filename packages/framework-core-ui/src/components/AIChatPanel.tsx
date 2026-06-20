import { useEffect, useRef, useState } from "react";

import { ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Textarea } from "./ui/textarea";
import { LayoutDiffViewer } from "./LayoutDiffViewer";
import { ParamDiffViewer } from "./ParamDiffViewer";
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
  /** AI-suggested parameter values, present when the request included a simulation snapshot. */
  suggestedParams?: Record<string, unknown>;
  /** The simulation's parameter values at the time this suggestion was made. */
  currentParamsSnapshot?: Record<string, unknown>;
  /** Whether the user approved the suggested params. Undefined until acted on. */
  paramsApproved?: boolean;
}

/** A turn in the conversation history sent to the backend. */
interface ConversationTurn {
  user: string;
  assistant: string;
}

/**
 * Optional simulation data attached to every chat request.
 *
 * Returned by the {@link AIChatPanelProps.getSnapshot} callback so the AI can
 * diagnose a running simulation in the same conversation used for layout
 * changes — see {@link AIChatPanelProps.onApproveParams}.
 */
export interface SimulationSnapshot {
  /** Recent raw data samples produced by the simulation. */
  telemetry_snapshot?: unknown[];
  /** Recent safety/threshold assessments paired with telemetry_snapshot. */
  safety_snapshot?: unknown[];
  /** The simulation's current parameter values. */
  current_params?: Record<string, unknown>;
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
  /**
   * Called before every request to attach a {@link SimulationSnapshot}.
   * Omit for layout-only apps (e.g. the sine-wave example) — no snapshot
   * fields are sent and the AI behaves exactly as before.
   */
  getSnapshot?: () => SimulationSnapshot;
  /**
   * Called when the user approves AI-suggested parameter values. Required
   * for `suggested_params` to render with Approve/Reject controls — omitted
   * entirely when not provided, even if the AI returns `suggested_params`.
   */
  onApproveParams?: (params: Record<string, unknown>) => void;
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
  onApproveParams?: (messageId: string, params: Record<string, unknown>) => void;
  onRejectParams: (messageId: string) => void;
}

/**
 * Renders a single chat message bubble.
 *
 * User messages are right-aligned; assistant messages are left-aligned.
 * Assistant messages that carry a `proposedLayout` include an inline
 * {@link LayoutDiffViewer}, and messages that carry `suggestedParams` include
 * an inline {@link ParamDiffViewer} — both with their own Approve/Reject
 * controls. A single response may include both (e.g. a diagnosis that fixes
 * parameters and adds a widget to visualise the result).
 *
 * @param props - {@link MessageBubbleProps}
 * @returns A styled message bubble element.
 */
function MessageBubble({
  message,
  currentLayout,
  onApprove,
  onReject,
  onApproveParams,
  onRejectParams,
}: MessageBubbleProps): React.ReactElement {
  const isUser = message.role === "user";
  const bubbleClass = isUser
    ? "sct-AIChatPanel-bubble sct-AIChatPanel-bubble--user"
    : "sct-AIChatPanel-bubble sct-AIChatPanel-bubble--assistant";

  const showDiff =
    message.proposedLayout !== undefined && message.approved === undefined;
  const showParamDiff =
    message.suggestedParams !== undefined &&
    onApproveParams !== undefined &&
    message.paramsApproved === undefined;

  return (
    <div className={`sct-AIChatPanel-row sct-AIChatPanel-row--${message.role}`}>
      <div className={bubbleClass}>
        {/* Hide bubble text while a diff viewer is showing — the explanation
            is already rendered inside the diff viewer to avoid duplication. */}
        {!showDiff && !showParamDiff && (
          <p className="sct-AIChatPanel-bubble-text">{message.content}</p>
        )}

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

        {showParamDiff && message.suggestedParams && onApproveParams && (
          <div className="sct-AIChatPanel-diff">
            <ParamDiffViewer
              current={message.currentParamsSnapshot ?? {}}
              suggested={message.suggestedParams}
              explanation={message.content}
              onApprove={() => onApproveParams(message.id, message.suggestedParams!)}
              onReject={() => onRejectParams(message.id)}
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
        {message.paramsApproved === true && (
          <p className="sct-AIChatPanel-status sct-AIChatPanel-status--approved">
            Parameters applied.
          </p>
        )}
        {message.paramsApproved === false && (
          <p className="sct-AIChatPanel-status sct-AIChatPanel-status--rejected">
            Parameters rejected.
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
  getSnapshot,
  onApproveParams,
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

    const snapshot = getSnapshot?.();

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          history: approvedHistory.current,
          registry: serializeRegistry(registry),
          current_layout: currentLayout,
          ...(snapshot?.telemetry_snapshot !== undefined && {
            telemetry_snapshot: snapshot.telemetry_snapshot,
          }),
          ...(snapshot?.safety_snapshot !== undefined && {
            safety_snapshot: snapshot.safety_snapshot,
          }),
          ...(snapshot?.current_params !== undefined && {
            current_params: snapshot.current_params,
          }),
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
        suggested_params?: Record<string, unknown> | null;
      };

      // The backend omits/empties "layout" for a pure diagnosis response —
      // only treat it as a real proposal when it has actual region content.
      const hasLayout =
        data.layout && "regions" in data.layout && Object.keys(data.layout).length > 0;

      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        content: data.explanation,
        ...(hasLayout && {
          proposedLayout: data.layout,
          layoutExplanation: data.explanation,
        }),
        ...(data.suggested_params && {
          suggestedParams: data.suggested_params,
          currentParamsSnapshot: snapshot?.current_params,
        }),
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

  function handleApproveParams(
    messageId: string,
    params: Record<string, unknown>,
  ): void {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, paramsApproved: true } : m)),
    );
    onApproveParams?.(params);
  }

  function handleRejectParams(messageId: string): void {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, paramsApproved: false } : m)),
    );
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
                onApproveParams={onApproveParams && handleApproveParams}
                onRejectParams={handleRejectParams}
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
            className="sct-AIChatPanel-textarea"
            placeholder="Ask AI to build or modify your layout…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            aria-label="Chat input"
          />
          <Button
            className="sct-AIChatPanel-send-btn"
            size="default"
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
