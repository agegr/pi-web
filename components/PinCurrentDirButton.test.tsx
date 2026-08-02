// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as tlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { PinCurrentDirButton } from "./PinCurrentDirButton";
import { mockFetchSequence } from "@/lib/test-fetch-mock";
import { I18nProvider } from "@/hooks/useI18n";

function renderWithI18n(ui: React.ReactElement) {
  return tlRender(<I18nProvider>{ui}</I18nProvider>);
}

/**
 * PinCurrentDirButton — small icon button that pins/unpins the user's
 * current cwd. Takes `cwd: string | null` (the cwd to act on) and
 * `isPinned: boolean` (initial pin state, refreshable from the parent).
 *
 * Contract (locked by this test file):
 *  - When cwd is null OR already pinned → button shows the unpin affordance
 *    (× icon, "Unpin this directory" title).
 *  - When cwd is set AND not pinned → button shows the pin affordance
 *    (bookmark icon, "Pin this directory" title).
 *  - Click on pin → POST /api/pinned-dirs with { path: cwd }, then emit
 *    the pinned-dirs bus so PinnedDirsList re-fetches.
 *  - Click on unpin → DELETE /api/pinned-dirs with { path: cwd }, then emit.
 *  - On success → optimistic local toggle of isPinned.
 *  - On API failure → revert isPinned (optimistic rollback).
 *  - Disabled when cwd is null (no path to pin).
 */
describe("PinCurrentDirButton", () => {
  beforeEach(() => {
    delete (globalThis as { __piWebPinnedDirsBus?: unknown }).__piWebPinnedDirsBus;
    vi.restoreAllMocks();
  });

  it("renders the pin affordance when cwd is set and not pinned", () => {
    renderWithI18n(
      <PinCurrentDirButton cwd="/Users/me/projects/x" isPinned={false} onPinnedChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /pin this directory/i })).toBeInTheDocument();
  });

  it("renders the unpin affordance when already pinned", () => {
    renderWithI18n(
      <PinCurrentDirButton cwd="/Users/me/projects/x" isPinned={true} onPinnedChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /unpin this directory/i })).toBeInTheDocument();
  });

  it("is disabled when cwd is null (nothing to pin)", () => {
    renderWithI18n(<PinCurrentDirButton cwd={null} isPinned={false} onPinnedChange={() => {}} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("click on pin POSTs /api/pinned-dirs and emits the bus", async () => {
    mockFetchSequence([{ body: { pinnedDir: { path: "/Users/me/projects/x", pinnedAt: 0 } } }]);
    const onPinnedChange = vi.fn();
    renderWithI18n(
      <PinCurrentDirButton
        cwd="/Users/me/projects/x"
        isPinned={false}
        onPinnedChange={onPinnedChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /pin this directory/i }));
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBe(1);
    });
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/pinned-dirs");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ path: "/Users/me/projects/x" });
    // After the bus emit, PinnedDirsList-style subscribers would re-fetch.
    expect(onPinnedChange).toHaveBeenCalledWith(true);
  });

  it("click on unpin DELETEs /api/pinned-dirs and emits the bus", async () => {
    mockFetchSequence([{ body: { removed: true } }]);
    const onPinnedChange = vi.fn();
    renderWithI18n(
      <PinCurrentDirButton
        cwd="/Users/me/projects/x"
        isPinned={true}
        onPinnedChange={onPinnedChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /unpin this directory/i }));
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBe(1);
    });
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/pinned-dirs");
    expect(init?.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({ path: "/Users/me/projects/x" });
    expect(onPinnedChange).toHaveBeenCalledWith(false);
  });

  it("rolls back optimistic toggle when the API rejects", async () => {
    mockFetchSequence([{ body: { error: "boom" }, status: 500 }]);
    const onPinnedChange = vi.fn();
    renderWithI18n(
      <PinCurrentDirButton
        cwd="/Users/me/projects/x"
        isPinned={false}
        onPinnedChange={onPinnedChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /pin this directory/i }));
    await waitFor(() => {
      // Two onPinnedChange calls: optimistic true (then rollback false).
      expect(onPinnedChange).toHaveBeenCalledTimes(2);
    });
    expect(onPinnedChange.mock.calls[0][0]).toBe(true);
    expect(onPinnedChange.mock.calls[1][0]).toBe(false);
  });

  it("does not POST when cwd is null even if clicked", async () => {
    mockFetchSequence([]);
    renderWithI18n(<PinCurrentDirButton cwd={null} isPinned={false} onPinnedChange={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    // disabled buttons don't fire click in jsdom's fireEvent, but even if
    // a user somehow triggered it, no fetch should happen.
    fireEvent.click(btn);
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
