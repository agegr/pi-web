"use client";
import { useState } from "react";
import { Check, FolderTree, X } from "lucide-react";
import type { Classification, Installation, Taxonomy } from "@/lib/skill-center/types";
import { centerRequest, errorMessage } from "./client";
import { DomainTags, FocusSurface, Status } from "./Shared";

export function ClassificationEditor({ item, cwd, taxonomy, onClose, onSaved }: { item: Installation; cwd: string | null; taxonomy: Taxonomy; onClose: () => void; onSaved: () => void }) {
  const [assignments, setAssignments] = useState(item.classification.assignments);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  function domain(id: string, checked: boolean) { setAssignments(v => checked ? [...v,{domainId:id as Classification["assignments"][number]["domainId"],categoryId:null}] : v.filter(a => a.domainId !== id)); }
  function category(domainId: Classification["assignments"][number]["domainId"], categoryId: string, checked: boolean) {
    setAssignments(v => { const rest = v.filter(a => a.domainId !== domainId || a.categoryId !== null && a.categoryId !== categoryId); if (checked) rest.push({domainId,categoryId}); if (!rest.some(a => a.domainId === domainId)) rest.push({domainId,categoryId:null}); return rest; });
  }
  async function save(reset = false) {
    setSaving(true); setError("");
    try { await centerRequest(`installations/${item.installationId}/classification`, { cwd, expectedRevision:item.revision, expectedClassificationRevision:item.classification.personalRevision ?? null, taxonomyVersion:taxonomy.version,indexRevision:taxonomy.indexRevision,assignments,reset }, "PATCH"); onSaved(); onClose(); }
    catch (e) { setError(errorMessage(e)); } finally { setSaving(false); }
  }
  return <div className="sc-drawer-backdrop"><FocusSurface className="sc-drawer sc-classification-editor" label="设置技能分类" onClose={() => { if (!saving) onClose(); }}>
    <header><div className="flex items-center gap-3"><span className="rounded-[var(--radius-control)] bg-bg-selected p-2 text-accent"><FolderTree size={20} aria-hidden /></span><h2>设置分类</h2></div><button type="button" onClick={onClose} disabled={saving} aria-label="关闭分类面板"><X size={18} aria-hidden /></button></header>
    <div className="sc-drawer-body"><h3 className="break-words">{item.name}</h3><p className="sc-muted">{item.canonicalSkillId ? "同一来源技能在项目与全局共享此分类。" : "分类仅用于这个本地安装实例。"}分类不会修改 SKILL.md。</p>
      <div className="mb-5 rounded-[var(--radius-panel)] border border-border bg-bg-panel p-4"><span className="mb-2 block text-xs font-medium text-text-muted">已选择 · {new Set(assignments.map(a => a.domainId)).size} 个领域</span><DomainTags value={{...item.classification,assignments}} taxonomy={taxonomy} /></div>
      <fieldset disabled={saving} className="sc-classification-options"><legend className="mb-3 text-sm font-semibold text-text">选择领域，可跨领域多选</legend><div className="space-y-3">{taxonomy.domains.map(d => {
        const selected = assignments.some(a => a.domainId === d.id);
        return <section key={d.id} className={`overflow-hidden rounded-[var(--radius-panel)] border transition-colors ${selected ? "border-accent bg-bg-selected" : "border-border bg-bg"}`}>
          <label className="sc-classification-domain"><input type="checkbox" checked={selected} onChange={e => domain(d.id,e.target.checked)} /><span className="min-w-0"><span className="block font-semibold text-text">{d.label}</span><span className="mt-1 block text-xs text-text-muted">{d.description}</span></span>{selected && <Check size={18} className="ml-auto shrink-0 text-accent" aria-hidden />}</label>
          {selected && <div className="border-t border-border bg-bg px-4 pb-4 pt-3"><span className="mb-2 block text-xs text-text-muted">细分方向（可多选，也可只选领域）</span><div className="flex flex-wrap gap-2">{d.categories.map(c => <label key={c.id} className="sc-category-option"><input type="checkbox" checked={assignments.some(a => a.domainId === d.id && a.categoryId === c.id)} onChange={e => category(d.id,c.id,e.target.checked)} /><span>{c.label}</span></label>)}</div></div>}
        </section>;
      })}</div></fieldset>
      {error && <Status error>{error} 可关闭面板后刷新清单，再重新编辑。</Status>}
    </div><footer><button type="button" disabled={saving} onClick={() => setAssignments([])}>清空选择</button>{item.classification.origin === "personal" && <button type="button" disabled={saving} onClick={() => void save(true)}>恢复默认</button>}<div className="ml-auto flex gap-2"><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="button" className="sc-primary" disabled={saving} onClick={() => void save()}>{saving ? "正在保存…" : "保存分类"}</button></div></footer>
  </FocusSurface></div>;
}
