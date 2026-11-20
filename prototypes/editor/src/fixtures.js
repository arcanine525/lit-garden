export const cases = [
  { id: 'vietnamese-unicode', markdown: 'Vườn Văn — tiếng Việt: ắ ộ ự Đ. 👩🏽‍🏫 🌱 e\u0301; NFD: a\u0306\u0301.' },
  { id: 'headings', markdown: '# Tiêu đề\n\n## Mầm xanh\n\n### Hoa\n\n#### Quả\n\n##### Năm\n\n###### Sáu' },
  { id: 'bold-italic', markdown: 'Một **ý đậm**, *ý nghiêng*, ***cả hai*** và **đậm có *nghiêng* bên trong**.' },
  { id: 'lists', markdown: '- Mầm\n- Hoa\n  - Cánh nhỏ\n\n3. Ba\n4. Bốn' },
  { id: 'quotes', markdown: '> Một đoạn **trích dẫn**.\n>\n> Đoạn hai.\n>\n> > Trích lồng nhau.' },
  { id: 'table', markdown: '| Ý | Điểm |\n| :--- | ---: |\n| Tiếng Việt | **2** |\n| Ký tự \\| | 1 |' },
  { id: 'links', markdown: '[Vườn Văn](https://example.org/a?q=Vi%E1%BB%87t "Tham khảo") và [tham chiếu][doc].\n\n[doc]: https://example.org/b "Tài liệu"' },
  { id: 'line-breaks', markdown: 'Dòng mềm\nvẫn một đoạn.  \nDòng ngắt cứng.\\\nDòng cứng thứ hai.\n\nĐoạn mới.' },
  { id: 'repeated', markdown: 'Hoa nở. **Hoa nở.**\n\nHoa nở. Mùa xuân 👩🏽‍🏫 lại đến.\n\nHoa nở.' },
  { id: 'normalization', markdown: 'Tiêu đề\n=======\n\n* Một\n* Hai\n\n__Đậm__ và _nghiêng_.\n' }
];
export const sample = '# Mùa xuân trong vườn\n\nHoa nở. **Hoa nở.**\n\nTiếng Việt 👩🏽‍🏫 — a\u0306\u0301 và 🌱.\n\n> Mỗi trang viết là một hạt mầm.\n\n| Ý | Điểm |\n| --- | --- |\n| Hình ảnh | 2 |';
