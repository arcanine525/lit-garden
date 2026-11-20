export function formatDraftMarkdown({ markdown, explanation }: { markdown: string; explanation: string }) {
  return explanation ? `---\nexplanation: ${JSON.stringify(explanation)}\n---\n\n${markdown}` : markdown;
}
