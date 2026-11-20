export type WritingSuggestion = { start: number; end: number; quote: string; body: string };

export function reviewSuggestions(text: string) {
  const rules = [
    [/(?<![\p{L}\p{M}])chình[ \t]+tả(?![\p{L}\p{M}])/giu,'Kiểm tra cách viết “chính tả”.'],
    [/(?<![\p{L}\p{M}])(?:xử dụng|suy nghỉ|giành giụm|bỗ xung)(?![\p{L}\p{M}])/giu,'Kiểm tra chính tả.'],
    [/(?<![\p{L}\p{M}])([\p{L}\p{M}]+) +\1(?![\p{L}\p{M}])/giu,'Từ lặp liền nhau. Có thể là phép điệp có chủ ý.'],
    [/ +(?=[,;:!?])/gu,'Có khoảng trắng trước dấu câu.'],
    [/(?<=\S) {2,}(?=\S)/gu,'Có nhiều khoảng trắng giữa hai từ.']
  ] as const;
  const fixes: Record<string,string> = { 'xử dụng':'sử dụng','suy nghỉ':'suy nghĩ','giành giụm':'dành dụm','bỗ xung':'bổ sung' };
  const findings: WritingSuggestion[] = [];
  for (const [pattern,message] of rules) {
    for (const match of text.matchAll(pattern)) {
      const quote = match[0];
      const fix = fixes[quote.toLocaleLowerCase('vi')];
      findings.push({ start:match.index,end:match.index+quote.length,quote,body:fix ? `Kiểm tra cách viết “${fix}”.` : message });
      if (findings.length === 100) break;
    }
    if (findings.length === 100) break;
  }
  return findings.sort((a,b) => a.start-b.start);
}
