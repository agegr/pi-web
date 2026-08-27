import { resolve } from 'node:path'
import { isAbsolute } from 'node:path'
import { SidebarError, requireString, optionalString } from './wire'
import { listDirectory, parentOf, rootLabel, requireAbsolute } from './fs-tree'
import { ensureWorkspacePath, ensureWorkspaceWritePath } from './path-security'
import { searchFiles } from './fs-search'
import { readTextOrBinary, writeTextFile } from './fs-read'
import * as git from './git'
import { depsStatus } from './pty-deps'
import { defaultShell, shellDisplayName } from './pty-manager'
import { getPtyManager } from './pty-singleton'
import { getSidebarSettings, updateSidebarSettings } from './settings'
import { extractFrameAncestors } from './browser-probe'
import { launchExternal } from './open-external'

export interface SessionScopePayload {
  sessionId?: string
  cwd?: string
  repoRoot?: string
  worktree?: string
  [key: string]: unknown
}

function resolveCwd(payload: SessionScopePayload): { sessionId: string; cwd: string } {
  const sessionId = payload.sessionId || 'default'
  let cwd = payload.cwd
  if (!cwd || typeof cwd !== 'string' || cwd.trim() === '') {
    cwd = process.cwd()
  }
  return { sessionId, cwd: resolve(cwd) }
}

async function resolveGitCwd(payload: SessionScopePayload): Promise<{ sessionId: string; cwd: string }> {
  const base = resolveCwd(payload)
  const requested = typeof payload.worktree === 'string' && payload.worktree !== '' ? payload.worktree : undefined
  const effectiveCwd = await git.resolveWorktree(base.cwd, requested)
  return { sessionId: base.sessionId, cwd: effectiveCwd }
}

function selectedRepo(payload: SessionScopePayload): string | undefined {
  return typeof payload.repoRoot === 'string' && payload.repoRoot !== '' ? payload.repoRoot : undefined
}

async function resolveGitFilePath(cwd: string, relativePath: string, repoRoot?: string): Promise<string> {
  const base = repoRoot ? await git.repoRoot(cwd, repoRoot).catch(() => cwd) : cwd
  return isAbsolute(relativePath) ? relativePath : resolve(base, relativePath)
}

export async function dispatchSidebarMethod(method: string, payload: unknown): Promise<unknown> {
  const record = (payload && typeof payload === 'object' ? payload : {}) as SessionScopePayload

  switch (method) {
    case 'session.cwd': {
      const { sessionId, cwd } = resolveCwd(record)
      return {
        sessionId,
        cwd,
        root: rootLabel(cwd),
        parent: parentOf(cwd) ?? null,
      }
    }

    case 'fs.tree': {
      const { cwd } = resolveCwd(record)
      const targetPath = typeof record.path === 'string' && record.path !== ''
        ? await ensureWorkspacePath(cwd, requireAbsolute(record.path))
        : cwd
      return listDirectory(targetPath)
    }

    case 'fs.search': {
      const { cwd } = resolveCwd(record)
      const query = requireString(record, 'query')
      return searchFiles(cwd, query)
    }

    case 'fs.read': {
      const { cwd } = resolveCwd(record)
      const rawPath = requireString(record, 'path')
      const repoRoot = selectedRepo(record)
      const targetPath = await resolveGitFilePath(cwd, rawPath, repoRoot)
      const safePath = await ensureWorkspacePath(cwd, targetPath)
      return readTextOrBinary(safePath)
    }

    case 'fs.write': {
      const { cwd } = resolveCwd(record)
      const rawPath = requireString(record, 'path')
      const content = requireString(record, 'content')
      const targetPath = await ensureWorkspaceWritePath(cwd, requireAbsolute(rawPath))
      await writeTextFile(targetPath, content)
      return { ok: true }
    }

    case 'git.worktrees': {
      const { cwd } = await resolveGitCwd(record)
      const repo = selectedRepo(record)
      const base = repo !== undefined ? await git.repoRoot(cwd, repo).catch(() => cwd) : cwd
      return git.worktrees(base)
    }

    case 'git.status': {
      const { cwd } = await resolveGitCwd(record)
      return git.status(cwd, selectedRepo(record))
    }

    case 'git.diff': {
      const { cwd } = await resolveGitCwd(record)
      const rawPath = optionalString(record, 'path')
      const repo = selectedRepo(record)
      const targetPath = rawPath ? await resolveGitFilePath(cwd, rawPath, repo) : undefined
      const staged = record.staged === true
      const diffText = await git.diff(cwd, targetPath, staged, repo)
      return { diff: diffText }
    }

    case 'git.stage': {
      const { cwd } = await resolveGitCwd(record)
      const rawPath = optionalString(record, 'path')
      await git.stage(cwd, rawPath, selectedRepo(record))
      return { ok: true }
    }

    case 'git.unstage': {
      const { cwd } = await resolveGitCwd(record)
      const rawPath = optionalString(record, 'path')
      await git.unstage(cwd, rawPath, selectedRepo(record))
      return { ok: true }
    }

    case 'git.commit': {
      const { cwd } = await resolveGitCwd(record)
      const message = requireString(record, 'message')
      await git.commit(cwd, message, selectedRepo(record))
      return { ok: true }
    }

    case 'git.branch': {
      const { cwd } = await resolveGitCwd(record)
      return git.branches(cwd, selectedRepo(record))
    }

    case 'git.checkout': {
      const { cwd } = await resolveGitCwd(record)
      const branch = requireString(record, 'branch')
      await git.checkout(cwd, branch, selectedRepo(record))
      return { ok: true }
    }

    case 'git.log': {
      const { cwd } = await resolveGitCwd(record)
      const count = typeof record.count === 'number' ? record.count : 30
      const skip = typeof record.skip === 'number' ? record.skip : 0
      return git.log(cwd, count, skip, selectedRepo(record))
    }

    case 'git.commit-diff': {
      const { cwd } = await resolveGitCwd(record)
      const hash = requireString(record, 'hash')
      const diffText = await git.commitDiff(cwd, hash, selectedRepo(record))
      return { diff: diffText }
    }

    case 'git.discard': {
      const { cwd } = await resolveGitCwd(record)
      const rawPath = requireString(record, 'path')
      await git.discard(cwd, rawPath, selectedRepo(record))
      return { ok: true }
    }

    case 'git.revert': {
      const { cwd } = await resolveGitCwd(record)
      const hash = requireString(record, 'hash')
      await git.revert(cwd, hash, selectedRepo(record))
      return { ok: true }
    }

    case 'git.cherry-pick': {
      const { cwd } = await resolveGitCwd(record)
      const hash = requireString(record, 'hash')
      await git.cherryPick(cwd, hash, selectedRepo(record))
      return { ok: true }
    }

    case 'pty.close': {
      const { sessionId } = resolveCwd(record)
      const tab = requireString(record, 'tab')
      const ptyManager = getPtyManager()
      ptyManager.scheduleClose(`${sessionId}:${tab}`, 0)
      return { ok: true }
    }

    case 'agent-pty.close': {
      return { ok: true }
    }

    case 'terminal.deps': {
      return depsStatus()
    }

    case 'shell.get': {
      const shell = defaultShell()
      return { shell, name: shellDisplayName(shell) }
    }

    case 'settings.get': {
      return getSidebarSettings()
    }

    case 'settings.update': {
      const patch = (record.patch && typeof record.patch === 'object' ? record.patch : {}) as Record<string, unknown>
      const expectedRevision = typeof record.expectedRevision === 'number' ? record.expectedRevision : undefined
      return updateSidebarSettings(patch, expectedRevision)
    }

    case 'browser.probe': {
      const url = requireString(record, 'url')
      try {
        const res = await fetch(url, { method: 'HEAD', redirect: 'follow' })
        const xfo = res.headers.get('x-frame-options')
        const csp = res.headers.get('content-security-policy')
        const frameAncestors = extractFrameAncestors(csp)
        return {
          status: res.status,
          xFrameOptions: xfo ?? undefined,
          frameAncestors,
        }
      } catch (err) {
        return {
          status: 0,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }

    case 'open.external': {
      const action = requireString(record, 'action') as 'reveal' | 'url'
      if (action === 'reveal') {
        const path = requireString(record, 'path')
        return launchExternal('reveal', path)
      } else if (action === 'url') {
        const url = requireString(record, 'url')
        return launchExternal('url', url)
      }
      throw new SidebarError('bad-request', 'unknown action')
    }

    case 'subagents.live': {
      return { live: {} }
    }

    case 'jobs.output': {
      return { text: '', truncated: false, read: true }
    }

    case 'jobs.kill': {
      return { ok: true, outcome: 'already-finished' }
    }

    case 'sidechat.start': {
      return { childId: `side-${Date.now()}` }
    }

    case 'sidechat.prompt':
    case 'sidechat.cancel':
    case 'sidechat.dispose': {
      return { accepted: true }
    }

    case 'sidechat.info': {
      return { status: 'idle', messages: [] }
    }

    default:
      throw new SidebarError('not-found', `unknown sidebar api method "${method}"`, 404)
  }
}
