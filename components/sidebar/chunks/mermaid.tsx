/**
 * Lazy chunk entry: the mermaid diagram renderer for the markdown preview
 * (mermaid + its d3/dagre/cytoscape graph deps). Built as
 * lib/client-mermaid.js and registered under the `mermaid` global chunk
 * slot — fetched only when a previewed markdown file contains a mermaid
 * fence (see chunk-loader.ts and the mermaid markdown preview design doc).
 * Never import this module from the core bundle: it pulls mermaid into the
 * startup path.
 */
export { MermaidMarkdown } from '../mermaid'
