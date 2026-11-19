const ExportFiles = (() => {
  const encoder = new TextEncoder();
  const xml = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
  function download(name, bytes, type) {
    const url = URL.createObjectURL(new Blob([bytes], {type}));
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function grades(records) {
    const criteria = [...new Set(records.flatMap(x => x.rubric.criteria.map(c => c.name)))];
    const rows = [['Mã bài nộp','Lớp','Học sinh','Tên đăng nhập','Đề bài','Rubric','Lần nộp','Ngày nộp','Trạng thái','Thang điểm','Điểm đã trả',...criteria,'Nhận xét chung']];
    for (const x of records) {
      const s = x.submission, released = s.status === 'returned';
      const scores = x.rubric.criteria.map((c,i) => [c.name, s.scores?.[i] ?? '']);
      const total = released ? Math.round(scores.reduce((n,c) => n + Number(c[1]), 0) / x.rubric.max * x.scale * 100) / 100 : '';
      rows.push([s.id,x.className,x.student,x.username,x.title,x.rubric.name,x.version,s.createdAt || s.created_at,released?'Đã trả bài':'Chờ chấm',x.scale,total,...criteria.map(name=>released?(scores.find(c=>c[0]===name)?.[1]??''):''),released?s.overall:'']);
    }
    return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  // Uncompressed ZIP keeps document export self-contained and works offline.
  function zip(files) {
    const parts=[], central=[]; let offset=0, centralSize=0;
    for (const [path, value] of Object.entries(files)) {
      const name=encoder.encode(path), data=encoder.encode(value);
      let crc=0xffffffff;
      for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
      crc=(crc^0xffffffff)>>>0;
      const header=new Uint8Array(30), h=new DataView(header.buffer);
      h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);
      parts.push(header,name,data);
      const entry=new Uint8Array(46), e=new DataView(entry.buffer);
      e.setUint32(0,0x02014b50,true);e.setUint16(4,20,true);e.setUint16(6,20,true);e.setUint32(16,crc,true);e.setUint32(20,data.length,true);e.setUint32(24,data.length,true);e.setUint16(28,name.length,true);e.setUint32(42,offset,true);
      central.push(entry,name);centralSize+=entry.length+name.length;offset+=header.length+name.length+data.length;
    }
    const end=new Uint8Array(22), e=new DataView(end.buffer);
    e.setUint32(0,0x06054b50,true);e.setUint16(8,central.length/2,true);e.setUint16(10,central.length/2,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
    const out=new Uint8Array(offset+centralSize+22);let position=0;
    for(const part of [...parts,...central,end]){out.set(part,position);position+=part.length;}
    return out;
  }
  function run(text, properties='') {
    return '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="26"/>'+properties+'</w:rPr>'+String(text).split('\n').map((line,i)=>(i?'<w:br/>':'')+'<w:t xml:space="preserve">'+xml(line)+'</w:t>').join('')+'</w:r>';
  }
  const paragraph = (text,bold=false) => '<w:p>'+run(text,bold?'<w:b/>':'')+'</w:p>';
  function review(x) {
    const s=x.submission, text=s.text || '', notes=s.comments || [], formats=s.formats || [];
    const valid = f => Number.isInteger(f.start)&&Number.isInteger(f.end)&&f.start>=0&&f.end>f.start&&f.end<=text.length;
    const ranges=notes.map(n=>{
      if(valid(n)&&text.slice(n.start,n.end)===n.quote)return n;
      const start=text.indexOf(n.quote);
      return n.quote&&start>=0?{...n,start,end:start+n.quote.length}:null;
    }).filter(Boolean);
    const styles=formats.filter(valid);
    const stops=[...new Set([0,text.length,...ranges.flatMap(n=>[n.start,n.end]),...styles.flatMap(n=>[n.start,n.end])])].sort((a,b)=>a-b);
    const shades={yellow:'FFF0A1',green:'C3EBCB',pink:'F9CADB',blue:'CFE6FF'};
    let body=paragraph('VƯỜN VĂN · BÀI VIẾT ĐÃ NHẬN XÉT',true)+paragraph(x.title,true)+paragraph('Học sinh: '+x.student+' · Lớp: '+x.className)+paragraph('Bản nộp: '+(x.version||s.id)+' · '+(s.createdAt||s.created_at||''))+paragraph('Trạng thái: '+(s.status==='returned'?'Đã trả bài':'Nhận xét bản nháp'))+paragraph('Đề bài',true)+paragraph(x.prompt||'')+paragraph('Bài viết',true);
    body+='<w:p>'+stops.slice(1).map((end,i)=>{
      const start=stops[i], style=Object.assign({},...styles.filter(f=>f.start<=start&&f.end>=end)), note=ranges.filter(n=>n.start<=start&&n.end>=end).at(-1);
      let props=(style.bold?'<w:b/>':'')+(style.italic?'<w:i/>':'')+(style.underline?'<w:u w:val="single"/>':'');
      if(/^#[a-f0-9]{6}$/i.test(style.color||''))props+='<w:color w:val="'+style.color.slice(1)+'"/>';
      if(note)props+='<w:shd w:fill="'+(shades[note.color]||shades.yellow)+'"/>';
      return run(text.slice(start,end),props);
    }).join('')+'</w:p>';
    body+=paragraph('Đánh giá theo rubric · '+x.rubric.name,true);
    x.rubric.criteria.forEach((c,i)=>{const score=s.scores?.[i];body+=paragraph(c.name+': '+(score??'Chưa chấm'));const level=c.levels.find(l=>l.score===score);if(level)body+=paragraph(level.text);});
    const complete=x.rubric.criteria.every((c,i)=>s.scores?.[i]!==undefined);
    if(complete)body+=paragraph('Tổng điểm sau quy đổi: '+Math.round(Object.values(s.scores).reduce((n,v)=>n+Number(v),0)/x.rubric.max*x.scale*100)/100+' / '+x.scale,true);
    body+=paragraph('Nhận xét chung',true)+paragraph(s.overall||'Chưa có nhận xét chung.')+paragraph('Góp ý theo đoạn',true);
    notes.forEach((n,i)=>{body+=paragraph((i+1)+'. “'+n.quote+'”',true)+paragraph(n.text||'Đoạn được giáo viên đánh dấu.');if(n.reply)body+=paragraph('Phản hồi của học sinh: '+n.reply);});
    const prefix='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    return zip({'[Content_Types].xml':prefix+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', '_rels/.rels':prefix+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', 'word/document.xml':prefix+'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1417"/></w:sectPr></w:body></w:document>'});
  }
  function saveReview(record) {
    download('Vuon-Van-bai-nhan-xet-'+record.submission.id+'.docx',review(record),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }
  function saveGrades(records) {download('Vuon-Van-bang-diem.csv',grades(records),'text/csv;charset=utf-8');}
  return {grades,review,saveGrades,saveReview};
})();
