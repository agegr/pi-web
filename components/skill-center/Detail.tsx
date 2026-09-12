"use client";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import type { DetailRequest, Installation, Inventory, SourceSkill, Taxonomy, VersionIdentity } from "@/lib/skill-center/types";
import { centerRequest, errorMessage, loadLabels, scopeLabel } from "./client";
import { DomainTags, Status, Tabs } from "./Shared";

interface DetailData { previewPath: string; license: string | null; compatibility: string | null; evidence: {evidence:{sourceUrl:string;relativePath?:string;excerpt?:string;verifiedAt:string}}[]; skill: SourceSkill | null; installation: Installation | null; snapshotId: string; description: string | null; contentOrigin: string; skillRelativePath: string | null; version: VersionIdentity | null; metadataState: string }
interface FileContent { path: string; state: string; text: string | null; bytes: number | null; sourceUrl: string | null }
export function SkillDetail({ request, taxonomy, inventory, onBack, onInstall, onManage, onClassify }: { request: DetailRequest; taxonomy: Taxonomy | null; inventory: Inventory | null; onManage: (s: SourceSkill) => void; onBack: () => void; onInstall: (s: SourceSkill) => void; onClassify: (item: Installation) => void }) {
  const [data, setData] = useState<DetailData | null>(null); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<"overview" | "markdown" | "files">("overview"); const [raw, setRaw] = useState(false);
  const [files, setFiles] = useState<{files: {path:string;kind:string}[];complete:boolean} | null>(null); const [selected, setSelected] = useState("SKILL.md"); const [content, setContent] = useState<FileContent | null>(null); const [contentError, setContentError] = useState(""); const [copied, setCopied] = useState("");
  useEffect(() => {
    let alive = true; setData(null); setError("");
    void centerRequest<DetailData>("detail", request).then(d => { if (alive) { setData(d); setSelected(d.previewPath); } }).catch(e => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [request, retry]);
  useEffect(() => {
    if (!data) return; let alive = true; setFiles(null);
    void centerRequest<{files:{path:string;kind:string}[];complete:boolean}>(`snapshots/${data.snapshotId}/files`).then(f => { if (alive) setFiles(f); }).catch(e => { if (alive) setContentError(errorMessage(e)); });
    return () => { alive = false; };
  }, [data]);
  useEffect(() => {
    if (!data) return; let alive = true; setContent(null); setContentError("");
    void centerRequest<FileContent>(`snapshots/${data.snapshotId}/content`, { path: selected }).then(c => { if (alive) setContent(c); }).catch(e => { if (alive) setContentError(errorMessage(e)); });
    return () => { alive = false; };
  }, [data, selected, retry]);
  const currentInstallation = inventory?.installations.find(item => item.installationId === data?.installation?.installationId) ?? data?.installation;
  const currentClassification = currentInstallation?.classification ?? data?.skill?.classification;
  const installed = inventory?.installations.filter(item => data?.skill && item.canonicalSkillId === data.skill.canonicalSkillId) ?? [];
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setCopied("已复制"); } catch { setCopied("复制失败，请手动选择文本复制。"); } }
  return <div className="sc-detail"><button autoFocus onClick={onBack}>返回原列表</button>{error ? <Status error>{error}<button onClick={() => setRetry(v => v + 1)}>重新读取详情</button></Status> : !data ? <Status>正在读取技能详情…</Status> : <>
    <div className="sc-result-heading"><div><p className="sc-muted">{data.contentOrigin === "local" ? "本地内容" : "源站内容"}</p><h2>{data.installation?.name ?? data.skill?.name}</h2>{currentClassification && <DomainTags value={currentClassification} taxonomy={taxonomy} />}{currentInstallation && <button className="sc-classify-button" disabled={!taxonomy} onClick={() => onClassify(currentInstallation)}>设置分类</button>}</div>{data.skill && <div className="sc-actions">{!data.installation && installed.length > 0 && <><span>{[...new Set(installed.map(item => scopeLabel(item.scope)))].join(" / ")}已安装</span><button className="sc-primary" onClick={() => onManage(data.skill!)}>管理已安装</button></>}<button className={installed.length ? "" : "sc-primary"} onClick={() => onInstall(data.skill!)}>{data.installation || installed.length ? "安装到其他范围…" : "安装…"}</button></div>}</div>
    <Tabs value={tab} onChange={t => { setTab(t); if (t !== "files") setSelected(data.previewPath); }} label="技能详情内容" items={[{id:"overview",label:"概览"},{id:"markdown",label:"SKILL.md"},{id:"files",label:"文件"}]} />
    <div className="sc-detail-columns"><section role="tabpanel" id={`sc-panel-${tab}`} aria-labelledby={`sc-tab-${tab}`}>
      {tab === "overview" && <><h3>用途说明</h3><p>{data.description ?? "来源未提供用途说明"}</p><h3>使用方式</h3><p className="sc-muted">以下为技能原文；未单独提供的使用示例不作补写。</p></>}
      {tab === "files" && <nav className="sc-file-tree" aria-label="技能文件"><p>{files?.complete ? "技能目录文件" : "文件清单可能不完整"}</p>{files?.files.filter(f => f.kind === "file").map(f => <button key={f.path} aria-pressed={selected === f.path} onClick={() => setSelected(f.path)}>{f.path}</button>)}</nav>}
      <div className="sc-actions"><button onClick={() => setRaw(v => !v)}>{raw ? "渲染 Markdown" : "查看原文"}</button><button disabled={!content?.text} onClick={() => void copy(content!.text!)}>复制内容</button><span role="status">{copied}</span></div>
      {contentError ? <Status error>{contentError}<button onClick={() => setRetry(v => v + 1)}>重新读取</button></Status> : !content ? <Status>正在读取内容…</Status> : content.state !== "text" ? <Status>{content.state === "too-large" ? "文件超过预览限制" : content.state === "binary" ? "二进制文件不可预览" : "文件不可预览"}{content.sourceUrl && <a href={content.sourceUrl} target="_blank" rel="noreferrer">查看源文件</a>}</Status> : raw || !selected.toLowerCase().endsWith(".md") ? <pre className="sc-code">{content.text}</pre> : <div className="sc-markdown"><Markdown remarkPlugins={[remarkGfm, remarkFrontmatter]} skipHtml components={{ img: ({alt,src}) => <span>[图片：{alt || "未提供说明"}] {typeof src === "string" && /^https?:\/\//.test(src) && <a href={src} target="_blank" rel="noreferrer">打开图片来源</a>}</span>, a: ({href,children}) => href && /^https?:\/\//.test(href) ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span> }}>{content.text}</Markdown></div>}
    </section><aside><h3>来源信息</h3><dl><dt>目录</dt><dd>{data.skill?.provider ?? "未提供"}</dd><dt>来源</dt><dd>{data.skill?.sourceUrl ? <a href={data.skill.sourceUrl} target="_blank" rel="noreferrer">{data.skill.source}</a> : "未提供"}</dd><dt>技能路径</dt><dd><code>{data.installation?.logicalPath ?? data.skillRelativePath ?? "未提供"}</code></dd><dt>{data.version?.label ?? "读取版本"}</dt><dd>{data.version ? <button onClick={() => void copy(data.version!.value)}><code>{data.version.value}</code></button> : "未提供"}</dd><dt>许可证 / 兼容声明</dt><dd>{data.license ?? "许可证未提供"}<br />{data.compatibility ?? "兼容声明未提供"}</dd><dt>领域归属依据</dt><dd>{currentClassification?.origin === "personal" ? "本机个人分类，可通过设置分类修改。" : "本地维护的分类索引，不代表源站认证。"}{(currentClassification?.origin === "personal" ? [] : data.evidence).map((a,index)=><p key={index}><a href={a.evidence.sourceUrl} target="_blank" rel="noreferrer">{a.evidence.relativePath ?? "查看依据"}</a>{a.evidence.excerpt && <span>{a.evidence.excerpt}</span>}<small>核查于 {a.evidence.verifiedAt}</small></p>)}</dd></dl>
      {data.installation && <><h3>安装状态</h3><p>{scopeLabel(data.installation.scope)} · {loadLabels[data.installation.loadState]}</p><p>{data.installation.loadReason}</p><p>下次加载资源时按当前配置处理。</p>{data.installation.loadState === "effective" ? <button onClick={() => void copy(`/skill:${data.installation!.name}`)}>复制调用命令</button> : <p>当前实例未按名称加载，不能直接提供调用命令。</p>}<p className="sc-muted">向模型隐藏不禁止手动调用。</p>{data.installation.managementBindings.map(b => <details key={b.bindingId}><summary>{scopeLabel(b.scope)} 管理记录</summary><code>{b.package}</code><code>{b.version?.label} {b.version?.value ?? "版本未提供"}</code></details>)}</>}
    </aside></div>
  </>}</div>;
}
