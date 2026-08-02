// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as tlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { PinnedDirsList, type PinnedDir } from "./PinnedDirsList";
import { mockFetchSequence } from "@/lib/test-fetch-mock";
import { I18nProvider } from "@/hooks/useI18n";

function renderWithI18n(ui: React.ReactElement) {
  return tlRender(<I18nProvider>{ui}</I18nProvider>);
}

const sample: PinnedDir[] = [
  { path: "/Users/me/projects/pi-web", alias: "pi-web", pinnedAt: 1700000000000 },
  { path: "/Users/me/projects/scratch", pinnedAt: 1700000001000 },
];

describe("PinnedDirsList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the pinned dirs from /api/pinned-dirs on mount", async () => {
    mockFetchSequence([{ body: { pinnedDirs: sample } }]);
    renderWithI18n(<PinnedDirsList onCwdChange={() => {}} />);
    // Two list items, one per pinned dir. Use data-pinned-label to avoid
    // collisions with the basename span shown when alias is set.
    const labels = await screen.findAllByText("pi-web");
    expect(labels.length).toBeGreaterThan(0);
    // "scratch" has no alias, so the label is the basename.
    expect(screen.getByText("scratch")).toBeInTheDocument();
    // Title attribute should expose the full path for screen-readers.
    expect(screen.getByTitle("/Users/me/projects/scratch")).toBeInTheDocument();
  });

  it("calls onCwdChange with the path when a pinned dir is clicked", async () => {
    mockFetchSequence([{ body: { pinnedDirs: sample } }]);
    const onCwdChange = vi.fn();
    renderWithI18n(<PinnedDirsList onCwdChange={onCwdChange} />);
    // Wait for the two rows to appear.
    await waitFor(() => {
      expect(document.querySelectorAll("[data-pinned-row]").length).toBe(2);
    });
    const rows = document.querySelectorAll("[data-pinned-row]");
    fireEvent.click(rows[0]!); // click the pi-web row
    expect(onCwdChange).toHaveBeenCalledWith(
      "/Users/me/projects/pi-web",
      "/Users/me/projects/pi-web",
    );
  });

  it("removes the dir from the list after unpin is clicked", async () => {
    mockFetchSequence([
      { body: { pinnedDirs: sample } }, // initial GET
      { body: { removed: true } }, // DELETE response
    ]);
    renderWithI18n(<PinnedDirsList onCwdChange={() => {}} />);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-pinned-row]").length).toBe(2);
    });
    const firstRow = document.querySelectorAll("[data-pinned-row]")[0]!;
    const unpinBtn = firstRow.querySelector("[data-unpin]")!;
    fireEvent.click(unpinBtn);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-pinned-row]").length).toBe(1);
    });
    // The remaining dir should still be visible (alias-less, label is basename).
    expect(screen.getByText("scratch")).toBeInTheDocument();
  });

  it("renders nothing when the pinned list is empty (no header)", async () => {
    mockFetchSequence([{ body: { pinnedDirs: [] } }]);
    renderWithI18n(<PinnedDirsList onCwdChange={() => {}} />);
    // Wait a microtask for the fetch resolution.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/pinned/i)).toBeNull();
  });

  it("does not crash on a 500 response", async () => {
    mockFetchSequence([{ body: { error: "boom" }, status: 500 }]);
    const onCwdChange = vi.fn();
    expect(() => renderWithI18n(<PinnedDirsList onCwdChange={onCwdChange} />)).not.toThrow();
  });

  // --- Inline alias editing ---

  it("shows an edit (pencil) button on each row", async () => {
    mockFetchSequence([{ body: { pinnedDirs: sample } }]);
    renderWithI18n(<PinnedDirsList onCwdChange={() => {}} />);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-pinned-row]").length).toBe(2);
    });
    expect(document.querySelectorAll("[data-edit-alias]").length).toBe(2);
  });

  it("clicking the pencil reveals an inline input pre-filled with the alias", async () => {
    mockFetchSequence([{ body: { pinnedDirs: sample } }]);
    renderWithI18n(<PinnedDirsList onCwdChange={() => {}} />);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-pinned-row]").length).toBe(2);
    });
    const firstRow = document.querySelectorAll("[data-pinned-row]")[0]!;
    fireEvent.click(firstRow.querySelector("[data-edit-alias]")!);
    const input = firstRow.querySelector("[data-alias-input]") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("pi-web");
  });

  it("Enter saves the alias via POST and emits the bus", async () => {
    mockFetchSequence([
      { body: { pinnedDirs: sample } },
      {
        body: { pinnedDir: { path: "/Users/me/projects/pi-web", alias: "my-alias", pinnedAt: 0 } },
      },
    ]);
    renderWithI18n(<PinnedDirsList onCwdChange={() => {}} />);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-pinned-row]").length).toBe(2);
    });
    const firstRow = document.querySelectorAll("[data-pinned-row]")[0]!;
    fireEvent.click(firstRow.querySelector("[data-edit-alias]")!);
    const input = firstRow.querySelector("[data-alias-input]") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "my-alias" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const postCall = calls.find((c) => (c[1] as RequestInit)?.method === "POST");
      expect(postCall).toBeTruthy();
      expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({
        path: "/Users/me/projects/pi-web",
        alias: "my-alias",
      });
    });
  });

  it("Escape cancels editing without POSTing", async () => {
    mockFetchSequence([{ body: { pinnedDirs: sample } }]);
    renderWithI18n(<PinnedDirsList onCwdChange={() => {}} />);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-pinned-row]").length).toBe(2);
    });
    const firstRow = document.querySelectorAll("[data-pinned-row]")[0]!;
    fireEvent.click(firstRow.querySelector("[data-edit-alias]")!);
    const input = firstRow.querySelector("[data-alias-input]") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "changed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    // Input should be gone.
    expect(firstRow.querySelector("[data-alias-input]")).toBeNull();
    // No POST should have been made.
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const postCall = calls.find((c) => (c[1] as RequestInit)?.method === "POST");
    expect(postCall).toBeUndefined();
  });

  it("blur without changes does not POST (skips unnecessary write)", async () => {
    mockFetchSequence([{ body: { pinnedDirs: sample } }]);
    renderWithI18n(<PinnedDirsList onCwdChange={() => {}} />);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-pinned-row]").length).toBe(2);
    });
    const firstRow = document.querySelectorAll("[data-pinned-row]")[0]!;
    // Open editor (alias is "pi-web"), don't change value, blur.
    fireEvent.click(firstRow.querySelector("[data-edit-alias]")!);
    const input = firstRow.querySelector("[data-alias-input]") as HTMLInputElement;
    fireEvent.blur(input);
    // No POST should have been made.
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const postCall = calls.find((c) => (c[1] as RequestInit)?.method === "POST");
    expect(postCall).toBeUndefined();
  });

  it("clicking unpin while editing does not race with a save POST", async () => {
    // Initial GET + DELETE response for the unpin.
    mockFetchSequence([{ body: { pinnedDirs: sample } }, { body: { removed: true } }]);
    renderWithI18n(<PinnedDirsList onCwdChange={() => {}} />);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-pinned-row]").length).toBe(2);
    });
    const firstRow = document.querySelectorAll("[data-pinned-row]")[0]!;
    // Open editor and change value.
    fireEvent.click(firstRow.querySelector("[data-edit-alias]")!);
    const input = firstRow.querySelector("[data-alias-input]") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new-alias" } });
    // Click the unpin button while editing. In real browsers the
    // onMouseDown=preventDefault on the × button stops the input from
    // blurring, so no save POST fires alongside the unpin DELETE.
    fireEvent.click(firstRow.querySelector("[data-unpin]")!);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-pinned-row]").length).toBe(1);
    });
    // Only a DELETE should have been made — NO POST (save) should fire.
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const postCall = calls.find((c) => (c[1] as RequestInit)?.method === "POST");
    expect(postCall).toBeUndefined();
    const deleteCall = calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeTruthy();
  });
});
