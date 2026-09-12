"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckResult, DetailRequest, Installation, Inventory, Operation, PlanRequest, SourceSkill, Taxonomy } from "@/lib/skill-center/types";
import { allDomains, centerRequest, errorMessage, type DomainFilter } from "./client";
import { FocusSurface, Status, Tabs, Toast } from "./Shared";
import { Discover, initialDiscover, type DiscoverState } from "./Discover";
import { Manage } from "./Manage";
import { ClassificationEditor } from "./ClassificationEditor";
import { SkillDetail } from "./Detail";
import { OperationPanel, operationLabels, operationStorageKey } from "./OperationPanel";

type Tab = "discover" | "installed" | "updates";
type WriteStatus = { busy: boolean; operationId: string | null; recoverable: boolean };
let navigation: { tab: Tab; discover: DiscoverState; management: DomainFilter; query: string } = { tab: "discover", discover: initialDiscover, management: allDomains, query: "" };
function restoreNavigation() {
  try { const saved = JSON.parse(sessionStorage.getItem("pi-skill-center-view") ?? "null"); if (saved && ["discover","installed","updates"].includes(saved.tab) && saved.discover && saved.management && typeof saved.query === "string") navigation = saved; } catch { /* Storage may be unavailable. */ }
  return navigation;
}
export function SkillsCenter({ cwd, onClose }: { cwd: string | null; onClose: () => void }) {
  const [saved] = useState(restoreNavigation);
  const [tab, setTab] = useState<Tab>(saved.tab); const [discover, setDiscover] = useState(saved.discover); const [management, setManagement] = useState(saved.management); const [query, setQuery] = useState(saved.query);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null); const [limits, setLimits] = useState<{maxQueryLength:number} | null>(null); const [taxonomyError, setTaxonomyError] = useState("");
  const [list, setList] = useState<Inventory | null>(null); const [listError, setListError] = useState(""); const [reading, setReading] = useState(false);
  const [detail, setDetail] = useState<DetailRequest | null>(null); const [plan, setPlan] = useState<PlanRequest | null>(null); const [op, setOp] = useState<Operation | null>(null); const [showOperation, setShowOperation] = useState(false);
  const [checks, setChecks] = useState<Record<string,CheckResult>>({}); const [checking, setChecking] = useState(false); const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState("");
  const [writer, setWriter] = useState<WriteStatus | null>(null);
  const [classifying, setClassifying] = useState<Installation | null>(null);
  const [counts, setCounts] = useState<Record<string,number>>({});
  const contextEpoch = useRef(0); const inventoryEpoch = useRef(0); const scroller = useRef<HTMLDivElement>(null); const previousPosition = useRef({ top: 0, focus: null as HTMLElement | null });
  const activeCwd = useRef(cwd);
  const taxonomyEpoch = useRef(0);
  useEffect(() => {activeCwd.current=cwd;},[cwd]);
  useEffect(() => { navigation = { tab, discover, management, query }; try {sessionStorage.setItem("pi-skill-center-view",JSON.stringify(navigation));} catch { /* best effort */ } }, [tab, discover, management, query]);
  const refreshTaxonomy = useCallback(async () => {
    const seq = ++taxonomyEpoch.current;
    try { const value = await centerRequest<{taxonomy:Taxonomy;counts:{domainId:string;indexedUnique:number}[];limits:{maxQueryLength:number};diagnostics:{message:string}[]}>("taxonomy"); if(seq !== taxonomyEpoch.current)return; setTaxonomy(value.taxonomy); setCounts(Object.fromEntries(value.counts.map(c=>[c.domainId,c.indexedUnique]))); setLimits(value.limits); setTaxonomyError(value.diagnostics.map(d=>d.message).join(" ")); } catch(e) { if(seq === taxonomyEpoch.current)setTaxonomyError(errorMessage(e)); }
  }, []);
  const refreshWriter = useCallback(async () => { try { setWriter(await centerRequest<WriteStatus>("write-status")); } catch(e) { setNotice(errorMessage(e)); } }, []);
  const refresh = useCallback(async () => {
    if (activeCwd.current !== cwd) return;
    const seq = ++inventoryEpoch.current; setReading(true);
    try { const value = await centerRequest<Inventory>("inventory/query", { cwd }); if (seq === inventoryEpoch.current) { setList(value); setListError(""); } }
    catch(e) { if (seq === inventoryEpoch.current) setListError(`${errorMessage(e)} 已有数据仅供阅读，请刷新后再操作。`); }
    finally { if (seq === inventoryEpoch.current) setReading(false); }
  }, [cwd]);
  useEffect(() => { const inventorySequence = inventoryEpoch; const contextSequence = contextEpoch; ++contextSequence.current; setList(null); setChecks({}); setChecking(false); setPlan(null); setDetail(null); setClassifying(null); void refresh(); return () => { ++inventorySequence.current; ++contextSequence.current; }; }, [refresh]);
  useEffect(() => { void refreshTaxonomy(); }, [refreshTaxonomy]);
  useEffect(() => {
    if (!taxonomy) return;
    const valid = (domain: string | null, category: string | null) => !domain || taxonomy.domains.some(d => d.id === domain && (!category || d.categories.some(c => c.id === category)));
    if (!valid(discover.domainId, discover.categoryId)) { setDiscover(v => ({...v,domainId:null,categoryId:null})); setNotice("分类已更新，请重新选择。"); }
    if (!valid(management.domainId, management.categoryId)) { setManagement(allDomains); setNotice("分类已更新，请重新选择。"); }
  }, [taxonomy, discover.domainId, discover.categoryId, management.domainId, management.categoryId]);
  useEffect(() => {
    void refreshWriter();
    const visible = () => { if (document.visibilityState === "visible") { void refresh(); void refreshTaxonomy(); void refreshWriter(); } };
    document.addEventListener("visibilitychange", visible); return () => document.removeEventListener("visibilitychange", visible);
  }, [refresh, refreshTaxonomy, refreshWriter]);
  useEffect(() => {
    let alive = true;
    let id: string | null = null; try { id = localStorage.getItem(operationStorageKey); } catch { /* Server recovery remains available. */ }
    if (id) void centerRequest<Operation>(`operations/${id}`).then(value => { if (alive) setOp(value); }).catch(e => { if (alive) setNotice(errorMessage(e)); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!op || !op.pollAfterMs) return; let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!active) return;
      if (document.visibilityState === "visible") try { const value = await centerRequest<Operation>(`operations/${op.operationId}`); if (active) { setOp(value); if (value.state === "succeeded") void refresh(); } } catch(e) { if (active) setNotice(errorMessage(e)); }
      if (active) timer = setTimeout(poll, op.pollAfterMs!);
    };
    const visible = () => { if (document.visibilityState === "visible") { clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange",visible);
    timer = setTimeout(poll, op.pollAfterMs); return () => { active = false; clearTimeout(timer); document.removeEventListener("visibilitychange",visible); };
  }, [op, refresh]);
  async function check(ids?: string[]) {
    const seq = contextEpoch.current; setChecking(true); setNotice("");
    try { const result = await centerRequest<{results:CheckResult[]}>("checks", { cwd, ...(ids === undefined ? {} : {installationIds:ids}) }); if (seq === contextEpoch.current) setChecks(v => ({...v,...Object.fromEntries(result.results.map(r=>[r.installationId,r]))})); }
    catch(e) { if (seq === contextEpoch.current) setNotice(errorMessage(e)); } finally { if (seq === contextEpoch.current) setChecking(false); }
  }
  function openDetail(request: DetailRequest) { previousPosition.current = {top:scroller.current?.scrollTop ?? 0,focus:document.activeElement as HTMLElement}; setDetail(request); scroller.current?.scrollTo(0,0); }
  function back() { setDetail(null); requestAnimationFrame(() => { scroller.current?.scrollTo(0,previousPosition.current.top); previousPosition.current.focus?.focus({preventScroll:true}); }); }
  function install(skill: SourceSkill) { setShowOperation(false); setPlan({kind:"install",canonicalSkillId:skill.canonicalSkillId,cwd,scope:cwd ? "project":"global"}); }
  function closePanel() { setPlan(null); setShowOperation(false); }
  function selectTab(next: Tab) {
    setTab(next);
    if (next === "discover") {
      setDiscover({ ...initialDiscover });
      setDetail(null);
      scroller.current?.scrollTo(0, 0);
    }
  }
  return <FocusSurface className="skill-center" label="技能中心" onClose={onClose}>
    <header className="sc-topbar"><strong>Pi Web</strong><details><summary>{cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? "未选择项目"}</summary><code>{cwd ?? "只管理此主机全局配置"}</code></details><div className="sc-topbar-actions">{op?.state === "succeeded" && <button onClick={() => {setPlan(null);setShowOperation(true);}}>最近操作</button>}<button onClick={onClose}>返回工作台</button></div></header>
    <div className="sc-scroll" ref={scroller}><div className="sc-content"><h1>技能中心</h1><p className="sc-subtitle">跨领域发现、安装与管理 AI 技能</p>
      {op && op.state !== "succeeded" && <Status><button onClick={() => {setPlan(null);setShowOperation(true);}}>{op.skillName} · {operationLabels[op.state]} · {op.projectLabel ?? "全局"}</button></Status>}
      {writer?.busy && <Status>此主机有技能写入正在进行或等待核验。{writer.operationId && <button onClick={() => void centerRequest<Operation>(`operations/${writer.operationId}`).then(value=>{setOp(value);setPlan(null);setShowOperation(true);}).catch(e=>setNotice(errorMessage(e)))}>查看原操作</button>}{writer.recoverable && <button onClick={() => void centerRequest<WriteStatus>("write-status/reconcile",{}).then(value=>{setWriter(value);setNotice("已恢复未启动命令的中断记录，可重新预检。");}).catch(e=>setNotice(errorMessage(e)))}>恢复中断记录</button>}<button onClick={() => void refreshWriter()}>刷新写入状态</button></Status>}

      {taxonomyError && <Status error>{taxonomyError}<button onClick={() => void refreshTaxonomy()}>重读分类</button></Status>}
      {listError && <Status error>{listError}<button onClick={() => void refresh()}>重读清单</button></Status>}
      {!detail && <Tabs value={tab} onChange={selectTab} label="技能中心操作" items={[{id:"discover",label:"发现"},{id:"installed",label:"已安装"},{id:"updates",label:"更新"}]} />}
      {list?.coverage.project === "untrusted" && <Status>该项目的资源尚未加载。全局技能仍可管理；请返回工作台完成现有项目信任流程。</Status>}
      {list && list.diagnostics.length > 0 && <details className="sc-diagnostics"><summary>诊断（{list.diagnostics.length}）</summary>{list.diagnostics.map((d,index) => <div key={`${d.id}-${index}`}><strong>{d.message}</strong>{d.paths.map(p => <code key={p}>{p}</code>)}</div>)}</details>}
      <div hidden={Boolean(detail)} role="tabpanel" id={`sc-panel-${tab}`} aria-labelledby={`sc-tab-${tab}`}>
        <div hidden={tab !== "discover"}><Discover counts={counts} taxonomy={taxonomy} inventory={list} state={discover} setState={setDiscover} onDetail={s => openDetail({kind:"remote",canonicalSkillId:s.canonicalSkillId})} onInstall={install} onManage={s => {setQuery(s.canonicalSkillId);setManagement(allDomains);setTab("installed");requestAnimationFrame(() => document.getElementById("sc-tab-installed")?.focus());}} maxQueryLength={limits?.maxQueryLength} /></div>
        {tab !== "discover" && <>{reading && !list && <Status>正在刷新本地清单…</Status>}<Manage refreshing={reading} onClassify={setClassifying} key={tab} cwd={cwd} tab={tab} inventory={list} taxonomy={taxonomy} filter={management} setFilter={setManagement} query={query} setQuery={setQuery} onRefresh={() => void refresh()} checks={checks} onCheck={ids => void check(ids)} checking={checking} onDetail={i => openDetail({kind:"installed",installationId:i.installationId,cwd})} onUpdate={i => {setShowOperation(false);setPlan({kind:"update",installationId:i.installationId,cwd,expectedRevision:i.revision});}} onDiscover={() => selectTab("discover")} /></>}
      </div>
      {detail && <SkillDetail onClassify={setClassifying} request={detail} taxonomy={taxonomy} inventory={list} onBack={back} onInstall={install} onManage={s => {setDetail(null);setQuery(s.canonicalSkillId);setManagement(allDomains);setTab("installed");requestAnimationFrame(() => document.getElementById("sc-tab-installed")?.focus());}} />}
    </div></div>
    {notice ? <Toast message={notice} onClose={() => setNotice("")} /> : success && <Toast message={success} success onClose={() => setSuccess("")} />}
    {classifying && taxonomy && <ClassificationEditor key={classifying.installationId} item={classifying} cwd={cwd} taxonomy={taxonomy} onClose={() => setClassifying(null)} onSaved={() => { setSuccess("分类已保存。"); void refresh(); void refreshTaxonomy(); }} />}
    {(plan || showOperation) && <OperationPanel taxonomy={taxonomy} request={plan} operation={showOperation ? op : null} onClose={closePanel} onOperation={value => {setOp(value);setShowOperation(true);setPlan(null);if(value.state === "succeeded") void refresh();}} onInstalled={value => {closePanel();setDetail(null);setTab("installed");requestAnimationFrame(() => document.getElementById("sc-tab-installed")?.focus());setQuery(value.result?.installationId ? `instance:${value.result.installationId}` : value.skillName);setManagement(allDomains);void refresh();if (value.projectLabel !== cwd) setNotice(`操作属于 ${value.projectLabel ?? "全局配置"}；当前列表仍按所选项目读取。`);}} />}
  </FocusSurface>;
}
