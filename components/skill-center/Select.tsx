"use client";
import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

/** Small single-select shared by the skill center; focus stays on the combobox. */
export function Select({ value, onChange, children, label, disabled = false }: { value: string; onChange: (value: string) => void; children: ReactNode; label: string; disabled?: boolean }) {
  const options = Children.toArray(children).flatMap(child => {
    if (!isValidElement<{value:string;children:ReactNode}>(child)) return [];
    return [{ value: child.props.value, label: child.props.children }];
  });
  const id = useId(); const root = useRef<HTMLDivElement>(null); const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0), [up, setUp] = useState(false);
  const selected = options.findIndex(option => option.value === value);
  function show() { const rect = button.current?.getBoundingClientRect(); setUp(Boolean(rect && window.innerHeight - rect.bottom < 260 && rect.top > 260)); setActive(Math.max(0, selected)); setOpen(true); }
  function choose(index: number) { if (options[index]) onChange(options[index].value); setOpen(false); button.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({block:"nearest"}); }, [open, active, id]);
  return <div className="sc-select relative min-w-0" ref={root} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
    <button type="button" ref={button} role="combobox" aria-label={label} aria-expanded={open} aria-controls={`${id}-list`} aria-haspopup="listbox" aria-activedescendant={open ? `${id}-${active}` : undefined} disabled={disabled} className="sc-select-trigger flex w-full items-center justify-between gap-3 text-left" onClick={() => open ? setOpen(false) : show()} onKeyDown={e => {
      if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
      else if (["ArrowDown","ArrowUp","Home","End"].includes(e.key)) { e.preventDefault(); if (!open) show(); else setActive(e.key === "Home" ? 0 : e.key === "End" ? options.length-1 : (active + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length); }
      else if ((e.key === "Enter" || e.key === " ") && open) { e.preventDefault(); choose(active); }
      else if (e.key === "Tab") setOpen(false);
    }}><span className="truncate">{options[selected]?.label ?? "请选择"}</span><ChevronDown size={16} className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden /></button>
    {open && <div role="listbox" aria-label={label} id={`${id}-list`} className={`sc-select-menu absolute left-0 z-20 max-h-60 min-w-full overflow-y-auto rounded-[var(--radius-panel)] border border-border bg-bg p-1 shadow-[var(--shadow-popover)] ${up ? "bottom-full mb-2" : "top-full mt-2"}`}>
      {options.map((option,index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={value === option.value} onPointerMove={() => setActive(index)} onMouseDown={e => e.preventDefault()} onClick={e => { e.preventDefault(); choose(index); }} className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm ${active === index ? "bg-bg-selected text-accent" : "text-text"}`}><span className="break-words">{option.label}</span>{value === option.value && <Check size={16} className="shrink-0 text-accent" aria-hidden />}</div>)}
    </div>}
  </div>;
}
