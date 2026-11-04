import { getLocalePlugin } from "./i18n/registry";

/** Add presentation only; pi's renderer and embedded session data stay intact. */
export function labelSessionExport(html: string, locale: string | null): string {
  const messages = (getLocalePlugin(locale ?? "en") ?? getLocalePlugin("en")!).messages;
  const labels = JSON.stringify({
    user: messages["export.roleUser"],
    assistant: messages["export.roleAssistant"],
    tool: messages["export.roleTool"],
  }).replace(/</g, "\\u003c");

  // Observe only the SDK's transcript container: branch navigation replaces its
  // children, sometimes reusing cached nodes. Do not inspect or rewrite content.
  const addition = `<style>
    #messages > .assistant-message,
    #messages > .skill-user-entry {
      border: 1px solid var(--dim);
      border-radius: 4px;
      padding-bottom: var(--line-height);
    }
    .pi-web-export-role {
      display: block;
      font-weight: bold;
      margin-bottom: 8px;
    }
    #messages > .assistant-message > .pi-web-export-role,
    #messages > .skill-user-entry > .pi-web-export-role {
      margin: var(--line-height);
    }
  </style>
  <script>
    (() => {
      const messages = document.getElementById('messages');
      if (!messages) return;
      const labels = ${labels};
      function label(element, role) {
        if (element.querySelector(':scope > .pi-web-export-role')) return;
        const heading = document.createElement('div');
        heading.className = 'pi-web-export-role';
        heading.textContent = labels[role];
        element.prepend(heading);
      }
      function update() {
        for (const entry of messages.children) {
          if (entry.matches('.user-message, .skill-user-entry')) label(entry, 'user');
          if (entry.matches('.assistant-message')) {
            label(entry, 'assistant');
            for (const tool of entry.querySelectorAll(':scope > .tool-execution')) label(tool, 'tool');
          }
          if (entry.matches('.tool-execution')) label(entry, 'tool');
        }
      }
      update();
      new MutationObserver(update).observe(messages, { childList: true });
    })();
  </script>`;
  // Only insert at the document ending, never at a literal inside a script.
  const bodyEnd = html.lastIndexOf("</body>");
  if (bodyEnd === -1 || !/^\s*<\/html>\s*$/.test(html.slice(bodyEnd + "</body>".length))) return html;
  return html.slice(0, bodyEnd) + addition + html.slice(bodyEnd);
}
