import { useEffect, useRef, useState } from "react";

import { ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Textarea } from "./ui/textarea";
import { LayoutDiffViewer } from "./LayoutDiffViewer";
import { ParamDiffViewer } from "./ParamDiffViewer";
import { captureView } from "../captureView";
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
  /** AI-suggested parameter values (a flat name → value object), if any. */
  suggestedParams?: Record<string, unknown>;
  /** Current parameter values at suggestion time, used as the diff baseline. */
  currentParamsSnapshot?: Record<string, unknown>;
  /** Whether the user approved the suggested params. Undefined until acted on. */
  paramsApproved?: boolean;
  /** Screenshot (`data:` URL) attached to this user message, if any. */
  screenshot?: string;
  /** True when a view capture was attempted for this message but failed. */
  captureFailed?: boolean;
}

/** A turn in the conversation history sent to the backend. */
interface ConversationTurn {
  user: string;
  assistant: string;
}

/**
 * Application-defined context attached to every chat request.
 *
 * Returned by the {@link AIChatPanelProps.getSnapshot} callback. The framework
 * is deliberately domain-agnostic: it forwards `context` and `instructions`
 * verbatim to the backend prompt and imposes no schema, so any app can adapt
 * the structure to its own data. `currentParams` is used locally as the
 * baseline for the suggested-parameter diff.
 */
export interface AISnapshot {
  /** Arbitrary context (free-form JSON) describing the app's current state. */
  context?: Record<string, unknown>;
  /**
   * App-specific guidance the AI should use to interpret `context` and decide
   * what `suggested_params` may change (data meaning, safe ranges, etc.).
   */
  instructions?: string;
  /** Current parameter values, used as the baseline for the suggested-params diff. */
  currentParams?: Record<string, unknown>;
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
   * Defaults to `"/api/ai/layout"`.
   */
  apiUrl?: string;
  /**
   * Called before every request to attach an application-defined
   * {@link AISnapshot}. Omit for layout-only apps (e.g. the sine-wave
   * example) — no context is sent and the AI behaves exactly as before.
   */
  getSnapshot?: () => AISnapshot;
  /**
   * Called when the user approves AI-suggested parameter values. Required
   * for `suggested_params` to render with Approve/Reject controls — omitted
   * entirely when not provided, even if the AI returns `suggested_params`.
   */
  onApproveParams?: (params: Record<string, unknown>) => void;
  /**
   * Returns the DOM element to screenshot for the AI (the dashboard's main
   * content). Provided by {@link ApplicationShell}. When present, an "App view"
   * checkbox appears; sending a message with it on captures this element and
   * attaches it so a vision model can reason over what the user sees. The
   * separate "Data context" checkbox (shown when {@link AIChatPanelProps.getSnapshot}
   * is provided) independently controls the structured context.
   */
  getCaptureTarget?: () => HTMLElement | null;
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

        {message.screenshot && (
          <img
            className="sct-AIChatPanel-screenshot"
            src={message.screenshot}
            alt="Dashboard view sent to the assistant"
          />
        )}

        {message.captureFailed && (
          <p className="sct-AIChatPanel-capture-note">
            Couldn't capture the view — sent your message without a screenshot.
          </p>
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
 * and POSTs them to `POST /api/ai/layout`. When the AI proposes a layout, a
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
  apiUrl = "/api/ai/layout",
  getSnapshot,
  onApproveParams,
  getCaptureTarget,
}: AIChatPanelProps): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The user can independently pick which extras ride along with a message:
  // the app's structured data context (from getSnapshot) and/or a screenshot of
  // the current app view (from getCaptureTarget). Both default on when available.
  const [includeData, setIncludeData] = useState(true);
  const [includeView, setIncludeView] = useState(true);
  // Transient popup shown after approving AI-suggested parameters, prompting the
  // user to re-run so the change takes effect.
  const [toast, setToast] = useState<string | null>(null);

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

    // Capture the current dashboard view (best-effort) when "App view" is on,
    // so the AI can reason over what the user sees. A failed capture falls back
    // to text/context only.
    let screenshot: string | undefined;
    let captureFailed = false;
    if (includeView && getCaptureTarget) {
      const target = getCaptureTarget();
      if (target) {
        try {
          screenshot = await captureView(target);
        } catch {
          captureFailed = true;
        }
      }
    }

    const userMsg: ChatMessage = {
      id: nextId(),
      role: "user",
      content: text,
      ...(screenshot && { screenshot }),
      ...(captureFailed && { captureFailed: true }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const snapshot = includeData ? getSnapshot?.() : undefined;

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          history: approvedHistory.current,
          registry: serializeRegistry(registry),
          current_layout: currentLayout,
          ...(snapshot?.context !== undefined && { context: snapshot.context }),
          ...(snapshot?.instructions !== undefined && {
            context_instructions: snapshot.instructions,
          }),
          ...(screenshot && { screenshot }),
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
        // Only show the Approve/Reject param UI when the AI actually proposed
        // parameters — an empty object (common on pure-diagnosis answers) must
        // not render an empty diff with dummy buttons.
        ...(data.suggested_params &&
          Object.keys(data.suggested_params).length > 0 && {
            suggestedParams: data.suggested_params,
            currentParamsSnapshot: snapshot?.currentParams,
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
    setToast("Parameters applied - run again to see the change take effect.");
    window.setTimeout(() => setToast(null), 2500);
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
        {toast && (
          <div className="sct-AIChatPanel-toast-overlay">
            <div className="sct-AIChatPanel-toast" role="status" aria-live="polite">
              <span aria-hidden className="sct-AIChatPanel-toast-check">
                ✓
              </span>
              {toast}
            </div>
          </div>
        )}
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

        <div className="sct-AIChatPanel-input-area">
          {(getSnapshot || getCaptureTarget) && (
            <div
              className="sct-AIChatPanel-context-toggles"
              role="group"
              aria-label="Data to send with your message"
            >
              <span className="sct-AIChatPanel-context-toggles-label">
                Send with message:
              </span>
              {getSnapshot && (
                <label className="sct-AIChatPanel-context-toggle">
                  <input
                    type="checkbox"
                    checked={includeData}
                    onChange={(e) => setIncludeData(e.target.checked)}
                    aria-label="Data context"
                  />
                  Data context
                </label>
              )}
              {getCaptureTarget && (
                <label className="sct-AIChatPanel-context-toggle">
                  <input
                    type="checkbox"
                    checked={includeView}
                    onChange={(e) => setIncludeView(e.target.checked)}
                    aria-label="App view"
                  />
                  App view
                </label>
              )}
            </div>
          )}
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
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Module-level map for pending (not-yet-approved) conversation turns.
// Keyed by assistant message id.
const _pendingTurns = new Map<string, ConversationTurn>();
