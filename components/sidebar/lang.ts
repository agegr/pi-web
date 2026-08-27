/**
 * Syntax highlighting for the file editor: extension → CodeMirror language
 * mapping. The key derivation is pure and unit-tested; the factories pull in
 * the CodeMirror language packages (bundled into the client).
 */
import { Language, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { javascript, jsxLanguage, typescriptLanguage, tsxLanguage } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css, cssLanguage } from '@codemirror/lang-css'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { sql } from '@codemirror/lang-sql'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { rust } from '@codemirror/lang-rust'
import { go } from '@codemirror/lang-go'
import { php } from '@codemirror/lang-php'
import { vue } from '@codemirror/lang-vue'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { nginx } from '@codemirror/legacy-modes/mode/nginx'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { csharp, kotlin, dart, scala, objectiveCpp } from '@codemirror/legacy-modes/mode/clike'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { sCSS, less } from '@codemirror/legacy-modes/mode/css'
import { sass } from '@codemirror/legacy-modes/mode/sass'
import { stylus } from '@codemirror/legacy-modes/mode/stylus'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { perl } from '@codemirror/legacy-modes/mode/perl'
import { r } from '@codemirror/legacy-modes/mode/r'
import { groovy } from '@codemirror/legacy-modes/mode/groovy'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { diff } from '@codemirror/legacy-modes/mode/diff'
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf'
import { cmake } from '@codemirror/legacy-modes/mode/cmake'
import { pug } from '@codemirror/legacy-modes/mode/pug'
import { tcl } from '@codemirror/legacy-modes/mode/tcl'
import { haskell } from '@codemirror/legacy-modes/mode/haskell'
import { clojure } from '@codemirror/legacy-modes/mode/clojure'
import { erlang } from '@codemirror/legacy-modes/mode/erlang'
import { julia } from '@codemirror/legacy-modes/mode/julia'
import { pascal } from '@codemirror/legacy-modes/mode/pascal'
import { vb } from '@codemirror/legacy-modes/mode/vb'
import { vhdl } from '@codemirror/legacy-modes/mode/vhdl'
import { stex } from '@codemirror/legacy-modes/mode/stex'

/** The lowercased file extension of a path ('' when none). */
export function extOf(path: string): string {
  const at = path.lastIndexOf('.')
  if (at === -1) return ''
  const base = path.slice(at + 1).toLowerCase()
  return base.includes('/') || base.includes('\\') ? '' : base
}

/** Language key for an extension, or null for plain text. Pure (tested). */
export function languageKeyForExt(ext: string): string | null {
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': return 'js'
    case 'jsx': return 'jsx'
    case 'ts': case 'mts': case 'cts': return 'ts'
    case 'tsx': return 'tsx'
    case 'json': case 'jsonc': return 'json'
    case 'md': case 'markdown': return 'md'
    case 'py': case 'pyw': return 'python'
    case 'html': case 'htm': return 'html'
    case 'css': return 'css'
    case 'xml': case 'xsl': return 'xml'
    case 'yaml': case 'yml': return 'yaml'
    case 'sql': return 'sql'
    case 'java': return 'java'
    case 'cs': return 'csharp'
    case 'kt': case 'kts': return 'kotlin'
    case 'swift': return 'swift'
    case 'c': case 'h': return 'c'
    case 'cc': case 'cpp': case 'cxx': case 'hpp': case 'hh': case 'hxx': return 'cpp'
    case 'rs': return 'rust'
    case 'go': return 'go'
    case 'php': return 'php'
    case 'sh': case 'bash': case 'zsh': return 'shell'
    case 'toml': return 'toml'
    case 'nginx': case 'conf': return 'nginx'
    case 'dockerfile': case 'docker': return 'dockerfile'
    case 'properties': case 'env': return 'properties'
    case 'vue': return 'vue'
    case 'scss': return 'scss'
    case 'sass': return 'sass'
    case 'less': return 'less'
    case 'styl': return 'stylus'
    case 'rb': return 'ruby'
    case 'lua': return 'lua'
    case 'pl': case 'pm': return 'perl'
    case 'r': return 'r'
    case 'dart': return 'dart'
    case 'scala': case 'sc': return 'scala'
    case 'groovy': return 'groovy'
    case 'ps1': case 'psm1': return 'powershell'
    case 'diff': case 'patch': return 'diff'
    case 'proto': return 'protobuf'
    case 'cmake': return 'cmake'
    case 'pug': return 'pug'
    case 'tcl': return 'tcl'
    case 'hs': return 'haskell'
    case 'clj': case 'cljs': return 'clojure'
    case 'erl': return 'erlang'
    case 'jl': return 'julia'
    case 'pas': return 'pascal'
    case 'vb': return 'vb'
    case 'vhd': return 'vhdl'
    case 'tex': return 'stex'
    case 'mm': return 'objectivecpp'
    // '.v' (Verilog/Coq/V) 与 '.m' (Objective-C/MATLAB) 存在跨语言歧义，
    // 故意不映射——错配高亮比纯文本更误导。
    default: return null
  }
}

/** Per-lang `<style>` parsers for the Vue SFC factory (built once, shared). */
const VUE_STYLE_PARSERS = {
  scss: StreamLanguage.define(sCSS).parser,
  sass: StreamLanguage.define(sass).parser,
  less: StreamLanguage.define(less).parser,
  stylus: StreamLanguage.define(stylus).parser,
}

const FACTORIES: Record<string, () => Language | LanguageSupport> = {
  js: () => javascript({ jsx: true }),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  json: () => json(),
  md: () => markdown(),
  python: () => python(),
  html: () => html(),
  css: () => css(),
  xml: () => xml(),
  yaml: () => yaml(),
  sql: () => sql(),
  java: () => java(),
  csharp: () => StreamLanguage.define(csharp),
  kotlin: () => StreamLanguage.define(kotlin),
  swift: () => StreamLanguage.define(swift),
  c: () => cpp(),
  cpp: () => cpp(),
  rust: () => rust(),
  go: () => go(),
  php: () => php(),
  shell: () => StreamLanguage.define(shell),
  toml: () => StreamLanguage.define(toml),
  nginx: () => StreamLanguage.define(nginx),
  dockerfile: () => StreamLanguage.define(dockerFile),
  properties: () => StreamLanguage.define(properties),
  // Vue SFC: lang-html's default html() base ALREADY parses <script>
  // (no type → JS, type="module" → JS, lang="ts" → TS, JSON/importmap MIME
  // types) and <style> → CSS through its built-in defaultNesting. The
  // explicit entries only ADD what the defaults miss — case-insensitive
  // lang="ts", lang="tsx"/"jsx" (the defaults only recognize the text/jsx &
  // text/typescript-jsx MIME types), and per-lang <style> preprocessor
  // dispatch. Same-tag entries are first-match wins and ours precede the
  // defaults, so the predicates stay narrow: a constant-true entry would
  // shadow the default JSON/importmap script handling and force the CSS
  // parser onto <style lang="stylus">.
  vue: () => vue({
    base: html({
      nestedLanguages: [
        { tag: 'script', attrs: a => (a.lang ?? '').toLowerCase() === 'ts', parser: typescriptLanguage.parser },
        { tag: 'script', attrs: a => (a.lang ?? '').toLowerCase() === 'tsx', parser: tsxLanguage.parser },
        { tag: 'script', attrs: a => (a.lang ?? '').toLowerCase() === 'jsx', parser: jsxLanguage.parser },
        { tag: 'style', attrs: a => (a.lang ?? '').toLowerCase() === 'css', parser: cssLanguage.parser },
        { tag: 'style', attrs: a => (a.lang ?? '').toLowerCase() === 'scss', parser: VUE_STYLE_PARSERS.scss },
        { tag: 'style', attrs: a => (a.lang ?? '').toLowerCase() === 'sass', parser: VUE_STYLE_PARSERS.sass },
        { tag: 'style', attrs: a => (a.lang ?? '').toLowerCase() === 'less', parser: VUE_STYLE_PARSERS.less },
        { tag: 'style', attrs: a => (a.lang ?? '').toLowerCase() === 'stylus', parser: VUE_STYLE_PARSERS.stylus },
      ],
    }),
  }),
  scss: () => StreamLanguage.define(sCSS),
  sass: () => StreamLanguage.define(sass),
  less: () => StreamLanguage.define(less),
  stylus: () => StreamLanguage.define(stylus),
  ruby: () => StreamLanguage.define(ruby),
  lua: () => StreamLanguage.define(lua),
  perl: () => StreamLanguage.define(perl),
  r: () => StreamLanguage.define(r),
  dart: () => StreamLanguage.define(dart),
  scala: () => StreamLanguage.define(scala),
  groovy: () => StreamLanguage.define(groovy),
  powershell: () => StreamLanguage.define(powerShell),
  diff: () => StreamLanguage.define(diff),
  protobuf: () => StreamLanguage.define(protobuf),
  cmake: () => StreamLanguage.define(cmake),
  pug: () => StreamLanguage.define(pug),
  tcl: () => StreamLanguage.define(tcl),
  haskell: () => StreamLanguage.define(haskell),
  clojure: () => StreamLanguage.define(clojure),
  erlang: () => StreamLanguage.define(erlang),
  julia: () => StreamLanguage.define(julia),
  pascal: () => StreamLanguage.define(pascal),
  vb: () => StreamLanguage.define(vb),
  vhdl: () => StreamLanguage.define(vhdl),
  stex: () => StreamLanguage.define(stex),
  objectivecpp: () => StreamLanguage.define(objectiveCpp),
}

/** Every language key the extension table can produce (test seam). */
export function supportedLanguageKeys(): readonly string[] {
  return Object.keys(FACTORIES)
}

/** The CodeMirror language support for a path, or null for plain text. */
export function languageForPath(path: string): Language | LanguageSupport | null {
  const key = languageKeyForExt(extOf(path))
  if (key === null) return null
  try {
    return FACTORIES[key]!()
  } catch (error) {
    // A broken factory degrades to plain text, never crashes the editor.
    console.warn(`[dsh-better-sidebar] language factory "${key}" failed:`, error)
    return null
  }
}
