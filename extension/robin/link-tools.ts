/**
 * The link tools: save and list.
 *
 * Server-only (loaded by the extension). link_add fetches the page title and
 * favicon out-of-band, then writes the link store; link_list just reads it.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchPageMetadata, nameFromUrl } from "./fetch-title.ts";
import { storeIcon } from "./icons.ts";
import {
  newId,
  normalizeUrl,
  readLinks,
  writeLinks,
  type Link,
} from "./store.ts";
import { text } from "./toolkit.ts";

export function registerLinkTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "link_add",
    label: "Save link",
    description:
      "Save a URL to the user's link collection. Use this when they ask to bookmark, save, or remember a site or app, or when they paste a bare URL. Omit the title to have the page's own title looked up.",
    promptSnippet: "link_add — save a URL to the user's link collection",
    promptGuidelines: [
      "When the user pastes a bare URL with no instructions, save it with link_add and tell them what the page turned out to be.",
      "Never guess a link's title from its URL. Pass title only when the user stated the name themselves; otherwise omit it so link_add fetches the real page title.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "The URL. A bare host like example.com/x is fine." }),
      title: Type.Optional(
        Type.String({
          description:
            "Only when the user explicitly named it. Omit otherwise — the page's real <title> is fetched, which is more accurate than anything inferred from the URL.",
        }),
      ),
      group: Type.Optional(
        Type.String({ description: 'Section to file it under, e.g. "Apps" or "Reading"' }),
      ),
    }),
    async execute(_toolCallId, params) {
      let url: string;
      try {
        // Also rejects javascript:/data: — these end up in an href on the dashboard.
        url = normalizeUrl(params.url);
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error));
      }

      // Looking the title up is what turns a pasted URL into something the
      // user recognises in the panel; the hostname is only the fallback.
      const given = params.title?.trim();
      const { title: fetched, iconUrl } = await fetchPageMetadata(url);
      const title = given || fetched || nameFromUrl(url);

      const id = newId();
      const icon = iconUrl ? await storeIcon(id, iconUrl) : null;

      const links = readLinks();
      const link: Link = {
        id,
        title,
        url,
        ...(params.group?.trim() ? { group: params.group.trim() } : {}),
        ...(icon ? { icon } : {}),
        iconCheckedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      links.push(link);
      writeLinks(links);
      // Naming the source keeps the model from reporting a title it guessed as
      // though the page had confirmed it.
      const provenance = fetched
        ? " (title read from the page)"
        : given
          ? ""
          : " (the page gave no usable title — a login wall or error page —"
            + " so this name comes from the URL; the user can rename it by"
            + " double-clicking it on the dashboard)";
      return text(
        `Saved "${link.title}" → ${link.url}${link.group ? ` under ${link.group}` : ""}${provenance}`,
      );
    },
  });

  pi.registerTool({
    name: "link_list",
    label: "List links",
    description: "List the user's saved links and app shortcuts.",
    promptSnippet: "link_list — read the user's saved links",
    parameters: Type.Object({}),
    async execute() {
      const links = readLinks();
      if (links.length === 0) return text("No links saved.");
      return text(
        links.map((l) => `${l.id}  ${l.title} — ${l.url}${l.group ? ` [${l.group}]` : ""}`).join("\n"),
      );
    },
  });
}
