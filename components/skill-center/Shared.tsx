"use client";
import { Select } from "./Select";
import { CheckCircle2, Info, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { Classification, Taxonomy } from "@/lib/skill-center/types";
import type { DomainFilter } from "./client";

export function DomainTags({ value, taxonomy }: { value: Classification; taxonomy: Taxonomy | null }) {
  const labels = [...new Set(value.assignments.map(a => {
    const d = taxonomy?.domains.find(d => d.id === a.domainId);
    return `${d?.label ?? a.domainId}${a.categoryId ? ` / ${d?.categories.find(c => c.id === a.categoryId)?.label ?? a.categoryId}` : ""}`;
  }))];
  return <span className="sc-tags">{labels.length ? labels.map(label => <span className="sc-tag" key={label}>{label}</span>) : <span className="sc-tag">待分类</span>}</span>;
}
export function DomainSelect({ taxonomy, value, onChange }: { taxonomy: Taxonomy | null; value: DomainFilter; onChange: (filter: DomainFilter) => void }) {
  return <>
    <label>领域范围<Select label="领域范围" value={value.classificationState === "unclassified" ? "unclassified" : value.domainId ?? ""} onChange={selected => onChange({ domainId: selected && selected !== "unclassified" ? selected : null, categoryId: null, classificationState: selected === "unclassified" ? "unclassified" : "all" })}><option value="">全部领域</option>{taxonomy?.domains.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}<option value="unclassified">待分类</option></Select></label>
    {value.domainId && <label>细分方向<Select label="细分方向" value={value.categoryId ?? ""} onChange={selected => onChange({ ...value, categoryId: selected || null })}><option value="">全部方向</option>{taxonomy?.domains.find(d => d.id === value.domainId)?.categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></label>}
  </>;
}
export function Status({ error, children }: { error?: boolean; children: ReactNode }) { return <div className={`sc-status${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{children}</div>; }
// Brief confirmations disappear; actionable notices remain until dismissed.
const SUCCESS_NOTICE_MS = 5000;
export function Toast({ message, success = false, onClose }: { message: string; success?: boolean; onClose: () => void }) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => close.current(), SUCCESS_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [message, success]);
  return <div className="sc-toast" role="status"><span className="text-accent shrink-0">{success ? <CheckCircle2 size={20} aria-hidden /> : <Info size={20} aria-hidden />}</span><span>{message}</span><button type="button" aria-label="关闭提示" onClick={onClose}><X size={16} aria-hidden /></button></div>;
}
export function Tabs<T extends string>({ value, items, onChange, label }: { value: T; items: { id: T; label: string }[]; onChange: (id: T) => void; label: string }) {
  return <div className="sc-tabs" role="tablist" aria-label={label}>{items.map((item, index) => <button type="button" key={item.id} role="tab" id={`sc-tab-${item.id}`} aria-selected={value === item.id} aria-controls={`sc-panel-${item.id}`} tabIndex={value === item.id ? 0 : -1} onClick={() => onChange(item.id)} onKeyDown={e => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault(); const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    onChange(items[next].id); (e.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
  }}>{item.label}</button>)}</div>;
}
export function FocusSurface({ children, onClose, className = "", label }: { children: ReactNode; onClose: () => void; className?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => { if (previous?.isConnected) previous.focus({preventScroll:true}); };
  }, []);
  return <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={className} onKeyDown={e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(); }
    if (e.key !== "Tab") return;
    const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary,[tabindex="0"]') ?? [])].filter(el => el.getClientRects().length);
    const first = nodes[0]; const last = nodes.at(-1);
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { e.preventDefault(); first.focus(); }
  }}>{children}</div>;
}
