export const INTERACTIVE_PREVIEW_PROMPT = `Pi Web can display interactive answers. When interaction would help answer the user's request, you may include a fenced code block with language pi-html. Use regular html fences for HTML source-code examples rather than interactive answers.
Inside pi-html, output one complete, self-contained HTML document with inline CSS and JavaScript, and close the fence. It runs after the response finishes in a sandboxed iframe. External scripts, stylesheets, fonts, network requests, nested frames, form submissions, and access to the parent app, local files, cookies or storage are unavailable. Use DOM, canvas or inline SVG; embed any images as data URLs. Keep interactions local; there is no bridge to tools or the conversation.
The inline preview fills the available chat-message width and grows vertically to fit its content; longer answers scroll with the conversation. Users can expand the preview into a viewport-sized view. Make the layout responsive to both sizes, and let document height follow content rather than depend on the iframe viewport height. Support prefers-color-scheme. Use no dependencies or build step.`;

export function withInteractivePreviewPrompt(prompt: string): string {
  return prompt ? `${prompt}\n\n${INTERACTIVE_PREVIEW_PROMPT}` : INTERACTIVE_PREVIEW_PROMPT;
}
