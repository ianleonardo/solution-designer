import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, test } from "vitest";
import { FileDrop } from "../../components/FileDrop";

function Harness() {
  const [file, setFile] = useState<File | null>(null);
  return <FileDrop accept=".xlsx" ariaLabel="Excel file" file={file} idleLabel="Drop a file here" onFile={setFile} />;
}

test("chooses a file from the button and from a drop", () => {
  render(<Harness />);
  const input = screen.getByLabelText("Excel file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["a"], "picked.xlsx")] } });
  expect(screen.getByText("picked.xlsx")).toBeTruthy();

  fireEvent.drop(screen.getByText("picked.xlsx"), { dataTransfer: { files: [new File(["b"], "dropped.xlsx")] } });
  expect(screen.getByText("dropped.xlsx")).toBeTruthy();
});

test("rejects a dropped file that does not match the accepted types", () => {
  render(<Harness />);
  fireEvent.drop(screen.getByText("Drop a file here"), { dataTransfer: { files: [new File(["b"], "notes.txt")] } });
  expect(screen.getByText("That file type is not accepted.")).toBeTruthy();
});
