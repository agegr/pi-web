"use client";
import { Select } from "./Select";
import { useMemo, useState } from "react";
import { ConfigSwitch } from "@/components/SettingsUi";
import type { CheckResult, Installation, Inventory, Taxonomy } from "@/lib/skill-center/types";
import { allDomains, centerRequest, errorMessage, loadLabels, matchesDomain, matchesInstallationQuery, scopeLabel, updateLabels, type DomainFilter } from "./client";
import { DomainSelect, DomainTags, Status } from "./Shared";

export function Manage({ refreshing = false, cwd, tab, inventory, taxonomy, filter, setFilter, onRefresh, checks, onCheck, checking, onDetail, onUpdate, query, setQuery, onDiscover, onClassify }: { refreshing?: boolean; cwd: string | null; tab: "installed" | "updates"; inventory: Inventory | null; taxonomy: Taxonomy | null; filter: DomainFilter; setFilter: (f: DomainFilter) => void; onRefresh: () => void; checks: Record<string, CheckResult>; onCheck: (ids?: string[]) => void; checking: boolean; onDetail: (i: Installation) => void; onUpdate: (i: Installation) => void; query: string; setQuery: (q: string) => void; onDiscover: () => void; onClassify: (item: Installation) => void }) {
  const [scope, setScope] = useState(""); const [source, setSource] = useState(""); const [shown, setShown] = useState(""); const [load, setLoad] = useState(""); const [status, setStatus] = useState(tab === "updates" ? "update-available" : "");
  const [saving, setSaving] = useState<string | null>(null); const [message, setMessage] = useState<Record<string, string>>({}); const [shared, setShared] = useState<string | null>(null);
  const rows = useMemo(() => (inventory?.installations ?? []).filter(i => {
    const update = checks[i.installationId];
    const state = update?.stale || update?.basedOnRevision !== i.revision ? "unchecked" : update?.state ?? "unchecked";
    return matchesDomain(i.classification, filter) && matchesInstallationQuery(i, query) && (!scope || i.aliases.some(a => a.scope === scope)) && (!source || (i.source ?? "unknown") === source) && (!shown || i.disableModelInvocation !== null && String(!i.disableModelInvocation) === shown) && (!load || i.loadState === load) && (!status || state === status);
  }), [inventory, checks, filter, query, scope, source, shown, load, status]);
  async function toggle(item: Installation, confirmed = false) {
    if (item.aliases.length > 1 && !confirmed) { setShared(item.installationId); return; }
    const id = item.installationId; setSaving(id); setMessage(v => ({ ...v, [id]: "" }));
    try {
      await centerRequest(`installations/${id}/visibility`, { cwd, expectedRevision: item.revision, disableModelInvocation: !item.disableModelInvocation, acknowledgeSharedFile: confirmed }, "PATCH");
      setMessage(v => ({ ...v, [id]: "已保存，下次加载资源生效。" })); setShared(null); onRefresh();
    } catch (e) { setMessage(v => ({ ...v, [id]: errorMessage(e) })); }
    finally { setSaving(null); }
  }
  const locating = /^(?:skills\.sh|skillsmp|agentskill\.sh):/.test(query) || query.startsWith("instance:");
  const locatedName = locating ? inventory?.installations.find(item => matchesInstallationQuery(item, query))?.name : null;
  const total = inventory?.installations.length ?? 0;
  const counts = (inventory?.installations ?? []).reduce<Record<string, number>>((sum, item) => { const c = checks[item.installationId]; const state = !c || c.stale || c.basedOnRevision !== item.revision ? "unchecked" : c.state; sum[state] = (sum[state] ?? 0) + 1; return sum; }, {});
  function reset() { setFilter(allDomains); setQuery(""); setScope(""); setSource(""); setShown(""); setLoad(""); setStatus(""); }
  return <>
    <div className="sc-result-heading"><div><h2>{tab === "installed" ? "已安装的技能" : "技能更新"}</h2><p className="sc-muted">当前项目与全局的可访问技能</p></div><div className="sc-actions"><button disabled={refreshing} onClick={onRefresh}>{refreshing ? "刷新中…" : "刷新清单"}</button>{tab === "updates" && <button className="sc-primary" disabled={checking} onClick={() => onCheck()}>{checking ? "正在检查全部领域…" : "检查全部领域"}</button>}</div></div>
    <div className="sc-filters"><label className="sc-grow">搜索本地技能<input type="search" value={locating ? "" : query} onChange={e => setQuery(e.target.value)} placeholder="按名称、用途或来源查找" /></label><DomainSelect taxonomy={taxonomy} value={filter} onChange={setFilter} /><label>位置<Select label="位置" value={scope} onChange={selected => setScope(selected)}><option value="">全部位置</option>{["project","global","other"].map(s => <option key={s} value={s}>{scopeLabel(s)}</option>)}</Select></label><label>更新状态<Select label="更新状态" value={status} onChange={selected => setStatus(selected)}><option value="">全部状态</option>{Object.entries(updateLabels).filter(([k]) => k !== "checking").map(([key,label]) => <option key={key} value={key}>{label}</option>)}</Select></label></div>
    {locating && <p className="sc-muted">正在查看：{locatedName ?? "指定的安装实例"}<button onClick={() => setQuery("")}>显示全部技能</button></p>}
    <details className="sc-more-filters"><summary>更多筛选</summary><div className="sc-filters"><label>来源<Select label="来源" value={source} onChange={selected => setSource(selected)}><option value="">全部来源</option>{[...new Set(inventory?.installations.map(i => i.source ?? "unknown"))].map(s => <option key={s} value={s}>{s === "unknown" ? "来源未追踪" : s}</option>)}</Select></label><label>向模型展示<Select label="向模型展示" value={shown} onChange={selected => setShown(selected)}><option value="">全部</option><option value="true">展示</option><option value="false">隐藏</option></Select></label><label>当前配置加载<Select label="当前配置加载" value={load} onChange={selected => setLoad(selected)}><option value="">全部</option>{Object.entries(loadLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</Select></label></div></details>
    <div className="sc-result-heading"><span aria-live="polite">显示 {rows.length} / {total} 项{tab === "updates" ? ` · 筛选外 ${total - rows.length} 项（检查全部仍包含这些实例）` : ""}</span><button onClick={reset}>清除筛选</button></div>
    {tab === "updates" && <div className="sc-chips">{Object.entries(counts).map(([key,count]) => <button key={key} onClick={() => setStatus(key)}>{updateLabels[key as keyof typeof updateLabels]} {count}</button>)}</div>}
    <p className="sc-muted sc-small">向模型展示只影响提示信息；此设置不禁止手动调用。下次加载资源生效。</p>
    <div className="sc-table" role="table" aria-label={tab === "updates" ? "更新检查结果" : "本地安装实例"}>
      <div className="sc-table-head" role="row">{["技能 / 来源", "领域", "位置", "当前配置加载", "向模型展示", "更新状态", "操作"].map(label => <span role="columnheader" key={label}>{label}</span>)}</div>
      {rows.map(item => {
        const check = checks[item.installationId]; const stale = Boolean(check && (check.stale || check.basedOnRevision !== item.revision));
        const update = stale ? "unchecked" : check?.state ?? "unchecked";
        return <div key={item.installationId} className="sc-table-row" role="row" id={`sc-instance-${item.installationId}`}>
          <div role="cell" className="sc-cell-identity"><button className="sc-name" onClick={() => onDetail(item)}>{item.name}</button><small className="sc-muted">{item.source ?? "本地 · 来源未追踪"}</small></div>
          <div role="cell" className="sc-cell-classification"><span className="sc-cell-label">领域分类</span><DomainTags value={item.classification} taxonomy={taxonomy} /><button className="sc-classify-button" disabled={!taxonomy} onClick={() => onClassify(item)}>{item.classification.assignments.length ? "编辑分类" : "设置分类"}</button></div>
          <div role="cell" className="sc-cell-location"><span className="sc-cell-label">安装位置</span><span>{scopeLabel(item.scope)}</span><details><summary>查看位置</summary>{item.aliases.map(a => <code key={a.path}>{scopeLabel(a.scope)} · {a.path}</code>)}</details></div>
          <div role="cell" className="sc-cell-load"><span className="sc-cell-label">配置加载</span><span className="sc-tag">{loadLabels[item.loadState]}</span>{item.loadReason && <small>{item.loadReason}</small>}</div>
          <div role="cell" className="sc-cell-visibility"><span className="sc-cell-label">向模型展示</span><div className="sc-switch"><ConfigSwitch checked={item.disableModelInvocation === false} disabled={!item.capabilities.setVisibility || saving === item.installationId} label={`${item.name} · ${item.logicalPath} · 向模型展示`} onChange={() => void toggle(item)} /><span>{saving === item.installationId ? "保存中" : item.disableModelInvocation === null ? "未确认" : item.disableModelInvocation ? "隐藏" : "展示"}</span></div>
            {shared === item.installationId && <div className="sc-inline-confirm"><p>影响以上全部 {item.aliases.length} 个访问入口。</p><button onClick={() => void toggle(item, true)}>确认修改共享文件</button><button onClick={() => setShared(null)}>取消</button></div>}
            {message[item.installationId] && <small role="status">{message[item.installationId]}</small>}</div>
          <div role="cell" className="sc-cell-update"><span className="sc-cell-label">更新状态</span><span className={`sc-tag ${update === "update-available" ? "is-accent" : ""}`}>{updateLabels[update]}</span>{check && <small>{stale ? "文件已变化，请重查" : new Date(check.checkedAt).toLocaleString()}</small>}{check?.message && <small>{check.message}</small>}</div>
          <div role="cell" className="sc-row-actions">{update === "update-available" && !stale ? <button className="sc-primary" onClick={() => onUpdate(item)}>更新…</button> : <button disabled={checking} onClick={() => onCheck([item.installationId])}>检查更新</button>}<button onClick={() => onDetail(item)}>详情</button></div>
        </div>;
      })}
    </div>
    {!rows.length && <Status>{total ? "没有符合筛选的技能。" : "当前可访问范围尚无已安装技能。"}<button onClick={total ? reset : onDiscover}>{total ? "清除筛选" : "发现技能"}</button></Status>}
    {inventory && <p className="sc-muted sc-small">读取于 {new Date(inventory.readAt).toLocaleString()} · {inventory.coverage.description}</p>}
  </>;
}
