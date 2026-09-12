"use client";
import { useEffect, useRef, useState } from "react";
import type { Operation, Plan, PlanRequest, Taxonomy } from "@/lib/skill-center/types";
import { centerRequest, errorMessage, scopeLabel, updateLabels } from "./client";
import { DomainTags, FocusSurface, Status } from "./Shared";

export const operationStorageKey = "pi-skill-center-operation";
function rememberOperation(id: string) { try { localStorage.setItem(operationStorageKey,id); } catch { /* The server journal remains authoritative. */ } }
export const operationLabels: Record<Operation["state"], string> = { accepted: "已接受", running: "安装 / 更新中", verifying: "正在核验", succeeded: "已写入并核验", failed: "操作失败", "needs-review": "结果待确认" };
export function OperationPanel({ taxonomy, request, operation, onOperation, onClose, onInstalled }: { taxonomy: Taxonomy | null; request: PlanRequest | null; operation: Operation | null; onOperation: (op: Operation) => void; onClose: () => void; onInstalled: (op: Operation) => void }) {
  const [scope, setScope] = useState(request?.kind === "install" ? request.scope : "global");
  const [plan, setPlan] = useState<Plan | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [retry, setRetry] = useState(0); const [acks, setAcks] = useState<string[]>([]);
  const key = useRef<string | null>(null); const sent = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [operation?.state, operation?.operationId]);
  const previousRequest = useRef(request);
  useEffect(() => { if (previousRequest.current !== request) { previousRequest.current = request; if (request?.kind === "install") setScope(request.scope); } }, [request]);
  useEffect(() => {
    if (!request || operation) return; let alive = true; setPlan(null); setAcks([]); setError(""); key.current = null; sent.current = false;
    const next = request.kind === "install" ? { ...request, scope } : request;
    void centerRequest<Plan>("plans", next).then(p => { if (alive) setPlan(p); }).catch(e => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [request, scope, retry, operation]);
  async function submit() {
    if (!plan || sent.current) return; sent.current = true; setBusy(true); setError("");
    key.current ??= crypto.randomUUID();
    rememberOperation(plan.operationId);
    try { const result = await centerRequest<{ operation: Operation }>("operations", { planId: plan.planId, idempotencyKey: key.current, acknowledgements: acks }); rememberOperation(result.operation.operationId); onOperation(result.operation); }
    catch (e) { setError(`${errorMessage(e)} 可通过“查询本次提交”只读查询操作记录。操作编号：${plan.operationId}`); }
    finally { setBusy(false); }
  }
  async function recoverSubmission() {
    if (!plan || !key.current) return; setBusy(true);
    try { const result = await centerRequest<Operation>(`operations/${plan.operationId}`); rememberOperation(result.operationId); onOperation(result); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function reconcile() { if (!operation) return; setBusy(true); try { onOperation(await centerRequest<Operation>(`operations/${operation.operationId}/reconcile`, {})); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  return <div className="sc-drawer-backdrop"><FocusSurface className="sc-drawer" onClose={onClose} label={request?.kind === "update" ? "确认技能更新" : "确认技能安装"}>
    <header><h2 ref={heading} tabIndex={-1}>{operation ? operationLabels[operation.state] : request?.kind === "update" ? "更新技能" : "安装技能"}</h2><button onClick={onClose}>关闭视图</button></header><div className="sc-drawer-body">
      {operation ? <><h3>{operation.skillName}</h3><p>{scopeLabel(operation.scope)} · {operation.projectLabel ?? "此主机全局配置"}</p><code>{operation.targetPath}</code><Status>{operationLabels[operation.state]}{["accepted","running","verifying"].includes(operation.state) && "。关闭视图不会取消，操作继续运行。"}</Status>{operation.error && <Status error>{operation.error.message}（{operation.error.code}）</Status>}{operation.result && <><p>下次资源加载时按当前配置处理。</p><p>当前源状态：{updateLabels[operation.result.currentSourceStatus]}</p>{operation.result.actualVersion && <code>{operation.result.actualVersion.label} {operation.result.actualVersion.value}</code>}{operation.result.currentSourceStatus === "error" && <p>文件已更新，最新状态未确认。</p>}</>}{operation.outputExcerpt && <details><summary>操作日志</summary><pre className="sc-code">{operation.outputExcerpt}</pre></details>}<small>操作编号：{operation.operationId}</small></> : <>
        {plan && <><h3>{plan.skillName}</h3><p className="sc-muted">{plan.source}</p><p>领域归属</p><DomainTags value={plan.classification} taxonomy={taxonomy} /></>}
        {request?.kind === "install" && <fieldset disabled={busy || sent.current}><legend>安装范围</legend><label><input type="radio" name="scope" checked={scope === "project"} disabled={!request.cwd} onChange={() => setScope("project")} /> 当前项目{!request.cwd && "（未选择项目）"}</label><label><input type="radio" name="scope" checked={scope === "global"} onChange={() => setScope("global")} /> 全局配置</label><p className="sc-muted">全局安装写入此主机的全局技能位置。</p></fieldset>}
        {!plan && !error && <Status>正在解析来源、目标位置和安装状态…</Status>}
        {plan && <><h3>实际写入位置</h3><code>{plan.target.logicalPath}</code>{plan.target.realPath && <details><summary>物理位置与共享入口</summary><code>{plan.target.realPath}</code>{plan.target.sharedAliases.map(path => <code key={path}>{path}</code>)}</details>}<p>{scopeLabel(plan.scope)}</p>{plan.currentVersion && <p>当前：<code>{plan.currentVersion.label} {plan.currentVersion.value}</code></p>}{plan.observedSourceVersion && <p>预检读取：<code>{plan.observedSourceVersion.label} {plan.observedSourceVersion.value}</code></p>}{plan.notices.map(n => <p className="sc-muted" key={n}>{n}</p>)}{plan.blockers.map(b => <Status error key={b.code}>{b.message}</Status>)}{plan.requiredAcknowledgements.map(ack => <label className="sc-ack" key={ack}><input type="checkbox" disabled={sent.current} checked={acks.includes(ack)} onChange={e => setAcks(v => e.target.checked ? [...v,ack] : v.filter(a => a !== ack))} />{ack === "trust-project-resources" ? "我信任此项目，允许加载其中的技能、扩展与配置。首次安装会保存该项目信任决定。" : ack === "affects-shared-file" ? "我理解此次修改影响共享文件的所有访问入口。" : "无法判断本地改动，我确认更新可能覆盖技能文件。"}</label>)}</>}
      </>}{error && <Status error>{error}</Status>}
    </div><footer>{operation ? <><button onClick={onClose}>关闭视图</button>{operation.state === "needs-review" && <button disabled={busy} onClick={() => void reconcile()}>只读核验结果</button>}{operation.state === "succeeded" && <button className="sc-primary" onClick={() => onInstalled(operation)}>查看已安装</button>}</> : <><button onClick={onClose}>取消</button>{sent.current ? <button disabled={busy} onClick={() => void recoverSubmission()}>查询本次提交</button> : <><button onClick={() => setRetry(v => v + 1)}>重新预检</button><button className="sc-primary" disabled={busy || plan?.state !== "ready" || !plan?.requiredAcknowledgements.every(a => acks.includes(a))} onClick={() => void submit()}>{busy ? "正在提交…" : request?.kind === "update" ? "确认更新" : "确认安装"}</button></>}</>}</footer>
  </FocusSurface></div>;
}
