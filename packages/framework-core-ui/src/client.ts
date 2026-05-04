/** Current state of the WebSocket connection to the EventBus. */
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/**
 * Metadata envelope attached to every wire event.
 *
 * Produced by the backend and forwarded unchanged to channel subscribers.
 */
export interface EventHeaders {
  message_id: string;
  /** Milliseconds since Unix epoch. */
  timestamp: number;
  /**
   * Optional MIME type describing the exact shape of the payload.
   *
   * When present, the frontend widget registry uses this for secondary
   * widget resolution after the channel-pattern matching.
   * e.g. `"text/plain"`, `"application/x-timeseries+json"`.
   */
  mimeType?: string;
}

/** Raw message received from the WebSocket before payload deserialization. */
export interface WireEvent {
  /** Channel the message was published on. */
  channel: string;
  /** Metadata envelope attached by the backend. */
  headers: EventHeaders;
  /** Untyped payload — consumers cast this via {@link toPayloadWithHeaders}. */
  payload: unknown;
}

/** Callback invoked for each incoming {@link WireEvent} matching a subscription pattern. */
export type ChannelHandler = (event: WireEvent) => void;

/** Callback invoked whenever the WebSocket {@link ConnectionStatus} changes. */
export type StatusListener = (status: ConnectionStatus) => void;

/**
 * Minimal WebSocket interface used internally.
 *
 * Modelled after the browser `WebSocket` API so that tests can inject
 * a lightweight fake via {@link WebSocketFactory}.
 */
export interface WebSocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  readonly readyState: number;
  send(data: string): void;
  close(): void;
}

/**
 * Factory that produces a {@link WebSocketLike} for a given URL.
 *
 * Defaults to the native `WebSocket` constructor. Override in tests to
 * inject a fake socket without touching global state.
 */
export type WebSocketFactory = (url: string) => WebSocketLike;

interface ClientOptions {
  reconnectDelayMs?: number;
  webSocketFactory?: WebSocketFactory;
}

const WS_OPEN = 1;

/**
 * Convert an fnmatch-style glob pattern (only `*` is supported) to a RegExp.
 *
 * The original implementation had a broken character-class escape:
 *   `"[\\]\\]"` — the double-escaped backslash produces the literal string
 *   `[\]]` inside the regex character class, which is valid but matches `]`
 *   only, silently dropping `\` from the set of escaped characters.
 *
 * Fixed: escape each special character individually so the replacements are
 * unambiguous.
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Returns whether a concrete channel matches a glob-style pattern.
 *
 * @param channel Concrete channel name.
 * @param pattern Pattern supporting `*` wildcard matching.
 * @returns `true` when `channel` matches `pattern`, otherwise `false`.
 * @example
 * ```ts
 * channelMatches("sensor/temperature", "sensor/*"); // true
 * ```
 */
export function channelMatches(channel: string, pattern: string): boolean {
  return globToRegex(pattern).test(channel);
}

/**
 * Parse and validate an unknown value as a {@link WireEvent}.
 *
 * Returns ``null`` for any value that does not conform to the wire format
 * so callers can safely discard malformed messages.
 *
 * @param value Unknown incoming value from websocket message parsing.
 * @returns A validated `WireEvent`, or `null` when the value is invalid.
 * @example
 * ```ts
 * const parsed = coerceWireEvent({
 *   channel: "sensor/temperature",
 *   headers: { message_id: "id-1", timestamp: 123 },
 *   payload: { value: 21.2 },
 * });
 * ```
 */
export function coerceWireEvent(value: unknown): WireEvent | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const maybeEvent = value as Record<string, unknown>;
  const headers = maybeEvent.headers as Record<string, unknown> | undefined;
  if (
    typeof maybeEvent.channel !== "string" ||
    typeof headers?.message_id !== "string" ||
    typeof headers.timestamp !== "number"
  ) {
    return null;
  }

  return {
    channel: maybeEvent.channel,
    headers: {
      message_id: headers.message_id,
      timestamp: headers.timestamp,
      ...(typeof headers.mimeType === "string" ? { mimeType: headers.mimeType } : {}),
    },
    payload: maybeEvent.payload,
  };
}

/**
 * WebSocket-backed EventBus client.
 *
 * Responsibilities:
 * - Maintains a single WebSocket connection and reconnects automatically.
 * - Multiplexes channel subscriptions over that connection.
 * - Stores the last received message per channel so new subscribers receive
 *   it immediately (client-side replay, mirrors the backend behaviour).
 * - Exposes connection status to UI consumers via {@link onStatusChange}.
 *
 * @example
 * ```ts
 * const client = new RealtimeEventBusClient("ws://localhost:8000/ws");
 * client.start();
 * const off = client.subscribe("sensor/*", (event) => console.log(event));
 * off();
 * client.stop();
 * ```
 */
export class RealtimeEventBusClient {
  private readonly url: string;
  private readonly reconnectDelayMs: number;
  private readonly webSocketFactory: WebSocketFactory;

  private socket: WebSocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  private status: ConnectionStatus = "disconnected";
  private readonly statusListeners = new Set<StatusListener>();

  /** pattern → set of handlers */
  private readonly subscriptions = new Map<string, Set<ChannelHandler>>();
  /** exact channel → last received event */
  private readonly lastByChannel = new Map<string, WireEvent>();

  /**
   * Creates a websocket-backed event bus client.
   *
   * @param url Absolute websocket URL.
   * @param options Optional reconnect and websocket-factory options.
   * @returns New `RealtimeEventBusClient` instance.
   */
  constructor(url: string, options: ClientOptions = {}) {
    this.url = url;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.webSocketFactory =
      options.webSocketFactory ?? ((wsUrl) => new WebSocket(wsUrl));
  }

  /**
   * Opens the websocket connection.
   *
   * @returns Nothing.
   * @example
   * ```ts
   * client.start();
   * ```
   */
  public start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.setStatus("connecting");
    this.connect();
  }

  /**
   * Closes the websocket and cancels pending reconnect attempts.
   *
   * @returns Nothing.
   * @example
   * ```ts
   * client.stop();
   * ```
   */
  public stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setStatus("disconnected");
  }

  /**
   * Returns the current connection status.
   *
   * @returns Current connection status enum value.
   * @example
   * ```ts
   * const status = client.getStatus();
   * ```
   */
  public getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Register a listener that is called whenever the connection status changes.
   *
   * The listener is called immediately with the current status on registration.
   * Returns an unsubscribe function.
   *
   * @param listener Callback invoked with each status change.
   * @returns Function that unsubscribes the status listener.
   * @example
   * ```ts
   * const off = client.onStatusChange((status) => console.log(status));
   * off();
   * ```
   */
  public onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Subscribe ``handler`` to all messages whose channel matches
   * ``channelPattern`` (fnmatch-style glob).
   *
   * - Sends a ``subscribe`` action to the server when the first handler for a
   *   pattern is registered (and the socket is open).
   * - Immediately delivers any stored last messages that match the pattern
   *   (client-side replay).
   *
   * @param channelPattern Glob-style subscription pattern.
   * @param handler Callback invoked for matching events.
   * @returns Function that unsubscribes this handler.
   * @example
   * ```ts
   * const off = client.subscribe("logs/*", (event) => console.log(event.payload));
   * off();
   * ```
   */
  public subscribe(channelPattern: string, handler: ChannelHandler): () => void {
    const handlers =
      this.subscriptions.get(channelPattern) ?? new Set<ChannelHandler>();
    const firstSubscriberForPattern = handlers.size === 0;

    handlers.add(handler);
    this.subscriptions.set(channelPattern, handlers);

    if (firstSubscriberForPattern && this.isSocketOpen()) {
      this.sendJson({ action: "subscribe", channel: channelPattern });
    }

    // Client-side replay: deliver stored last messages that match the pattern.
    for (const event of this.lastByChannel.values()) {
      if (channelMatches(event.channel, channelPattern)) {
        handler(event);
      }
    }

    return () => {
      this.unsubscribe(channelPattern, handler);
    };
  }

  /**
   * Remove ``handler`` from ``channelPattern``.
   *
   * Sends an ``unsubscribe`` action to the server when the last handler for a
   * pattern is removed.
   *
   * @param channelPattern Glob-style subscription pattern.
   * @param handler Previously subscribed handler.
   * @returns Nothing.
   * @example
   * ```ts
   * client.unsubscribe("sensor/*", handler);
   * ```
   */
  public unsubscribe(channelPattern: string, handler: ChannelHandler): void {
    const handlers = this.subscriptions.get(channelPattern);
    if (!handlers) {
      return;
    }

    handlers.delete(handler);
    if (handlers.size > 0) {
      return;
    }

    this.subscriptions.delete(channelPattern);
    if (this.isSocketOpen()) {
      this.sendJson({ action: "unsubscribe", channel: channelPattern });
    }
  }

  /**
   * Publish ``payload`` to ``channel`` via the server.
   *
   * No-op when the socket is not open.
   *
   * @param channel Target channel.
   * @param payload JSON-serializable payload.
   * @returns Nothing.
   * @example
   * ```ts
   * client.publish("commands/reset", { target: "sensor-1" });
   * ```
   */
  public publish(channel: string, payload: unknown): void {
    if (!this.isSocketOpen()) {
      return;
    }
    this.sendJson({ action: "publish", channel, payload });
  }

  private connect(): void {
    const socket = this.webSocketFactory(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.setStatus("connected");
      // Re-subscribe all existing patterns after a reconnect.
      for (const pattern of this.subscriptions.keys()) {
        this.sendJson({ action: "subscribe", channel: pattern });
      }
    };

    socket.onmessage = (event) => {
      const parsed = this.parseMessage(event.data);
      if (!parsed) {
        return;
      }

      this.lastByChannel.set(parsed.channel, parsed);
      for (const [pattern, handlers] of this.subscriptions) {
        if (!channelMatches(parsed.channel, pattern)) {
          continue;
        }
        for (const handler of handlers) {
          handler(parsed);
        }
      }
    };

    socket.onerror = () => {
      this.setStatus("disconnected");
    };

    socket.onclose = () => {
      this.socket = null;
      if (this.stopped) {
        this.setStatus("disconnected");
        return;
      }

      this.setStatus("disconnected");
      this.reconnectTimer = setTimeout(() => {
        if (this.stopped) {
          return;
        }
        this.setStatus("connecting");
        this.connect();
      }, this.reconnectDelayMs);
    };
  }

  private parseMessage(raw: unknown): WireEvent | null {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return coerceWireEvent(parsed);
    } catch {
      return null;
    }
  }

  private isSocketOpen(): boolean {
    return this.socket?.readyState === WS_OPEN;
  }

  private sendJson(data: object): void {
    if (!this.isSocketOpen() || !this.socket) {
      return;
    }
    this.socket.send(JSON.stringify(data));
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}
