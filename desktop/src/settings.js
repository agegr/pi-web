'use strict'

/**
 * Minimal settings store for the pi-web desktop shell.
 *
 * Persists `{ serverUrl }` as JSON under `app.getPath('userData')`.
 * No third-party dependency: create-on-first-write, atomic writes
 * (tmp file + rename), tolerant read on corrupt/missing files.
 */

const { app } = require('electron')
const fs = require('fs')
const path = require('path')

function settingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

/**
 * Normalize and validate a pi-web server URL.
 * Must be an absolute http(s):// URL with a hostname.
 * Returns the normalized URL string, or null when invalid.
 */
function normalizeServerUrl(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  let url
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (!url.hostname) return null
  // Drop any fragment; keep scheme, host, port and path.
  url.hash = ''
  return url.toString()
}

/**
 * Read settings. Missing or corrupt file yields `{ serverUrl: null }`
 * rather than throwing, so first run and manual corruption are both
 * ordinary states.
 */
function loadSettings() {
  const file = settingsFilePath()
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return { serverUrl: null }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { serverUrl: null }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { serverUrl: null }
  }
  const serverUrl =
    parsed.serverUrl && typeof parsed.serverUrl === 'string'
      ? parsed.serverUrl
      : null
  return { serverUrl }
}

/**
 * Atomically write settings. The write goes to a temp file in the same
 * directory which is then renamed over the target, so a crash mid-write
 * never leaves a half-written settings file.
 */
function saveSettings(settings) {
  const file = settingsFilePath()
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const payload = JSON.stringify(
    { serverUrl: settings && settings.serverUrl ? settings.serverUrl : null },
    null,
    2
  )
  const tmp = path.join(dir, `.settings.json.${process.pid}.tmp`)
  fs.writeFileSync(tmp, payload, 'utf8')
  fs.renameSync(tmp, file)
}

module.exports = {
  settingsFilePath,
  normalizeServerUrl,
  loadSettings,
  saveSettings
}
