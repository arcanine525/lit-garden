import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMarkdown, prepareEditorMarkdown, projectMarkdown, semantic, sha256 } from '../src/markdown.js';
import { makeAnchor, writeReview, readReview, restoreReview, ReviewLedger, schema } from '../src/review.js';
import { sample, cases } from '../src/fixtures.js';
async function fixture(markdown = sample) {
  const text=projectMarkdown(markdown).text, start=text.indexOf('Hoa nở.',text.indexOf('Hoa nở.')+1);
  return {schema,id:'draft-1',kind:'draft',submissionId:'submission-1',version:1,contentHash:await sha256(markdown),scores:[{criterionId:'c1',value:1,max:2}],overall:'Tiếng Việt 👩🏽‍🏫\n---\nKhông phải metadata.',annotations:[{id:'a1',color:'yellow',comment:'Ý tốt.\n<script>chỉ là chuỗi trong metadata</script>',anchor:await makeAnchor(markdown,start,start+'Hoa nở.'.length)}]};
}
const submission=(r)=>({id:r.submissionId,version:r.version,contentHash:r.contentHash});
test('all supported fixture Markdown validates',()=>{for(const c of cases) assert.doesNotThrow(()=>validateMarkdown(c.markdown));});
test('student images: inline, reference, HTML, data URL, escaped punctuation cannot bypass AST policy',()=>{
  for(const md of ['![ảnh](/api/assets/flower)','![ảnh][x]\n\n[x]: /api/assets/flower','<img src="/api/assets/flower">','<img\nsrc=x />','![x](data:image/png;base64,a)','![x](https://example.org/a.png)']) assert.throws(()=>validateMarkdown(md,'student'));
  assert.doesNotThrow(()=>validateMarkdown('\\![ảnh](https://example.org/a.png)','student')); // literal ! + safe link, no image
});
test('HTML/MDX, arbitrary extensions and dangerous links are rejected for both roles',()=>{
  for(const role of ['student','teacher']) for(const md of ['<u>gạch chân</u>','<span style="color:red">đỏ</span>','export const x = 1','{danger()}','[x](javascript:alert%281%29)','[x](data:text/html,abc)','[x][a]\n\n[a]: javascript:foo','~~gạch~~','- [x] task','`code`']) assert.throws(()=>validateMarkdown(md,role),md);
});
test('teacher images require stable private app references',()=>{
  assert.doesNotThrow(()=>validateMarkdown('![ảnh](/api/assets/flower)','teacher'));
  for(const url of ['https://drive.google.com/file/d/id','/api/asset-views/secret','/api/assets/x?token=bad','data:image/png;base64,x']) assert.throws(()=>validateMarkdown(`![ảnh](${url})`,'teacher'));
});
test('normalization preserves semantics and projection, while raw integrity hash changes',async()=>{
  const before='Tiêu đề\n=======\n\n__Hoa nở.__\n', after='# Tiêu đề\n\n**Hoa nở.**';
  assert.deepEqual(semantic(before),semantic(after)); assert.equal(projectMarkdown(before).text,projectMarkdown(after).text); assert.notEqual(await sha256(before),await sha256(after));
});
test('one review Markdown round-trips scores, overall and annotation without submission edits',async()=>{
  const r=await fixture(), before=sample; const md=writeReview(r), read=readReview(md);
  assert.deepEqual(read,r); assert.equal(sample,before); assert.match(md,/^---\n/); assert.match(md,/# Nhận xét/);
  assert.equal((await restoreReview(read,submission(r),sample)).status,'restored');
});
test('repeated excerpt uses exact second occurrence, never quote-only search',async()=>{
  const r=await fixture(), a=r.annotations[0].anchor;
  assert.ok(a.start>projectMarkdown(sample).text.indexOf(a.exact));
  assert.equal((await restoreReview(readReview(writeReview(r)),submission(r),sample)).annotations[0].anchor.start,a.start);
});
test('Unicode NFD, emoji UTF-16 and cross-format selection survive reload',async()=>{
  for(const quote of ['👩🏽‍🏫','a\u0306\u0301','Hoa nở. Hoa nở.']) {
    const r=await fixture(),text=projectMarkdown(sample).text,start=text.indexOf(quote);
    r.annotations[0].anchor=await makeAnchor(sample,start,start+quote.length);
    assert.equal((await restoreReview(readReview(writeReview(r)),submission(r),sample)).status,'restored');
    assert.equal(r.annotations[0].anchor.exact,quote);
  }
});
test('wrong submission/version, external edit or deletion fail closed',async()=>{
  const r=await fixture(),s=submission(r);
  assert.equal((await restoreReview(r,{...s,id:'different'},sample)).status,'wrong-version');
  assert.equal((await restoreReview(r,{...s,version:2},sample)).status,'wrong-version');
  assert.equal((await restoreReview(r,s,sample+'\nĐổi')).status,'content-conflict');
  assert.equal((await restoreReview(r,s,null)).status,'missing');
});
test('syntax-only external edits also lock grading; normalization is allowed only BEFORE submit',async()=>{
  const raw='Hoa nở. __Hoa nở.__',normalized='Hoa nở. **Hoa nở.**',r=await fixture(raw);
  assert.equal(projectMarkdown(raw).text,projectMarkdown(normalized).text);
  assert.equal((await restoreReview(r,submission(r),normalized)).status,'content-conflict');
  const normalizedReview=await fixture(normalized);
  assert.equal((await restoreReview(normalizedReview,submission(normalizedReview),normalized)).status,'restored');
});
test('tampered position/context/projection cannot silently reattach repeated text',async()=>{
  for(const mutate of [(a)=>a.start=0,(a)=>a.prefix='sai',(a)=>a.textHash='0'.repeat(64)]) {
    const r=await fixture(); mutate(r.annotations[0].anchor);
    assert.equal((await restoreReview(r,submission(r),sample)).status,'anchor-conflict');
  }
  const r=await fixture(); r.annotations[0].anchor.projection='unknown'; assert.throws(()=>readReview(writeReview(r)));
});
test('malformed, duplicate-key YAML and schema errors rejected',async()=>{
  const r=await fixture();
  for(const md of ['# không metadata','---\nschema: x\nschema: y\n---\n','---\na: &a [1]\nb: *a\n---\n']) assert.throws(()=>readReview(md));
  r.annotations.push(r.annotations[0]); assert.throws(()=>writeReview(r));
});
test('draft may omit scores; publication requires complete scores and valid range',async()=>{
  const r=await fixture(); r.scores[0].value=null; assert.doesNotThrow(()=>writeReview(r));
  assert.throws(()=>writeReview({...r,kind:'publication'}));
  r.scores[0].value=3; assert.throws(()=>writeReview(r));
});
test('draft and immutable publications separated, student only current result per submission',async()=>{
  const ledger=new ReviewLedger(), r=await fixture(); ledger.saveDraft(r);
  assert.equal(ledger.read('student').current,null); ledger.publish('p1');
  r.overall='Sửa nháp'; ledger.saveDraft(r); assert.notEqual(ledger.read('student').current.overall,r.overall);
  ledger.publish('p2'); assert.equal(ledger.read('teacher').publications.length,2);
  assert.deepEqual(Object.keys(ledger.read('student')),['current']); assert.equal(ledger.read('student').current.id,'p2');
  assert.equal(ledger.read('teacher').publications[0].overall,'Tiếng Việt 👩🏽‍🏫\n---\nKhông phải metadata.');
  assert.throws(()=>ledger.read('admin')); assert.throws(()=>ledger.publish('p2'));
});
test('replied annotation immutable, sent messages cannot edit/delete',async()=>{
  const ledger=new ReviewLedger(), r=await fixture(); ledger.saveDraft(r); ledger.publish('p1'); ledger.reply('a1','Em cảm ơn');
  r.annotations[0].comment='Sửa'; assert.throws(()=>ledger.saveDraft(r),/REPLIED_COMMENT_IMMUTABLE/);
  r.annotations=[]; assert.throws(()=>ledger.saveDraft(r),/REPLIED_COMMENT_IMMUTABLE/);
  assert.throws(()=>ledger.mutateMessage(),/SENT_MESSAGE_IMMUTABLE/);
});
test('reply arriving after edited draft save blocks later publication',async()=>{
  const ledger=new ReviewLedger(),r=await fixture();ledger.saveDraft(r);ledger.publish('p1');
  r.annotations[0].comment='Bản đang sửa';ledger.saveDraft(r);ledger.reply('a1','Em phản hồi bản đã trả');
  assert.throws(()=>ledger.publish('p2'),/REPLIED_COMMENT_IMMUTABLE/);
  assert.equal(ledger.read('student').current.id,'p1');
});

// R5: untrusted review ranges must not split a UTF-16 surrogate pair.
test('anchor boundaries reject half emoji on create and restore', async()=>{
  const md='🌱', hash=await sha256(md);
  for(const [start,end] of [[0,1],[1,2]]) {
    await assert.rejects(makeAnchor(md,start,end),/ANCHOR_RANGE/);
  }
  const anchor=await makeAnchor(md,0,2);
  const r={schema,id:'emoji',kind:'publication',submissionId:'s',version:1,contentHash:hash,
    scores:[{criterionId:'c',value:1,max:1}],overall:'',annotations:[{id:'a',color:'yellow',comment:'x',anchor}]};
  assert.equal((await restoreReview(readReview(writeReview(r)),submission(r),md)).status,'restored');
  for(const [start,end] of [[0,1],[1,2]]) {
    const bad=structuredClone(r),text=projectMarkdown(md).text;
    Object.assign(bad.annotations[0].anchor,{start,end,exact:text.slice(start,end),prefix:text.slice(0,start),suffix:text.slice(end)});
    assert.equal((await restoreReview(readReview(writeReview(bad)),submission(r),md)).status,'anchor-conflict');
  }
});

test('reference adapter preserves semantics for inline, collapsed, shortcut and image references',()=>{
  for(const md of [
    '[link][a] and [a][] and [a]\n\n[a]: https://example.org/path "Title"',
    '![Hoa][a]\n\n[a]: /api/assets/flower "Ảnh"',
    '> **Đậm** [x][a]  \n> Dòng cứng\n\n| A | B |\n|---|---|\n|[x][a]|2|\n\n[a]: https://example.org',
    '[a]: https://example.org/unused'
  ]) {
    const converted=prepareEditorMarkdown(md,'teacher');
    assert.deepEqual(semantic(converted),semantic(md));
    assert.equal(projectMarkdown(converted).text,projectMarkdown(md).text);
  }
  assert.throws(()=>prepareEditorMarkdown('![x][a]\n\n[a]: /api/assets/flower','student'),/STUDENT_IMAGE_FORBIDDEN/);
});
test('reference validation and conversion use the first definition consistently',()=>{
  const md='[x][a]\n\n[a]: https://example.org/first\n[a]: https://example.org/last';
  assert.match(prepareEditorMarkdown(md,'student'),/example.org\/first/);
  assert.doesNotMatch(prepareEditorMarkdown(md,'student'),/example.org\/last/);
  for(const role of ['teacher','student']) assert.throws(()=>prepareEditorMarkdown('[x][a]\n\n[a]: javascript:alert%281%29\n[a]: https://example.org',role),/UNSAFE_LINK/);
  assert.throws(()=>prepareEditorMarkdown('![x][a]\n\n[a]: https://example.org/tracker.png\n[a]: /api/assets/flower','teacher'),/PRIVATE_ASSET_REQUIRED/);
});

test('shared UTF-16 boundary corpus agrees on valid and invalid anchors',async()=>{
  const cases=JSON.parse(readFileSync(new URL('utf16-anchor-cases.json',import.meta.url),'utf8'));
  for(const c of cases) {
    if(c.valid) assert.equal((await makeAnchor(c.markdown,c.start,c.end)).exact,c.exact);
    else await assert.rejects(makeAnchor(c.markdown,c.start,c.end),/ANCHOR_RANGE/);
  }
});
