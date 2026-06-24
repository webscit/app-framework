import { act } from "react";
import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import { EventBusProvider } from "../../EventBusContext";
import { DataTableComponent } from "./DataTable";
import type { WebSocketLike } from "../../client";

class FakeWebSocket implements WebSocketLike {
  public static readonly OPEN = 1;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public readyState = FakeWebSocket.OPEN;
  public readonly sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({} as CloseEvent);
  }
  open(): void {
    this.onopen?.({} as Event);
  }
  receive(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function sendRowEvent(
  socket: FakeWebSocket,
  channel: string,
  row: Record<string, unknown>,
  id = "msg-1",
): void {
  socket.receive(
    JSON.stringify({
      channel,
      headers: { message_id: id, timestamp: 1_000_000 },
      payload: row,
    }),
  );
}

describe("DataTableComponent", () => {
  it("renders empty state when no events have arrived", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <DataTableComponent channel="table/results" />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
    });

    await expect
      .element(screen.getByText(/Waiting for data on table\/results/))
      .toBeInTheDocument();
  });

  it("renders a row when an object payload arrives", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <DataTableComponent channel="table/results" />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendRowEvent(socket, "table/results", { step: 1, status: "converging" });
    });

    await expect.element(screen.getByText("1")).toBeInTheDocument();
    await expect.element(screen.getByText("converging")).toBeInTheDocument();
  });

  it("applies a severity variant class to rows via statusKey + statusVariants", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <DataTableComponent
          channel="table/results"
          columns={[
            { key: "step", header: "Step", type: "number" },
            { key: "status", header: "Status" },
          ]}
          statusKey="status"
          statusVariants={{ violation: "error", ok: "success" }}
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendRowEvent(socket, "table/results", { step: 1, status: "violation" }, "m1");
      sendRowEvent(socket, "table/results", { step: 2, status: "ok" }, "m2");
    });

    const failing = (await screen.getByText("violation").element()).closest("tr");
    const passing = (await screen.getByText("ok").element()).closest("tr");
    expect(failing?.className).toContain("sct-DataTable-row--error");
    expect(passing?.className).toContain("sct-DataTable-row--success");
  });

  it("adds no variant class when statusKey is unset", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <DataTableComponent
          channel="table/results"
          columns={[{ key: "status", header: "Status" }]}
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendRowEvent(socket, "table/results", { status: "violation" }, "m1");
    });

    const row = (await screen.getByText("violation").element()).closest("tr");
    expect(row?.className ?? "").not.toContain("sct-DataTable-row--");
  });

  it("sorting is keyboard-accessible and exposes aria-sort", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <DataTableComponent
          channel="table/results"
          columns={[{ key: "step", header: "Step", type: "number" }]}
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendRowEvent(socket, "table/results", { step: 1 }, "m1");
    });

    const header = screen.getByRole("columnheader");
    await expect.element(header).toHaveAttribute("aria-sort", "none");

    await screen.getByRole("button", { name: "Sort by Step" }).click();
    await expect.element(header).toHaveAttribute("aria-sort", "ascending");
  });

  it("column toggle buttons expose their aria-pressed state", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <DataTableComponent
          channel="table/results"
          columns={[{ key: "step", header: "Step", type: "number" }]}
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendRowEvent(socket, "table/results", { step: 1 }, "m1");
    });

    const toggle = screen.getByRole("button", { name: "Step", exact: true });
    await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("drops non-object payloads (null, array, string) silently", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <DataTableComponent channel="table/results" />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      // null payload
      socket.receive(
        JSON.stringify({
          channel: "table/results",
          headers: { message_id: "m1", timestamp: 1 },
          payload: null,
        }),
      );
      // array payload
      socket.receive(
        JSON.stringify({
          channel: "table/results",
          headers: { message_id: "m2", timestamp: 2 },
          payload: [1, 2, 3],
        }),
      );
      // string payload
      socket.receive(
        JSON.stringify({
          channel: "table/results",
          headers: { message_id: "m3", timestamp: 3 },
          payload: "not-an-object",
        }),
      );
    });

    await expect
      .element(screen.getByText(/Waiting for data on table\/results/))
      .toBeInTheDocument();
  });

  it("trims oldest rows when maxRows is exceeded", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <DataTableComponent
          channel="table/results"
          maxRows={2}
          columns={[{ key: "val", header: "Val" }]}
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendRowEvent(socket, "table/results", { val: "first" }, "m1");
      sendRowEvent(socket, "table/results", { val: "second" }, "m2");
      sendRowEvent(socket, "table/results", { val: "third" }, "m3");
    });

    await expect.element(screen.getByText("second")).toBeInTheDocument();
    await expect.element(screen.getByText("third")).toBeInTheDocument();
    await expect.element(screen.getByText("first")).not.toBeInTheDocument();
  });

  it("renders title when provided", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <DataTableComponent
          channel="table/results"
          title="Solver Results"
          columns={[{ key: "x", header: "X" }]}
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendRowEvent(socket, "table/results", { x: 42 });
    });

    await expect.element(screen.getByText("Solver Results")).toBeInTheDocument();
  });

  it("renders user-provided column headers", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <DataTableComponent
          channel="table/results"
          columns={[
            { key: "step", header: "Step", type: "number" },
            { key: "residual", header: "Residual", type: "number" },
          ]}
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendRowEvent(socket, "table/results", { step: 1, residual: 0.001 });
    });

    // Column toggle buttons confirm the user-provided headers are in use.
    // `exact` disambiguates from the "Sort by …" header sort buttons.
    await expect
      .element(screen.getByRole("button", { name: "Step", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Residual", exact: true }))
      .toBeInTheDocument();
  });

  it("auto-derives column headers from first row", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <DataTableComponent channel="table/results" />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendRowEvent(socket, "table/results", { alpha: 1, beta: 2 });
    });

    // Toggle buttons confirm headers were auto-derived from the first row's keys
    await expect
      .element(screen.getByRole("button", { name: "alpha", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "beta", exact: true }))
      .toBeInTheDocument();
  });

  it("filters rows when search input is typed", async () => {
    const socket = new FakeWebSocket();

    const screen = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <DataTableComponent
          channel="table/results"
          columns={[{ key: "status", header: "Status" }]}
        />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
      sendRowEvent(socket, "table/results", { status: "converged" }, "m1");
      sendRowEvent(socket, "table/results", { status: "converging" }, "m2");
      sendRowEvent(socket, "table/results", { status: "failed" }, "m3");
    });

    const searchInput = screen.getByPlaceholder("Search…");
    // "converg" is the common prefix of "converged" and "converging"
    await searchInput.fill("converg");

    await expect.element(screen.getByText("converged")).toBeInTheDocument();
    await expect.element(screen.getByText("converging")).toBeInTheDocument();
    await expect.element(screen.getByText("failed")).not.toBeInTheDocument();
  });

  it("unmounts without throwing", async () => {
    const socket = new FakeWebSocket();

    const { unmount } = await render(
      <EventBusProvider path="/ws" webSocketFactory={() => socket}>
        <DataTableComponent channel="table/results" />
      </EventBusProvider>,
    );

    await act(async () => {
      socket.open();
    });

    expect(() => unmount()).not.toThrow();
  });
});
