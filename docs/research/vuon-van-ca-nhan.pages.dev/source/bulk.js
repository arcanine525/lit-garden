/* CSV import has no external dependencies. Account creation is teacher-only on the server. */
globalThis.Bulk=(()=>{
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function parse(input){
  const text=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const first=text.split('\n')[0];const separator=first.includes('\t')?'\t':first.includes(';')?';':',';
  let rows=[],row=[],value='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
   const c=text[i];
   if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++}else{quoted=false;closed=true}}else value+=c;continue;}
   if(c===separator||c==='\n'){row.push(value.trim());value='';closed=false;if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[];}continue;}
   if(c==='"'){if(value||closed)throw Error('Dấu ngoặc kép trong CSV không hợp lệ.');quoted=true;continue;}
   if(closed&&c.trim())throw Error('Có kí tự thừa sau dấu ngoặc kép.');value+=c;
  }
  if(quoted)throw Error('CSV có dấu ngoặc kép chưa đóng.');row.push(value.trim());if(row.some(Boolean))rows.push(row);
  const header=rows.shift()||[],required=['ho_ten','ten_dang_nhap','lop','nam_hoc'];
  if(required.some(k=>header.filter(h=>h===k).length!==1))throw Error('Cần bốn cột: ho_ten, ten_dang_nhap, lop, nam_hoc.');
  if(!rows.length||rows.length>300)throw Error('Mỗi lần nhập từ 1 đến 300 học sinh.');
  const seen=new Set();return rows.map((r,i)=>{
   const item=Object.fromEntries(required.map(k=>[k,r[header.indexOf(k)]||'']));
   let error='';if(r.length!==header.length)error='Số cột không khớp';
   if(!item.ho_ten||item.ho_ten.length>100)error='Họ tên cần 1–100 kí tự';
   if(!/^[a-z0-9_]{3,30}$/.test(item.ten_dang_nhap))error='Tên đăng nhập: 3–30 kí tự a-z, 0-9, _';
   if(!item.lop||item.lop.length>100||!item.nam_hoc||item.nam_hoc.length>30)error='Kiểm tra lớp và năm học';
   if(seen.has(item.ten_dang_nhap))error='Tên đăng nhập trùng trong tệp';seen.add(item.ten_dang_nhap);
   return {...item,line:i+2,error};
  });
 }
 function csv(rows){return '\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/^[=+@\-]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n');}
 function download(name,rows){const url=URL.createObjectURL(new Blob([csv(rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function panel(html){const el=document.getElementById('modal');el.innerHTML=html;el.showModal();return el;}
 function classes({api,load,msg}){
  const m=panel('<h2>Tạo nhiều lớp</h2><form id="batchClasses"><label>Năm học<input name="year" required maxlength="30" placeholder="2026–2027"></label><label>Tên lớp, mỗi lớp một dòng<textarea name="names" required placeholder="10A1\n10A2\nLớp bồi dưỡng"></textarea></label><button class="btn">Tạo các lớp</button><button type="button" class="btn secondary" id="cancelClasses">Đóng</button><p id="classProgress" role="status"></p></form>');
  let busy=false;m.oncancel=e=>{if(busy)e.preventDefault()};document.getElementById('cancelClasses').onclick=()=>{if(!busy)m.close()};
  document.getElementById('batchClasses').onsubmit=async e=>{
   e.preventDefault();if(busy)return;const f=new FormData(e.target);const names=[...new Set(String(f.get('names')).split(/\r?\n/).map(s=>s.trim()).filter(Boolean))];
   if(!names.length||names.length>50||names.some(n=>n.length>100))return msg('Mỗi lần tối đa 50 lớp; tên lớp tối đa 100 kí tự.');
   busy=true;const button=e.submitter;button.disabled=true;const progress=document.getElementById('classProgress');let done=0;
   try{for(const name of names){await api('classes',{name,year:String(f.get('year')).trim()});progress.textContent=`Đã xử lí ${++done}/${names.length} lớp.`;}await load();progress.textContent+=' Có thể đóng cửa sổ.';}
   catch(e){progress.textContent=`Đã xử lí ${done} lớp. ${e.message} Có thể thử lại; lớp đã có sẽ được giữ lại.`;}
   finally{busy=false;button.disabled=false;}
  };
 }
 function open({api,load,msg}){
  const m=panel('<h2>Nhập danh sách học sinh</h2><p>Dùng CSV UTF-8 từ Excel hoặc Google Sheets. Website tự tạo lớp còn thiếu và cấp tài khoản.</p><p><a href="mau-hoc-sinh.csv" download class="link">Tải mẫu CSV ↗</a></p><label>Chọn tệp CSV<input id="csvFile" type="file" accept=".csv,.tsv,text/csv"></label><div id="csvPreview"></div><p id="csvProgress" role="status"></p><div class="button-row"><button class="btn" id="csvStart" disabled>Tạo tài khoản</button><button class="btn secondary" id="csvExport" disabled>Tải kết quả và mật khẩu tạm</button><button class="btn secondary" id="csvClose">Đóng</button></div><p class="footnote">Tải kết quả trước khi đóng. Mật khẩu mới chỉ hiển thị ở lượt tạo này; gửi riêng cho từng học sinh. Tài khoản đã có giữ nguyên mật khẩu.</p>');
  let rows=[],results=[],busy=false;const start=document.getElementById('csvStart'),output=document.getElementById('csvExport'),file=document.getElementById('csvFile'),progress=document.getElementById('csvProgress');
  m.oncancel=e=>{if(busy)e.preventDefault()};document.getElementById('csvClose').onclick=()=>{if(!busy)m.close()};
  const resultRows=()=>[['ho_ten','ten_dang_nhap','lop','nam_hoc','ket_qua','mat_khau_tam'],...results.map(r=>[r.ho_ten,r.ten_dang_nhap,r.lop,r.nam_hoc,r.status,r.password||''])];
  output.onclick=()=>download('vuon-van-ket-qua-tai-khoan.csv',resultRows());
  file.onchange=async()=>{start.disabled=true;rows=[];results=[];output.disabled=true;
   try{if(!file.files[0])return;if(file.files[0].size>1048576)throw Error('Tệp tối đa 1 MB.');rows=parse(await file.files[0].text());
    document.getElementById('csvPreview').innerHTML='<div class="table-wrap" style="max-height:280px;overflow:auto"><table><tr><th>Dòng</th><th>Họ tên</th><th>Tài khoản</th><th>Lớp</th><th>Kiểm tra</th></tr>'+rows.map(r=>`<tr><td>${r.line}</td><td>${escape(r.ho_ten)}</td><td>${escape(r.ten_dang_nhap)}</td><td>${escape(r.lop)}</td><td>${escape(r.error||'Hợp lệ')}</td></tr>`).join('')+'</table></div>';
    const errors=rows.filter(r=>r.error).length;progress.textContent=errors?`Có ${errors} dòng lỗi. Sửa tệp và chọn lại trước khi nhập.`:`${rows.length} dòng hợp lệ. Nhấn Tạo tài khoản để thực hiện.`;start.disabled=!!errors;
   }catch(e){progress.textContent=e.message;}
  };
  start.onclick=async()=>{
   if(busy||!rows.length||rows.some(r=>r.error))return;busy=true;start.disabled=true;file.disabled=true;results=[];const classes=new Map();
   try{for(const row of rows){let result={...row};try{
     const key=JSON.stringify([row.lop,row.nam_hoc]);if(!classes.has(key)){const list=await api('classes',{name:row.lop,year:row.nam_hoc});classes.set(key,list[0].id);}
     const response=await api('students',{name:row.ho_ten,username:row.ten_dang_nhap,class_id:classes.get(key)});
     result.status=response.existing?'Đã có tài khoản; giữ mật khẩu hiện tại':'Đã tạo';result.password=response.temporaryPassword||'';
    }catch(e){result.status='Lỗi: '+e.message;}
    results.push(result);output.disabled=false;progress.textContent=`Đã xử lí ${results.length}/${rows.length}. Có ${results.filter(r=>r.status.startsWith('Lỗi:')).length} dòng lỗi.`;
   }await load();progress.textContent+=' Hãy tải kết quả. Muốn thử lại dòng lỗi, tạo CSV chỉ gồm những dòng đó.';
   }catch(e){msg(e.message)}finally{busy=false;file.disabled=false;}
  };
 }
 return {parse,csv,open,classes};
})();
