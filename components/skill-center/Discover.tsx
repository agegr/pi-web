"use client";
import { Select } from "./Select";
import { useEffect, useRef, useState } from "react";
import type { Inventory, SourceSkill, Taxonomy, QueryCoverage } from "@/lib/skill-center/types";
import { centerRequest, errorMessage, matchesDomain, type DomainFilter } from "./client";
import { DomainTags, Status } from "./Shared";
import { providerLabels, isProvider } from "@/lib/skill-center/provider-labels";
import { formatInstallCount, installCountSortValue } from "@/lib/skill-center/install-count";
import { Laptop, ChartNoAxesColumnIncreasing, BookOpen, Brain, Eclipse } from "lucide-react";

const domainIcons = { computing: Laptop, finance: ChartNoAxesColumnIncreasing, philosophy: BookOpen, psychology: Brain, metaphysics: Eclipse };

export interface DiscoverState { domainId: string | null; categoryId: string | null; query: string; input: string; external: boolean; provider?: SourceSkill["provider"]; sort: "source" | "installs" }
export const initialDiscover: DiscoverState = { domainId: null, categoryId: null, query: "", input: "", external: false, provider: "skills.sh", sort: "source" };
type Results = { results: SourceSkill[]; coverage: QueryCoverage; searchMode?: string; taxonomyVersion: string; indexRevision: string };
export function Discover({ counts, taxonomy, inventory, state, setState, onDetail, onInstall, onManage, maxQueryLength }: { counts: Record<string,number>; taxonomy: Taxonomy | null; inventory: Inventory | null; state: DiscoverState; setState: (s: DiscoverState) => void; onDetail: (s: SourceSkill) => void; onInstall: (s: SourceSkill) => void; onManage: (s: SourceSkill) => void; maxQueryLength: number | undefined }) {
  const [data, setData] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  const epoch = useRef(0);
  const provider = isProvider(state.provider) ? state.provider : "skills.sh";
  const domain = taxonomy?.domains.find(d => d.id === state.domainId);
  useEffect(() => {
    const seq = ++epoch.current; const controller = new AbortController();
    if (!taxonomy && !state.external || state.external && !state.query) { setData(null); setBusy(false); setError(""); return; }
    setBusy(true); setError(""); setData(null);
    void centerRequest<Results>(state.external ? "search" : "catalog/query", { provider: state.external ? provider : undefined, query: state.query, domainId: state.domainId, categoryId: state.categoryId }, "POST", controller.signal).then(result => { if (seq === epoch.current) setData(result); }).catch(e => { if (seq === epoch.current && !controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (seq === epoch.current) setBusy(false); });
    return () => { controller.abort(); };
  }, [taxonomy, state.external, state.query, state.domainId, state.categoryId, provider, retry]);
  const changeDomain = (id: string | null) => setState({ ...state, domainId: id, categoryId: null });
  const filter: DomainFilter = { domainId: state.domainId, categoryId: state.categoryId, classificationState: "all" };
  const results = state.sort === "installs" ? [...(data?.results ?? [])].sort((a,b) => (provider === "skillsmp" ? (b.repositoryStars ?? -1) - (a.repositoryStars ?? -1) : installCountSortValue(b.installCount) - installCountSortValue(a.installCount))) : data?.results ?? [];
  const groups = state.external && state.domainId ? [
    { label: "当前领域", values: results.filter(s => matchesDomain(s.classification, filter)) },
    { label: "待分类", values: results.filter(s => s.classification.state === "unclassified") },
    { label: "其他领域或细分方向", values: results.filter(s => s.classification.state === "classified" && !matchesDomain(s.classification, filter)) },
  ] : [{ label: state.external ? "本次外部结果" : "已收录目录", values: results }];
  return <>
    {state.domainId && <>
      <nav className="sc-domain-nav" aria-label="发现领域">{taxonomy?.domains.map(d => <button key={d.id} aria-current={d.id === state.domainId ? "page" : undefined} onClick={() => changeDomain(d.id)}>{d.label}</button>)}</nav>
      <label className="sc-domain-mobile">发现领域<Select label="发现领域" value={state.domainId} onChange={selected => changeDomain(selected)}>{taxonomy?.domains.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</Select></label>
      <div className="sc-breadcrumb"><button onClick={() => { changeDomain(null); requestAnimationFrame(() => document.getElementById(`sc-domain-${state.domainId}`)?.focus()); }}>全部领域</button><span>/ {domain?.label}</span></div>
      <h2>{domain?.label}</h2><p className="sc-muted">{domain?.description}</p>
    </>}
    {state.external && <div className="sc-result-heading"><label>技能来源<Select label="技能来源" value={provider} onChange={value => { if (isProvider(value)) { setData(null); setState({ ...state, provider: value, sort: "source" }); } }}>{Object.entries(providerLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select></label><button onClick={() => setState({ ...state, external: false })}>返回已收录目录</button></div>}
    <form className="sc-search" onSubmit={e => { e.preventDefault(); setState({ ...state, query: state.input.trim() }); }}>
      <input type="search" aria-label={state.external ? "外部搜索关键词" : "目录搜索关键词"} placeholder={state.external ? `搜索 ${providerLabels[provider]} 的技能` : `搜索${domain?.label ?? "全部领域"}的已收录技能`} value={state.input} onChange={e => setState({ ...state, input: e.target.value })} />
      <button className="sc-primary" type="submit" disabled={maxQueryLength !== undefined && [...state.input.trim()].length > maxQueryLength}>搜索</button>{state.input && <button type="button" onClick={() => setState({ ...state, query: "", input: "" })}>清除</button>}
    </form>
    {maxQueryLength !== undefined && [...state.input.trim()].length > maxQueryLength && <Status error>关键词最多 {maxQueryLength} 个字符。</Status>}
    {state.external && domain && <div className="sc-chips"><span>外部快捷搜索</span>{domain?.quickQueries.map(q => <button key={q} onClick={() => setState({ ...state, input: q, query: q })}>{q}</button>)}</div>}
    {!state.domainId && !state.external && !state.query && taxonomy && <section aria-labelledby="sc-explore"><h2 id="sc-explore">按领域探索</h2><div className="sc-domains">{taxonomy.domains.map(d => <button className="sc-domain-row" key={d.id} id={`sc-domain-${d.id}`} onClick={() => changeDomain(d.id)}><span className="sc-domain-icon">{(() => { const Icon = domainIcons[d.id]; return <Icon size={32} strokeWidth={1.7} aria-hidden />; })()}</span><span className="sc-domain-title"><strong>{d.label}</strong><span>{d.description}</span></span><span className="sc-domain-summary">{d.categories.map(c => c.label).join(" · ")}</span><span className="sc-domain-enter">本地已收录 {counts[d.id] ?? "—"} 项<br />进入领域</span></button>)}</div></section>}
    {state.domainId && !state.external && domain && <div className="sc-chips" aria-label="细分方向"><span>细分方向</span><button aria-pressed={!state.categoryId} onClick={() => setState({ ...state, categoryId: null })}>全部方向</button>{domain?.categories.map(c => <button aria-pressed={state.categoryId === c.id} key={c.id} onClick={() => setState({ ...state, categoryId: c.id })}>{c.label}</button>)}</div>}
    {busy && <Status>正在搜索…</Status>}
    {error && <Status error>{error}<button onClick={() => setRetry(v => v + 1)}>重试搜索</button></Status>}
    {(!state.external && (!taxonomy || !state.domainId && !state.query)) ? null : <>
      <div className="sc-result-heading"><p aria-live="polite">{state.external ? `本次返回 ${data?.results.length ?? "—"} 项` : `本地已收录 · 匹配 ${data?.coverage.totalMatched ?? "—"} 项`}</p><label>排序<Select label="排序" value={state.sort} onChange={selected => setState({ ...state, sort: selected as DiscoverState["sort"] })}><option value="source">{state.external ? "源站顺序" : "目录顺序"}</option><option value="installs">{provider === "skillsmp" && state.external ? "GitHub 星标" : "安装量"}</option></Select></label></div>
      {data?.searchMode === "cli" && <p className="sc-muted">通过命令行搜索获得</p>}

      {groups.map(group => <section key={group.label} aria-label={group.label}>{groups.length > 1 && <h3>{group.label}（{group.values.length}）</h3>}<div className="sc-cards">{group.values.map(s => {
        const matches = inventory?.installations.filter(i => i.canonicalSkillId === s.canonicalSkillId) ?? [];
        return <article className="sc-card" key={s.canonicalSkillId}><button className="sc-card-title" onClick={() => onDetail(s)}>{s.name}</button><p>{s.description ?? "来源未提供用途说明"}</p><small className="sc-muted">{providerLabels[s.provider]} · {s.source}</small><DomainTags value={s.classification} taxonomy={taxonomy} /><div className="sc-card-bottom"><span className="sc-small">{s.provider === "skillsmp" ? s.repositoryStars == null ? "GitHub 星标未提供" : `${s.repositoryStars.toLocaleString("zh-CN")} GitHub 星标` : formatInstallCount(s.installCount)}<br />{matches.length ? [...new Set(matches.flatMap(i => i.aliases.map(a => a.scope)))].map(scope => scope === "project" ? "项目已安装" : scope === "global" ? "全局已安装" : "已安装").join(" · ") : !inventory || inventory.coverage.project === "untrusted" ? "安装状态未确认" : "未安装"}</span><button disabled={busy} className="sc-primary" onClick={() => matches.length ? onManage(s) : onInstall(s)}>{matches.length ? "管理" : "安装…"}</button></div></article>;
      })}</div></section>)}
      {!busy && !error && !results.length && <Status>{state.external ? state.query ? "本次外部搜索没有结果，请调整关键词。" : "输入关键词，开始外部搜索。" : state.categoryId ? "该细分方向暂未收录技能" : "该领域暂未收录技能"}</Status>}
      {data && <p className="sc-muted sc-small">{data.coverage.description}{data.coverage.truncated && " 结果已截取，请缩小查询范围。"}</p>}
    </>}
    {!state.external && <div className="sc-external"><span>还没找到需要的技能？</span>{Object.entries(providerLabels).map(([id, label]) => <button key={id} onClick={() => setState({ ...state, provider: id as SourceSkill["provider"], external: true, sort: "source", query: state.input.trim() })}>{label}</button>)}</div>}
  </>;
}
