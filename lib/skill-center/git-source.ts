import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { runManagedProcess } from "../npx";
import { getSkillCenterConfig } from "./config";
import { requireValue } from "./errors";

const exec = promisify(execFile);
export interface SourceEntry { path: string; type: string; mode: string; sha: string; size?: number }
export interface RepositoryReader { sha: string; tree: SourceEntry[]; readBlob: (sha: string) => Promise<Buffer> }

/** Read Git objects without checkout, hooks, or execution of repository files. */
export async function withGitSource<T>(source: string, revision: string | null, read: (repo: RepositoryReader) => Promise<T>, fetchProcess = runManagedProcess): Promise<T> {
  requireValue(/^[\w.-]+\/[\w.-]+$/.test(source) && (!revision || /^[a-f0-9]{40}$/.test(revision)), "INVALID_PACKAGE", "无效 Git 来源或提交。");
  const config = getSkillCenterConfig();
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, "pi-skill-source-"));
  const deadline = Date.now() + config.cliTimeoutMs;
  let cleanup = true;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
  const timeout = () => { requireValue(Date.now() < deadline, "SOURCE_UNAVAILABLE", "Git 源内容读取超时，请重试。", 504); return Math.max(1, deadline - Date.now()); };
  const git = async (args: string[], maxBuffer = config.maxTextBytes) => (await exec("git", ["--git-dir", directory, ...args], { env, timeout: timeout(), windowsHide: true, encoding: "buffer", maxBuffer })).stdout;
  try {
    await exec("git", ["init", "--bare", directory], { env, timeout: timeout(), windowsHide: true });
    // A full shallow fetch avoids one HTTP request per SKILL.md and needs no GitHub API quota.
    try {
      await fetchProcess("git", ["--git-dir", directory, "fetch", "--depth=1", "--no-tags", `https://github.com/${source}.git`, revision ?? "HEAD"], { env, timeout: Math.max(1, Math.floor(timeout() / 2)) });
    } catch (error) {
      const processError = error as { killed?: boolean; treeTerminated?: boolean };
      cleanup = !processError.killed || Boolean(processError.treeTerminated);
      if (!cleanup) console.error("Skill source Git process termination unconfirmed; retained temporary repository:", directory);
      throw error;
    }
    const sha = (await git(["rev-parse", "FETCH_HEAD^{commit}"])).toString("utf8").trim();
    requireValue(/^[a-f0-9]{40}$/.test(sha) && (!revision || sha === revision), "SOURCE_UNAVAILABLE", "源提交核验失败。", 502);
    const raw = (await git(["ls-tree", "-r", "-t", "-l", "-z", sha], config.maxTextBytes * 32)).toString("utf8");
    const tree = raw.split("\0").filter(Boolean).map(record => {
      const match = /^(\d+) (\w+) ([a-f0-9]{40}) +([\d-]+)\t([\s\S]+)$/.exec(record);
      requireValue(match, "SOURCE_UNAVAILABLE", "源目录清单无效。", 502);
      return { mode: match[1], type: match[2], sha: match[3], size: match[4] === "-" ? undefined : Number(match[4]), path: match[5] };
    });
    return await read({ sha, tree, readBlob: async id => {
      requireValue(/^[a-f0-9]{40}$/.test(id) && tree.some(f => f.sha === id && f.type === "blob" && f.mode !== "120000" && (f.size ?? Infinity) <= config.maxTextBytes), "FILE_NOT_FOUND", "文件不在可读取的源快照内。", 404);
      return git(["cat-file", "blob", id]);
    } });
  } finally {
    // Only remove the exact temporary repository created by this call.
    const child = relative(parent, resolve(directory));
    if (cleanup && child && !child.startsWith("..") && !child.includes("/") && !child.includes("\\") && child.startsWith("pi-skill-source-")) await rm(directory, { recursive: true, force: true });
  }
}
