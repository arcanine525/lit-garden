const Shelf = (() => {
  const esc = x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const categories=['Hướng dẫn','Bài văn hay','Ngữ liệu','Tài liệu khác'];
  const slots=[['hint','Một chút gợi mở'],['read','Chậm một chút, đọc sâu hơn.']];
  function demoProvider(userId){
    let connection;
    function database(){
      return connection ||= new Promise((resolve,reject)=>{
        const req=indexedDB.open('vuonvan-library',1);
        req.onupgradeneeded=()=>{for(const name of ['docs','files','stars'])req.result.createObjectStore(name);};
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
    }
    async function transaction(stores,mode,action){
      const db=await database();
      return new Promise((resolve,reject)=>{const tx=db.transaction(stores,mode);let result=action(tx);tx.oncomplete=()=>resolve(result?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
    }
    return {
      async list(){const docs=await transaction(['docs'],'readonly',t=>t.objectStore('docs').getAll());return docs.sort((a,b)=>b.created_at.localeCompare(a.created_at));},
      favorites:async()=>await transaction(['stars'],'readonly',t=>t.objectStore('stars').get(userId()))||[],
      async star(id,on){const key=userId(),db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('stars','readwrite'),store=tx.objectStore('stars'),get=store.get(key);get.onsuccess=()=>{const ids=new Set(get.result||[]);if(on)ids.add(id);else ids.delete(id);store.put([...ids],key);};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});},
      async add(meta,file){const id=crypto.randomUUID();await transaction(['docs','files'],'readwrite',t=>{t.objectStore('docs').put({...meta,id,created_at:new Date().toISOString()},id);if(file)t.objectStore('files').put(file,id);});},
      file:id=>transaction(['files'],'readonly',t=>t.objectStore('files').get(id))
    };
  }
  function liveProvider(api){
    return {
      list:()=>api('library'),favorites:()=>api('library/favorites'),
      star:(id,on)=>api('library/star',{id,on}),
      async add(meta,file){
        if(meta.link)return api('library/upload',meta);
        const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
        await api('library/upload',{...meta,base64});
      },
      async file(id){const x=await api('library/file?id='+encodeURIComponent(id));return new Blob([Uint8Array.from(atob(x.base64),c=>c.charCodeAt(0))],{type:x.mime});}
    };
  }
  function documentUrl(value){
    try {
      const url=new URL(value);
      if(url.protocol==='https:' && !url.username && !url.password && url.href.length<=4096)return url.href;
    }catch{}
    return '';
  }
  function readAction(doc,label){
    if(doc.link){
      const href=documentUrl(doc.link);
      return href ? '<a class="link" target="_blank" rel="noopener noreferrer" href="'+esc(href)+'">'+esc(label)+' ↗</a>' : 'Liên kết không hợp lệ';
    }
    return '<button class="link" data-read="'+esc(doc.id)+'">'+esc(label)+'</button>';
  }
  async function read(doc,store){
    const file=await store.file(doc.id);
    const modal=document.getElementById('modal');
    const url=URL.createObjectURL(file);
    modal.innerHTML='<div class="section-head"><h2>'+esc(doc.title)+'</h2><button class="btn secondary" type="button">Đóng</button></div><p>'+esc(doc.source||'')+'</p><div class="shelf-reader"></div><a class="link" download="'+esc(doc.filename)+'" href="'+url+'">Tải tài liệu</a>';
    modal.querySelector('button').onclick=()=>modal.close();
    modal.addEventListener('close',()=>{URL.revokeObjectURL(url);modal.classList.remove('reader-dialog');},{once:true});
    const viewer=modal.querySelector('.shelf-reader');
    if(doc.mime==='application/pdf'){
      const frame=document.createElement('iframe');frame.title=doc.title;frame.src=url;viewer.append(frame);
    }else viewer.textContent=await file.text();
    modal.classList.add('reader-dialog');modal.showModal();
  }
  function cards(host,store,role,openLibrary){
    host.innerHTML='<section class="panel library-invitation"><button type="button" class="library-entry"><h3>Ghé thăm Thư viện</h3><p>Xem các tài liệu hướng dẫn và bài văn hay</p></button></section><section class="garden-note garden-quote"><img src="khu-vuon-trong-lo-muc.webp" alt="Khu vườn trong lọ mực"><div><blockquote>“Ước mơ mà không kèm theo hành động thì dù hi vọng có cánh cũng không bao giờ bay tới đích”</blockquote><p class="quote-author">(Shakespeare)</p></div></section>';
    host.querySelector('.library-entry').onclick=openLibrary;
  }
  async function mount(host,store,teacher){
    let starredOnly=false;
    host.innerHTML=(teacher?'<details class="panel"><summary class="link">+ Thêm tài liệu</summary><form><label>Tên tài liệu<input name="title" required maxlength="180"></label><label>Loại tài liệu<select name="category">'+categories.map(c=>'<option>'+c+'</option>').join('')+'</select></label><label>Tác giả hoặc nguồn<input name="source" maxlength="300"></label><label>Cách chia sẻ<select name="mode"><option value="file">Tải tệp lên</option><option value="link">Dán liên kết Drive / Docs / tài liệu khác</option></select></label><div data-url hidden><label>Liên kết tài liệu<input type="url" name="link" maxlength="4096" placeholder="https://..." disabled></label><small>Với Google Drive hoặc Google Docs, hãy cấp quyền xem cho học sinh cần đọc.</small></div><div data-file><label>Tệp để học sinh đọc (PDF hoặc TXT, tối đa 2 MB)<input type="file" name="file" accept=".pdf,.txt" required></label></div><label>Giới thiệu ở trang chính<select name="slot"><option value="">Chỉ lưu trong Thư viện</option>'+slots.map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></label><label>Đoạn trích do giáo viên chọn<textarea name="excerpt" maxlength="600"></textarea></label><small>Nếu nhiều tài liệu cùng mục, trang chính hiển thị đoạn trích mới nhất.</small><p><button class="btn">Chia sẻ với học sinh</button></p></form></details>':'')+'<section class="panel"><div class="button-row"><button class="btn secondary" data-all>Tất cả tài liệu</button><button class="btn secondary" data-starred>★ Yêu thích</button></div><p role="status"></p><div class="shelf-list"></div></section>';
    const status=host.querySelector('[role=status]');const notify=t=>status.textContent=t;
    async function refresh(){
      const [docs,stars]=await Promise.all([store.list(),store.favorites()]);const visible=docs.filter(d=>!starredOnly||stars.includes(d.id));
      host.querySelector('[data-all]').setAttribute('aria-pressed',String(!starredOnly));host.querySelector('[data-starred]').setAttribute('aria-pressed',String(starredOnly));
      host.querySelector('.shelf-list').innerHTML=visible.map(d=>'<article class="assignment"><div class="assignment-body"><strong>'+esc(d.title)+'</strong><small>'+esc([d.category,d.source].filter(Boolean).join(' · '))+'</small></div>'+readAction(d,d.link?'Mở liên kết':'Đọc')+'<button class="link" data-star="'+esc(d.id)+'">'+(stars.includes(d.id)?'★ Đã lưu':'☆ Lưu yêu thích')+'</button></article>').join('')||'<p>'+(starredOnly?'Chưa có tài liệu yêu thích.':'Thư viện đang chờ tài liệu đầu tiên của giáo viên.')+'</p>';
      host.querySelectorAll('[data-read]').forEach(b=>b.onclick=()=>read(docs.find(d=>d.id===b.dataset.read),store).catch(e=>notify(e.message)));
      host.querySelectorAll('[data-star]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await store.star(b.dataset.star,!stars.includes(b.dataset.star));await refresh();}catch(e){notify(e.message);b.disabled=false;}});
    }
    host.querySelector('[data-all]').onclick=()=>{starredOnly=false;refresh().catch(e=>notify(e.message));};
    host.querySelector('[data-starred]').onclick=()=>{starredOnly=true;refresh().catch(e=>notify(e.message));};
    function syncMode(form){
      const linked=form.elements.mode.value==='link';
      form.querySelector('[data-url]').hidden=!linked;
      form.querySelector('[data-file]').hidden=linked;
      form.elements.link.disabled=!linked;form.elements.link.required=linked;
      form.elements.file.disabled=linked;form.elements.file.required=!linked;
    }
    if(teacher){
      const form=host.querySelector('form');
      form.elements.mode.onchange=()=>syncMode(form);
      form.elements.file.onchange=()=>{
        if(form.elements.file.files[0]?.size>2*1024*1024){
          form.elements.file.value='';form.elements.mode.value='link';syncMode(form);
          notify('Tệp vượt 2 MB. Hãy dán liên kết tới tài liệu.');form.elements.link.focus();
        }
      };
    }
    if(teacher)host.querySelector('form').onsubmit=async e=>{
      e.preventDefault();const f=e.target,b=f.querySelector('button'),values=new FormData(f),file=values.get('file');
      const meta=Object.fromEntries(['title','category','source','slot','excerpt'].map(k=>[k,String(values.get(k)||'').trim()]));
      if(!meta.title||meta.slot&&!meta.excerpt)return notify('Nhập tên tài liệu và đoạn trích cho mục giới thiệu đã chọn.');
      if(values.get('mode')==='link'){
        meta.link=documentUrl(String(values.get('link')||'').trim());
        if(!meta.link)return notify('Hãy dán liên kết HTTPS hợp lệ.');
      }else{
      if(!file.size||file.size>2*1024*1024||!/[.](pdf|txt)$/i.test(file.name))return notify('Chọn PDF hoặc TXT, tối đa 2 MB.');
      meta.mime=/\.pdf$/i.test(file.name)?'application/pdf':'text/plain';meta.filename=file.name;
      if(meta.mime==='application/pdf'&&await file.slice(0,5).text()!=='%PDF-')return notify('Tệp không có định dạng PDF hợp lệ.');
      }
      b.disabled=true;try{await store.add(meta,meta.link?null:new Blob([file],{type:meta.mime}));f.reset();syncMode(f);f.parentElement.open=false;await refresh();notify('Đã thêm tài liệu vào Thư viện.');}catch(err){notify('Chưa lưu được tài liệu. '+err.message);}finally{b.disabled=false;}
    };
    await refresh();
  }
  return {demoProvider,liveProvider,mount,cards};
})();
