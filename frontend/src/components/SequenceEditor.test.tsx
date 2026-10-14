import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SequenceEditor } from "./SequenceEditor";
import { defaultFlow } from "../flow";
import type { SequenceFlow } from "../types";

vi.mock("@xyflow/react", () => ({ ReactFlow: () => <div />, applyNodeChanges: (_: unknown, nodes: unknown) => nodes }));

afterEach(cleanup);

test("a message can be switched between request and reply", () => {
  const onChange = vi.fn();
  render(<SequenceEditor flow={defaultFlow()} readOnly={false} onChange={onChange} />);
  const first = screen.getByLabelText("Message 1 kind") as HTMLSelectElement;
  expect(first.value).toBe("request");
  expect((screen.getByLabelText("Message 2 kind") as HTMLSelectElement).value).toBe("reply");
  fireEvent.change(first, { target: { value: "reply" } });
  const next = onChange.mock.calls[0][0] as SequenceFlow;
  expect(next.edges[0].data.kind).toBe("reply");
});
