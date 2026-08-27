/**
 * The 6 built-in file viewer descriptors: every preview surface is a
 * registered viewer (image / pdf / markdown / html / code /
 * binary-download), exactly like external plugins register theirs. Office
 * previews (.docx / .xlsx / .pptx) are NOT built in anymore — they moved to
 * the recommended office plugin (see plugins-viewers.ts), which registers
 * the same ids through this service.
 *
 * The `binary-download` viewer sniffs NUL bytes via `detect` for unknown
 * binaries and serves legacy doc/xls/ppt by extension; `code` is the
 * catch-all (`exts: []`, lowest priority) that claims any file no other
 * viewer did.
 *
 * The heavy viewers (the CodeMirror-backed markdown/html/code) render
 * through {@link lazyChunkComponent} wrappers — their libraries are fetched
 * only when such a file is first opened (see chunk-loader.ts). The
 * descriptor metadata (id/exts/priority/detect) is identical either way,
 * so matching semantics and external-plugin overrides are unaffected; the
 * `component` wrapper keeps the descriptor contract `(props) => ReactNode`.
 *
 * Every viewer carries the declarative settings-surface fields — `title`
 * and `icon` — so the Side card settings page can render the enable/disable
 * inventory without hardcoding (eating our own dogfood).
 */
import { IconCodeOutline16, IconDownloadOutline16 } from "../ui-primitives"
import { lazyChunkComponent } from '../lazy-chunk'
import { PdfView } from '../PdfView'
import { BinaryDownload } from '../binary-download'
import {
  IconImageOutline16,
  IconMarkdownOutline16,
  IconPdfOutline16,
  IconHtmlOutline16,
} from '../icons'
import type { ComponentType } from 'react'
import type { FileViewerDescriptor, FileViewerProps } from '../service'
import { t } from '../locales'
import css from '../sidebar.module.css'

/**
 * Lazy wrapper over the chunk-resident viewer component. The `pick`
 * function is module-level (stable identity — the wrapper effect depends
 * on it); the cast bridges the chunk exports record to the descriptor prop
 * shape (the view reads only its own subset of FileViewerProps).
 */
const LazyTextEditor = lazyChunkComponent<FileViewerProps>('editor', (mod) => mod.TextEditor as ComponentType<FileViewerProps> | undefined)

/** The 6 built-in file viewer descriptors. */
export function builtinViewers(): readonly FileViewerDescriptor[] {
  return [
    {
      id: 'image',
      title: () => t('viewerImage'),
      icon: (size: number) => <IconImageOutline16 size={size} />,
      exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'],
      fetchStrategy: 'mediaUrl',
      component: ({ mediaUrl: url, title }) => (
        <div className={css.editorImageWrap}>
          <img className={css.editorImage} src={url} alt={title} />
        </div>
      ),
    },
    {
      id: 'pdf',
      title: () => t('viewerPdf'),
      icon: (size: number) => <IconPdfOutline16 size={size} />,
      exts: ['pdf'],
      fetchStrategy: 'mediaUrl',
      component: ({ scope, path, title }) => (
        <PdfView scope={scope} path={path} title={title} />
      ),
    },
    {
      id: 'markdown',
      title: () => t('viewerMarkdown'),
      icon: (size: number) => <IconMarkdownOutline16 size={size} />,
      exts: ['md', 'markdown'],
      fetchStrategy: 'fsRead',
      component: (props) => <LazyTextEditor {...props} />,
    },
    {
      id: 'html',
      title: () => t('viewerHtml'),
      icon: (size: number) => <IconHtmlOutline16 size={size} />,
      exts: ['html', 'htm'],
      fetchStrategy: 'fsRead',
      // Declarative settings: the sandbox escape hatch and the default-unsafe
      // start state render under this viewer's row in the Side card settings
      // page (both warned on).
      settings: {
        toggles: [{
          key: 'htmlViewerNoSandbox',
          title: () => t('settingsHtmlSandboxTitle'),
          desc: () => t('settingsHtmlSandboxDesc'),
        }, {
          key: 'htmlViewerDefaultUnsafe',
          title: () => t('settingsHtmlDefaultUnsafeTitle'),
          desc: () => t('settingsHtmlDefaultUnsafeDesc'),
        }],
      },
      component: (props) => <LazyTextEditor {...props} />,
    },
    {
      id: 'code',
      title: () => t('viewerCode'),
      icon: (size: number) => <IconCodeOutline16 size={size} />,
      exts: [],
      priority: -100,
      fetchStrategy: 'fsRead',
      component: (props) => <LazyTextEditor {...props} />,
    },
    {
      id: 'binary-download',
      title: () => t('viewerBinary'),
      icon: (size: number) => <IconDownloadOutline16 size={size} />,
      exts: ['doc', 'xls', 'ppt'],
      priority: -50,
      fetchStrategy: 'binary-download',
      // NUL probe: a file whose head bytes contain a NUL is binary — claimed
      // before the catch-all code viewer on the head re-match.
      detect: (_path, head) => head.includes(0),
      component: ({ scope, path }) => <BinaryDownload scope={scope} path={path} />,
    },
  ]
}
