import React, { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventBusProvider } from "./EventBusContext";
import type { WebSocketLike } from "./client";
import { useChannel } from "./useChannel";
import { useEventBusStatus } from "./useEventBusStatus";
import { usePublish } from "./usePublish";

class FakeWebSocket implements WebSocketLike {
  public static readonly OPEN = 1;

  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;

  public readyState = FakeWebSocket.OPEN;
  public readonly sent: string[] = [];

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.onclose?.({} as CloseEvent);
  }

  public open(): void {
    this.onopen?.({} as Event);
  }

  public receive(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function parseSentMessages(socket: FakeWebSocket): unknown[] {
  return socket.sent.map((message) => JSON.parse(message));
}

describe("framework-core-ui hooks", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: {
        protocol: "http:",
        host: "localhost:5173",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("useChannel returns latest merged payload and unsubscribes on unmount", () => {
    const socket = new FakeWebSocket();
    const seen: Array<Record<string, unknown> | null> = [];
    let setMounted: ((value: boolean) => void) | null = null;

    function Probe(): JSX.Element | null {
      const value = useChannel<Record<string, unknown>>("sensor/temperature");
      useEffect(() => {
        seen.push(value);
      }, [value]);
      return null;
    }

    function Host(): JSX.Element {
      const [mounted, set] = React.useState(true);
      useEffect(() => {
        setMounted = set;
      }, []);

      return (
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          {mounted ? <Probe /> : null}
        </EventBusProvider>
      );
    }

    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(<Host />);
    });

    act(() => {
      socket.open();
    });

    expect(parseSentMessages(socket)).toContainEqual({
      action: "subscribe",
      channel: "sensor/temperature",
    });

    act(() => {
      socket.receive(
        JSON.stringify({
          channel: "sensor/temperature",
          headers: { message_id: "msg-1", timestamp: 123 },
          payload: { value: 22.5, unit: "celsius" },
        }),
      );
    });

    expect(seen.at(-1)).toEqual({
      value: 22.5,
      unit: "celsius",
      message_id: "msg-1",
      timestamp: 123,
    });

    act(() => {
      setMounted!(false);
    });

    expect(parseSentMessages(socket)).toContainEqual({
      action: "unsubscribe",
      channel: "sensor/temperature",
    });

    act(() => {
      renderer!.unmount();
    });
  });

  it("useChannel handles non-object payloads", () => {
    const socket = new FakeWebSocket();
    const seen: Array<Record<string, unknown> | null> = [];

    function Probe(): JSX.Element | null {
      const value = useChannel<Record<string, unknown>>("logs/app");
      useEffect(() => {
        seen.push(value);
      }, [value]);
      return null;
    }

    act(() => {
      create(
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <Probe />
        </EventBusProvider>,
      );
    });

    act(() => {
      socket.open();
      socket.receive(
        JSON.stringify({
          channel: "logs/app",
          headers: { message_id: "msg-2", timestamp: 456 },
          payload: "heartbeat",
        }),
      );
    });

    expect(seen.at(-1)).toEqual({
      message_id: "msg-2",
      timestamp: 456,
      payload: "heartbeat",
    });
  });

  it("usePublish sends publish actions over websocket", () => {
    const socket = new FakeWebSocket();
    let publishFn: ((channel: string, payload: unknown) => void) | null = null;

    function Probe(): JSX.Element | null {
      const publish = usePublish();
      useEffect(() => {
        publishFn = publish;
      }, [publish]);
      return null;
    }

    act(() => {
      create(
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <Probe />
        </EventBusProvider>,
      );
    });

    act(() => {
      socket.open();
      publishFn!("commands/reset", { target: "sensor-1" });
    });

    expect(parseSentMessages(socket)).toContainEqual({
      action: "publish",
      channel: "commands/reset",
      payload: { target: "sensor-1" },
    });
  });

  it("useEventBusStatus tracks connection status changes", () => {
    const socket = new FakeWebSocket();
    const statuses: string[] = [];

    function Probe(): JSX.Element | null {
      const status = useEventBusStatus();
      useEffect(() => {
        statuses.push(status);
      }, [status]);
      return null;
    }

    act(() => {
      create(
        <EventBusProvider path="/ws" webSocketFactory={() => socket}>
          <Probe />
        </EventBusProvider>,
      );
    });

    act(() => {
      socket.open();
    });

    expect(statuses).toContain("connecting");
    expect(statuses).toContain("connected");

    act(() => {
      socket.close();
    });

    expect(statuses).toContain("disconnected");
  });

  it("throws when useChannel is used outside EventBusProvider", () => {
    function Probe(): JSX.Element | null {
      useChannel("sensor/temperature");
      return null;
    }

    expect(() => {
      act(() => {
        create(<Probe />);
      });
    }).toThrow("EventBus hooks must be used inside EventBusProvider.");
  });

  it("throws when usePublish is used outside EventBusProvider", () => {
    function Probe(): JSX.Element | null {
      usePublish();
      return null;
    }

    expect(() => {
      act(() => {
        create(<Probe />);
      });
    }).toThrow("EventBus hooks must be used inside EventBusProvider.");
  });

  it("throws when useEventBusStatus is used outside EventBusProvider", () => {
    function Probe(): JSX.Element | null {
      useEventBusStatus();
      return null;
    }

    expect(() => {
      act(() => {
        create(<Probe />);
      });
    }).toThrow("EventBus hooks must be used inside EventBusProvider.");
  });
});
