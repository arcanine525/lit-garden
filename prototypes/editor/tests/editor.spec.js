import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const evidence = new URL('../evidence/', import.meta.url);
async function ready(page) { await page.goto('/'); await page.waitForFunction(()=>window.spike?.ready && document.querySelector('[contenteditable="true"]')?.textContent.includes('Mùa xuân')); }
async function post(page,path,body) { return page.evaluate(async({path,body})=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};},{path,body}); }

test('MDXEditor DOM: supported Markdown round-trips and stabilizes across two cycles',async({page,browser})=>{
  await ready(page); const errors=[]; page.on('pageerror',(e)=>errors.push(e.message));
  const fixtures=await page.evaluate(()=>window.spike.cases),results=[];
  for(const fixture of fixtures) {
    expect(await page.evaluate((md)=>window.spike.set(md),fixture.markdown)).toBe(true);
    await expect.poll(()=>page.evaluate(()=>window.spike.get())).not.toBe('');
    // Full visible text and handled import errors, not just a prefix or retained source.
    const expectedText=await page.evaluate(md=>window.spike.projectMarkdown(md).text.replace(/\s/g,''),fixture.markdown);
    async function assertRichTree() {
      await expect.poll(()=>page.locator('[contenteditable="true"]').first().textContent().then(t=>t.replace(/\s/g,''))).toBe(expectedText);
      expect(await page.evaluate(()=>window.spike.importError())).toBeNull();
    }
    await assertRichTree();
    const first=await page.evaluate(()=>window.spike.get());
    await page.evaluate((md)=>window.spike.set(md),first);
    await assertRichTree();
    const second=await page.evaluate(()=>window.spike.get());
    const comparison=await page.evaluate(({input,first,second})=>({semanticEqual:JSON.stringify(window.spike.semantic(input))===JSON.stringify(window.spike.semantic(first)),stable:JSON.stringify(window.spike.semantic(first))===JSON.stringify(window.spike.semantic(second)),textEqual:window.spike.projectMarkdown(input).text===window.spike.projectMarkdown(first).text}),{input:fixture.markdown,first,second});
    const editable=page.locator('[contenteditable="true"]').first();
    await editable.click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' VERIFYEDIT');
    // Table cells are nested editors and commit to the root on blur. Exercise
    // that real UI boundary before reading the serialized document.
    await page.getByRole('heading',{name:'Vườn Văn · Kiểm chứng editor',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>window.spike.get())).toContain('VERIFYEDIT');
    results.push({id:fixture.id,input:fixture.markdown,first,second,syntaxChanged:first!==fixture.markdown,fullRichTextVerified:true,richEditExported:true,...comparison});
  }
  await writeFile(new URL('round-trip.json',evidence),JSON.stringify({browser:browser.version(),editor:'4.5.0',results,errors},null,2)+'\n');
  expect(errors).toEqual([]); expect(results.filter((r)=>!r.semanticEqual || !r.stable || !r.textEqual)).toEqual([]);
});

test('source gate and rich editing: Vietnamese typing, bold, paste, no underline toolbar',async({page})=>{
  await ready(page); await page.evaluate(()=>window.spike.set('Tiếng Việt'));
  const editable=page.locator('[contenteditable="true"]');
  await editable.click(); await page.keyboard.press('End'); await page.keyboard.type(' — vườn xanh');
  await expect.poll(()=>page.evaluate(()=>window.spike.get())).toContain('vườn xanh');
  await page.keyboard.press('ControlOrMeta+a'); await page.getByRole('radio',{name:'Bold',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.spike.get())).toContain('**');
  await expect(page.getByRole('radio',{name:'Underline',exact:true})).toHaveCount(0);
  await editable.click(); await page.keyboard.press('ControlOrMeta+u');
  await expect(page.getByLabel('Trạng thái editor')).toHaveText('UNSUPPORTED_UNDERLINE');
  expect(await page.evaluate(()=>window.spike.get())).not.toContain('<u>');
  await page.evaluate(()=>{const d=new DataTransfer();d.setData('text/plain',' thêm **ý mới**');document.querySelector('[contenteditable="true"]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));});
  await expect.poll(()=>page.evaluate(()=>window.spike.get())).toContain('ý mới');
  await page.getByRole('button',{name:'Mã Markdown',exact:true}).click();
  await page.getByLabel('Nguồn Markdown',{exact:true}).fill('# Đề bài\n\n**Hoa** và *lá*.');
  await page.getByRole('button',{name:'Áp dụng nguồn'}).click();
  await expect(editable.locator('h1')).toHaveText('Đề bài'); await expect(editable.locator('strong')).toHaveText('Hoa');
  await page.getByRole('button',{name:'Mã Markdown',exact:true}).click();
  await expect(page.getByLabel('Nguồn Markdown',{exact:true})).toHaveValue('# Đề bài\n\n**Hoa** và *lá*.');
  await page.getByLabel('Nguồn Markdown',{exact:true}).fill('<u>không được</u>'); await page.getByRole('button',{name:'Áp dụng nguồn'}).click();
  await expect(page.getByLabel('Trạng thái editor')).toContainText('UNSUPPORTED_html');
});

test('student cannot insert images through source, HTML paste, file paste/drop or API',async({page})=>{
  await ready(page); await page.getByLabel('Vai thử nghiệm').selectOption('student');
  await expect.poll(()=>page.evaluate(()=>window.spike.get())).toContain('Mùa xuân');
  await page.getByRole('button',{name:'Mã Markdown',exact:true}).click();
  await page.getByLabel('Nguồn Markdown',{exact:true}).fill('![x](/api/assets/flower)'); await page.getByRole('button',{name:'Áp dụng nguồn'}).click();
  await expect(page.getByLabel('Trạng thái editor')).toHaveText('STUDENT_IMAGE_FORBIDDEN');
  await page.getByLabel('Nguồn Markdown',{exact:true}).fill('Bài học sinh'); await page.getByRole('button',{name:'Áp dụng nguồn'}).click();
  const pasted=await page.evaluate(()=>{
    const el=document.querySelector('[contenteditable="true"]');
    const html=new DataTransfer();html.setData('text/html','<img src="https://example.org/tracker.png">');html.setData('text/plain','ảnh');
    const h=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:html}); el.dispatchEvent(h);
    const dt=new DataTransfer();dt.items.add(new File([new Uint8Array([1,2,3])],'x.png',{type:'image/png'}));
    const p=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}); el.dispatchEvent(p);
    const d=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt});el.dispatchEvent(d);
    return [h.defaultPrevented,p.defaultPrevented,d.defaultPrevented];
  });
  expect(pasted).toEqual([true,true,true]); expect(await page.evaluate(()=>window.spike.get())).toBe('Bài học sinh');
  expect((await post(page,'/api/documents',{markdown:'![x](/api/assets/flower)'})).status).toBe(400);
  expect((await post(page,'/api/documents',{markdown:'<img src="/api/assets/flower">'})).status).toBe(400);
  expect((await post(page,'/api/documents',{markdown:'Bài học sinh hợp lệ'})).status).toBe(200);
  expect((await post(page,'/api/documents',{markdown:'![x][a]\n\n[a]: /api/assets/flower'})).status).toBe(400);
  const upload=await page.evaluate(async()=>{const r=await fetch('/api/assets',{method:'POST',headers:{'Content-Type':'image/png'},body:new Uint8Array([137,80,78,71,13,10,26,10])});return r.status;});
  expect(upload).toBe(403);
});

test('private mock image: stable Markdown, rendered image, session-bound expiry, renew, revoked/missing/offline',async({page,browser})=>{
  await ready(page);
  for(const markdown of ['![x](/api/assets/no-such-asset)','![x][a]\n\n[a]: /api/assets/no-such-asset']) expect((await post(page,'/api/documents',{markdown})).status).toBe(404);
  await page.getByRole('button',{name:'Chèn ảnh mock',exact:true}).click();
  const image=page.locator('[contenteditable="true"] img').first();
  await expect(image).toBeVisible(); await expect.poll(()=>image.evaluate((i)=>i.naturalWidth)).toBeGreaterThan(0);
  const saved=await page.evaluate(()=>window.spike.get()); expect(saved).toContain('![Hoa riêng tư](/api/assets/flower)'); expect(saved).not.toContain('asset-views'); expect(saved).not.toContain('<img');
  const lease=await post(page,'/api/assets/flower/lease',{}); expect(lease.status).toBe(200); expect(lease.cache).toBe('private, no-store');
  const stranger=await browser.newContext(); const denied=await stranger.request.get(`http://127.0.0.1:4311${lease.body.url}`); expect(denied.status()).toBe(401); await stranger.request.post('http://127.0.0.1:4311/api/mock/login',{data:{role:'student'}});
  expect((await stranger.request.get(`http://127.0.0.1:4311${lease.body.url}`)).status()).toBe(403); await stranger.close();
  const actual=await page.request.get(lease.body.url); expect(actual.status()).toBe(200); expect(actual.headers()['cache-control']).toBe('private, no-store');
  await expect.poll(async()=> (await page.request.get(lease.body.url)).status(),{timeout:5000,intervals:[300]}).toBe(410);
  expect((await post(page,'/api/assets/flower/lease',{})).status).toBe(200);
  for(const [state,code,error] of [['revoked',403,'DRIVE_PERMISSION_LOST'],['missing',404,'DRIVE_FILE_MISSING'],['disconnected',503,'DRIVE_RECONNECT']]) {
    const live=await post(page,'/api/assets/flower/lease',{});
    await post(page,'/api/assets/flower/state',{status:state});
    const failure=await post(page,'/api/assets/flower/lease',{}); expect(failure.status).toBe(code); expect(failure.body.error).toBe(error);
    if(live.status===200) expect((await page.request.get(live.body.url)).status()).toBe(code);
    await page.getByRole('button',{name:'Tải lại URL ảnh',exact:true}).click(); await expect(page.getByLabel('Trạng thái editor')).toContainText(error); await expect(page.locator('[contenteditable="true"] img').first()).toHaveAttribute('src','/unavailable.svg');
    await post(page,'/api/assets/flower/state',{status:'available'});
  }
  await page.getByLabel('Vai thử nghiệm').selectOption('student'); expect((await post(page,'/api/assets/flower/lease',{})).status).toBe(200);
  for(const role of ['outsider','admin']) { await post(page,'/api/mock/login',{role});expect((await post(page,'/api/assets/flower/lease',{})).status).toBe(403); }
});

test('teacher PNG upload through actual MDXEditor clipboard calls mock adapter and keeps stable reference',async({page})=>{
  await ready(page); const response=page.waitForResponse((r)=>r.url().endsWith('/api/assets')&&r.request().method()==='POST');
  await page.locator('[contenteditable="true"]').first().click();
  await page.evaluate(()=>{const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII='),(c)=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([png],'flower.png',{type:'image/png'}));document.querySelector('[contenteditable="true"]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));});
  expect((await response).status()).toBe(201); await expect.poll(()=>page.evaluate(()=>window.spike.get())).toMatch(/\/api\/assets\/[0-9a-f-]{36}/);
  expect(await page.evaluate(()=>window.spike.get())).not.toContain('asset-views');
});

test('DOM annotation selection across bold leaves: review-only reload, repeated excerpt, Unicode, changed original',async({page})=>{
  await ready(page);
  expect(await page.locator('article').textContent()).toBe(await page.evaluate(()=>window.spike.projectMarkdown(window.spike.get()).text));
  const projected=await page.evaluate(()=>window.spike.projectMarkdown(window.spike.cases.find((c)=>c.id==='repeated').markdown).text);
  expect(projected).toContain('Hoa nở. Hoa nở.');
  async function selectQuote(quote,occurrence=0) {
    await page.evaluate(({quote,occurrence})=>{
      const root=document.querySelector('[data-testid="submission"]'),text=root.textContent;let start=-1;
      for(let i=0;i<=occurrence;i++)start=text.indexOf(quote,start+1);
      if(start<0)throw Error('quote missing');
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node,pos=0,a,b;
      while(node=walker.nextNode()){const end=pos+node.textContent.length;if(!a&&start>=pos&&start<end)a=[node,start-pos];if(start+quote.length>pos&&start+quote.length<=end){b=[node,start+quote.length-pos];break;}pos=end;}
      const range=document.createRange();range.setStart(...a);range.setEnd(...b);window.getSelection().removeAllRanges();window.getSelection().addRange(range);root.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    },{quote,occurrence});
  }
  for(const [quote,occurrence] of [['Hoa nở.',1],['👩🏽‍🏫',0],['a\u0306\u0301',0],['Hình ảnh',0],['Hoa nở. Hoa nở.',0]]) {
    await selectQuote(quote,occurrence); await page.getByRole('button',{name:'Ghi review Markdown cục bộ',exact:true}).click();
    await expect(page.locator('article mark')).toHaveText(quote.includes('Hoa nở. Hoa nở.')?['Hoa nở. ','Hoa nở.']:quote);
    const md=await page.evaluate(()=>window.spike.review()); expect(md).toContain('contentHash:');
    // Only review Markdown survives; original is independently reloaded fixture.
    await page.reload(); await page.waitForFunction(()=>window.spike?.ready);
    await expect(page.getByLabel('Trạng thái review')).toHaveText('restored');
    expect(await page.locator('article mark').allTextContents()).toEqual(quote.includes('Hoa nở. Hoa nở.')?['Hoa nở. ','Hoa nở.']:[quote]);
  }
  await page.screenshot({path:new URL('annotation-reloaded.png',evidence).pathname,fullPage:true});
  await writeFile(new URL('sample.review.md',evidence),await page.evaluate(()=>window.spike.review()));
  await page.getByRole('button',{name:'Đổi/khôi phục nội dung gốc',exact:true}).click();
  await expect(page.getByLabel('Trạng thái review')).toHaveText('content-conflict'); await expect(page.locator('article mark')).toHaveCount(0);
  await page.getByRole('button',{name:'Đổi/khôi phục nội dung gốc',exact:true}).click(); await expect(page.getByLabel('Trạng thái review')).toHaveText('restored');
});

// R1: reading the original source back is not evidence of a successful rich import.
test('reference links render completely and rich edits reach exported Markdown',async({page})=>{
  await ready(page);
  await page.evaluate(()=>window.spike.set(window.spike.cases.find(c=>c.id==='links').markdown));
  const editable=page.locator('[contenteditable="true"]').first();
  await expect(editable).toContainText('Vườn Văn và tham chiếu.');
  await expect(editable.getByRole('link',{name:'tham chiếu',exact:true})).toHaveAttribute('href','https://example.org/b');
  await editable.click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' NEWEDIT');
  await expect.poll(()=>page.evaluate(()=>window.spike.get())).toContain('NEWEDIT');
});

test('reference images use the private adapter and pasted reference links remain editable',async({page})=>{
  await ready(page);
  await page.evaluate(()=>window.spike.set('![Hoa riêng tư][asset]\n\n[asset]: /api/assets/flower'));
  const editable=page.locator('[contenteditable="true"]').first();
  const img=editable.locator('img');await expect(img).toBeVisible();
  await expect.poll(()=>img.evaluate(i=>i.naturalWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>window.spike.get())).toContain('![Hoa riêng tư](/api/assets/flower)');
  expect(await page.evaluate(()=>window.spike.importError())).toBeNull();
  await page.evaluate(()=>window.spike.set('Bắt đầu'));
  await editable.click();await page.keyboard.press('End');
  await page.evaluate(()=>{const d=new DataTransfer();d.setData('text/plain',' [Tài liệu][doc]\n\n[doc]: https://example.org/doc');document.querySelector('[contenteditable="true"]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));});
  await expect(editable.getByRole('link',{name:'Tài liệu',exact:true})).toHaveAttribute('href','https://example.org/doc');
  await editable.click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' PASTEEDIT');
  await expect.poll(()=>page.evaluate(()=>window.spike.get())).toContain('PASTEEDIT');
});

test('handled MDX import error keeps source visible, blocks save and permits recovery',async({page})=>{
  await ready(page);
  const unsupported='```js\nconst x = 1;\n```';
  // Deliberately bypass the AST gate only through the local spike probe, to exercise
  // MDXEditor's handled error callback rather than a thrown validator error.
  await page.evaluate(md=>window.spike.probeImport(md),unsupported);
  await expect(page.getByLabel('Trạng thái editor')).toContainText('EDITOR_IMPORT:');
  await expect(page.getByLabel('Nguồn Markdown',{exact:true})).toHaveValue(unsupported);
  await expect(page.locator('[contenteditable="true"]').first()).not.toBeVisible();
  await page.getByRole('button',{name:'Mã Markdown',exact:true}).click();
  await expect(page.getByLabel('Nguồn Markdown',{exact:true})).toHaveValue(unsupported);
  let writes=0;page.on('request',r=>{if(r.url().endsWith('/api/documents'))writes++;});
  await page.getByRole('button',{name:'Kiểm tra lưu qua API mock',exact:true}).click();
  await expect(page.getByLabel('Trạng thái editor')).toHaveText('EDITOR_IMPORT_FAILED');expect(writes).toBe(0);
  await page.getByLabel('Nguồn Markdown',{exact:true}).fill('# Khôi phục');
  await page.getByRole('button',{name:'Áp dụng nguồn'}).click();
  await expect(page.locator('[contenteditable="true"] h1')).toHaveText('Khôi phục');
  expect(await page.evaluate(()=>window.spike.importError())).toBeNull();
  await page.locator('[contenteditable="true"]').first().click();await page.keyboard.press('End');await page.keyboard.type(' OK');
  await expect.poll(()=>page.evaluate(()=>window.spike.get())).toContain('OK');
});
