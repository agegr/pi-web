import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { chromium } from "playwright";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { AssistantMessageHeader } = await jiti.import("../components/MessageView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

export async function checkStreamingMetrics(page) {
  const states = [
    {},
    { estimatedTokens: 1 },
    ...[9, 10, 99, 100, 111, 888, 999, 1000, 9999, 10000, 99999, 100000, 999999].map((estimatedTokens, i) => ({
      estimatedTokens,
      tps: [1.1, 9.9, 10, 99.9, 100, 111.1, 888.8, 999.9][i % 8],
    })),
    { estimatedTokens: 999999 },
    {},
  ];
  const markup = states.map(props => renderToStaticMarkup(React.createElement(
    I18nProvider, null,
    React.createElement(AssistantMessageHeader, { modelName: "Test Model", ...props }),
  )));
  // Render the production header in the loaded page's CSS, without a live model
  // or timing-dependent stream. Each replacement represents one stream update.
  const measurements = await page.evaluate((markup) => {
    const fixture = document.createElement("div");
    fixture.style.cssText = "position:fixed;top:0;left:0;width:calc(100% - 32px);visibility:hidden;font-size:14px;line-height:1.5";
    document.body.append(fixture);
    try {
      return ["sans-serif", "serif", "monospace"].map(font => {
        fixture.style.fontFamily = font;
        const samples = markup.map(html => {
          fixture.innerHTML = html + "<div>Output pane</div>";
          const header = fixture.firstElementChild;
          const tokens = header.children[1]?.firstElementChild;
          const rate = header.children[1]?.children[1];
          return {
            height: header.getBoundingClientRect().height,
            contentTop: header.nextElementSibling.getBoundingClientRect().top,
            tokenTop: tokens?.getBoundingClientRect().top,
            rateLeft: rate?.getBoundingClientRect().left,
            rateWidth: rate?.getBoundingClientRect().width,
            overflows: header.scrollWidth > fixture.clientWidth,
          };
        });
        return { font, samples };
      });
    } finally {
      fixture.remove();
    }
  }, markup);
  for (const { font, samples } of measurements) {
    const distinct = key => [...new Set(samples.map(s => s[key]).filter(v => v !== undefined))];
    assert.deepEqual({
      heights: distinct("height").length,
      contentTops: distinct("contentTop").length,
      tokenTops: distinct("tokenTop").length,
      rateLefts: distinct("rateLeft").length,
      rateWidths: distinct("rateWidth").length,
      overflows: samples.some(s => s.overflows),
    }, { heights: 1, contentTops: 1, tokenTops: 1, rateLefts: 1, rateWidths: 1, overflows: false },
    `${font}: streaming header moves: ${JSON.stringify(samples)}`);
  }
  console.log("PASS: streaming metrics keep their height and numeric columns across updates");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch();
  try {
    for (const width of [1280, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.setContent('<body style="font-size:14px;line-height:1.5"></body>');
      await checkStreamingMetrics(page);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
