// A stand-in for React's hooks, so a hook test can drive one hook without a
// renderer: a test aliases "react" to this file in jiti and renders through
// renderHook(). One component; effects (layout ones too) run after each
// render; a state change made inside a render or an effect renders again at
// once, one made later (a timer, a resolved fetch) waits for flush().
let current = null;
const changed = (prev, next) => !prev || !next || prev.length !== next.length || prev.some((value, index) => !Object.is(value, next[index]));
function slot(init) {
  const instance = current;
  const index = instance.index++;
  if (!(index in instance.slots)) instance.slots[index] = init();
  return instance.slots[index];
}
export function useRef(value) { return slot(() => ({ current: value })); }
export function useState(initial) {
  const instance = current;
  const state = slot(() => {
    const entry = { value: typeof initial === "function" ? initial() : initial };
    entry.set = (value) => {
      const next = typeof value === "function" ? value(entry.value) : value;
      if (!Object.is(next, entry.value)) { entry.value = next; instance.dirty = true; }
    };
    return entry;
  });
  return [state.value, state.set];
}
function memo(fn, deps) {
  const entry = slot(() => ({ deps: undefined, value: undefined }));
  if (changed(entry.deps, deps)) { entry.value = fn(); entry.deps = deps; }
  return entry.value;
}
export const useMemo = memo;
export function useCallback(fn, deps) { return memo(() => fn, deps); }
function effect(fn, deps) {
  const instance = current;
  const entry = slot(() => ({ deps: undefined, cleanup: undefined, effect: true }));
  if (changed(entry.deps, deps)) { entry.deps = deps; entry.fn = fn; instance.pending.push(entry); }
}
export const useEffect = effect;
export const useLayoutEffect = effect;
export function renderHook(hook, props) {
  const instance = { slots: [], index: 0, pending: [], dirty: false, props, result: undefined };
  const render = () => {
    do {
      instance.dirty = false;
      instance.index = 0;
      instance.pending = [];
      current = instance;
      instance.result = hook(instance.props);
      current = null;
      for (const entry of instance.pending) { entry.cleanup?.(); entry.cleanup = entry.fn() ?? undefined; }
    } while (instance.dirty);
  };
  render();
  return {
    get result() { return instance.result; },
    rerender(next) { if (next) instance.props = next; render(); },
    flush() { if (instance.dirty) render(); },
    unmount() { for (const entry of instance.slots) if (entry?.effect) entry.cleanup?.(); },
  };
}
