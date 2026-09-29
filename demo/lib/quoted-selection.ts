export function buildQuotedSelection(text: string, intro: string, question: string): string {
  const quote = text.trim().split("\n").map((line) => `> ${line}`).join("\n");
  return `${intro}\n\n${quote}\n\n${question}`;
}
