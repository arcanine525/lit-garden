import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { expect } from '@playwright/test';
import { migrationPool } from '../../infra/db/migrate.mjs';
import { keycloakAdmin, provisionIdentity } from '../../infra/keycloak/bootstrap.mjs';
import { projectMarkdown } from '../../prototypes/editor/src/markdown.js';
import { enter, key, origin, setPassword } from '../e2e/auth-fixture.mjs';
import { post, responseBody } from '../e2e/student-work-fixture.mjs';
import { fixedTime } from './capture.mjs';

export const assignmentTitle = 'Mùa xuân trong vườn';
export const essay = 'Buổi sớm, những giọt sương đọng trên lá. Hoa nở. Em dừng lại để nhìn màu xanh vừa thức dậy.';
export const note = 'Chi tiết này giúp người đọc hình dung buổi sáng. Em thử bổ sung một âm thanh.';
export const documentTitle = 'Hạt mầm và trang viết';
export const get = async (actor,path) => responseBody(await actor.page.request.get(path));
export const mutate = async (actor,path,data,code = 200) => responseBody(await post(actor.page,path,data),code);

export async function createFixture(browser) {
  const db = migrationPool();
  const kc = await keycloakAdmin();
  const usernames = [], contexts = [], subjects = [];
  let rubricId,definition;

  async function page() {
    const context = await browser.newContext({ baseURL:origin,locale:'vi-VN',timezoneId:'Asia/Ho_Chi_Minh',deviceScaleFactor:1,reducedMotion:'reduce' });
    contexts.push(context);
    const page = await context.newPage();
    await page.clock.setFixedTime(fixedTime);
    return page;
  }
  async function actor(role,name,username,changePassword = true) {
    const password = key();
    const updatedPassword = key();
    const record = await provisionIdentity(kc,db,{ username,name,password,role });
    usernames.push(record.subject);
    const session = { ...record,username,page:await page() };
    await enter(session.page,username,password);
    const assertSession = () => expect.poll(() => session.page.request.get('/api/me').then(response => response.status())).toBe(200);
    const completePasswordChange = async () => {
      await setPassword(session.page,updatedPassword);
      await assertSession();
    };
    if (changePassword) await completePasswordChange();
    return { ...session,completePasswordChange,async signInAgain() {
      await enter(session.page,username,updatedPassword);
      await assertSession();
    } };
  }
  async function rubrics(admin) {
    const context = { window:{} };
    runInNewContext(await readFile('docs/research/vuon-van-ca-nhan.pages.dev/source/rubrics.js','utf8'),context);
    for (const [index,item] of context.window.RUBRICS.entries()) {
      const id = randomUUID();
      const value = { criteria:item.criteria.map((criterion,i) => ({ id:'criterion_' + i,label:criterion.name,levels:criterion.levels
        .map((level,j) => ({ id:'level_' + j,score:String(level.score),description:level.text })) })) };
      await mutate(admin,'/api/rubrics',{ action:'create',id,label:item.name,definition:value },201);
      if (index === 0) { rubricId = id; definition = value; }
    }
  }
  async function fake(subject,action) {
    const response = await fetch(process.env.DRIVE_MOCK_URL + '/fake/control',{
      method:'POST',headers:{ Authorization:'Bearer ' + process.env.APP_DRIVE_FAKE_CLIENT_SECRET,'Content-Type':'application/json' },
      body:JSON.stringify({ action,sub:subject })
    });
    expect(response.status).toBe(200);
  }
  async function connect(teacher,subject) {
    subjects.push(subject);
    await teacher.page.goto('/drive');
    await teacher.page.getByRole('button',{ name:'Cấp quyền Drive' }).click();
    await teacher.page.getByLabel('Danh tính Drive thử').fill(subject);
    await teacher.page.getByRole('button',{ name:'Cho phép' }).click();
    await teacher.page.getByRole('button',{ name:'Chọn thư mục cha' }).click();
    await teacher.page.getByRole('button',{ name:'Dùng thư mục này' }).click();
    await expect(teacher.page.getByRole('status')).toContainText('Đã xác minh');
  }
  async function classroom(teacher,name,code,year = '2026–2027') {
    const room = await mutate(teacher,'/api/classes',{ action:'save_class',name,year },201);
    if (!code) return room;
    const digest = createHmac('sha256',process.env.APP_JOIN_CODE_SECRET).update(code).digest('hex');
    await db.query('UPDATE garden.classes SET join_code_digest=$1 WHERE id=$2',[digest,room.classId]);
    return { ...room,joinCode:code };
  }
  async function approve(teacher,student,room) {
    const { requests } = await get(teacher,'/api/classes');
    const request = requests.find(row => row.username === student.username && row.class_id === room.classId);
    await mutate(teacher,'/api/classes',{ action:'approve',requestId:request.id });
  }
  async function join(teacher,student,room) {
    await mutate(student,'/api/classes',{ action:'join',code:room.joinCode });
    await approve(teacher,student,room);
  }
  async function assignment(teacher,room,title,{ dueAt = null,reference = '',draft = false } = {}) {
    const id = randomUUID(), clientId = randomUUID(), api = `/api/assignments/${id}`;
    await mutate(teacher,'/api/assignments',{ id,classId:room.classId,rubricId,rubricRevision:1 },201);
    const { epoch } = await mutate(teacher,api,{ action:'acquire',clientId });
    const saved = await mutate(teacher,api,{ action:'save',key:randomUUID(),clientId,epoch,baseVersion:'0',
      draft:{ title,prompt:(draft ? `### ${title}\n\n` : '') + 'Hãy viết một đoạn văn tả khu vườn vào một buổi sáng mùa xuân.',material:'',reference,
        rubricId,rubricRevision:1,scale:'2',dueAt }
    });
    if (draft) await mutate(teacher,api,{ action:'release',clientId,epoch });
    else await mutate(teacher,api,{ action:'publish',key:randomUUID(),clientId,epoch,baseVersion:saved.draftVersion,hash:saved.hash });
    return { id,api,url:`/assignments/${id}`,draft:api + '/draft',write:`/assignments/${id}/write` };
  }
  async function change(teacher,resource,action,data = {}) {
    return mutate(teacher,resource.api,{ action,expectedVersion:(await get(teacher,resource.api)).version,...data });
  }
  async function submit(student,assignment,bodies) {
    const clientId = randomUUID();
    const grant = await mutate(student,assignment.draft,{ action:'acquire',clientId });
    const versions = [];
    for (const markdown of bodies) {
      versions.push(await mutate(student,assignment.api + '/submissions',{ action:'submit',key:randomUUID(),clientId,epoch:grant.epoch,
        baseVersion:grant.version,draft:{ markdown,explanation:'' }
      }));
    }
    return versions;
  }
  async function score(teacher,submission,{ partial = false, publish = false, text = null } = {}) {
    const id = submission.id, comment = randomUUID(), clientId = randomUUID();
    const draft = `/api/submissions/${id}/review`;
    const { epoch } = await mutate(teacher,draft,{ action:'acquire',clientId });
    const { submissionSha256 } = await get(teacher,`/api/submissions/${id}/verify`);
    const scores = definition.criteria.slice(0,partial ? 2 : 5).map((criterion,index) => {
      const level = criterion.levels[publish && text === essay && index === 0 ? 1 : 0];
      return { criterionId:criterion.id,levelId:level.id,value:Number(level.score).toFixed(2) };
    });
    const comments = [];
    if (text) {
      const projected = projectMarkdown(text).text;
      const exact = 'những giọt sương đọng trên lá';
      const start = projected.indexOf(exact), end = start + exact.length;
      comments.push({ id:comment,kind:'range',color:'yellow',body:note,anchor:{ start,end,exact,
        prefix:projected.slice(Math.max(0,start-32),start),suffix:projected.slice(end,end+32),
        projectionSha256:createHash('sha256').update(projected).digest('hex') } });
    }
    const overallId = randomUUID();
    comments.push({ id:overallId,kind:'overall',body:'Bài có hình ảnh cụ thể và cách quan sát riêng.' });
    const saved = await mutate(teacher,draft,{ action:'save',key:randomUUID(),clientId,epoch,baseVersion:'0',
      draft:{ scores,comments,overallCommentId:overallId }
    });
    if (publish) await mutate(teacher,`/api/submissions/${id}/publication`,{ key:randomUUID(),clientId,epoch,
      baseVersion:saved.version,draftHash:saved.hash,basePublication:null,submissionSha256 });
    await mutate(teacher,draft,{ action:'release',clientId,epoch });
    return { thread:`/api/submissions/${id}/comments/${comment}/messages` };
  }
  async function completeScores(teacher,submission) {
    const path = `/api/submissions/${submission.id}/review`, clientId = randomUUID();
    const { epoch,version } = await mutate(teacher,path,{ action:'acquire',clientId });
    const { draft } = await get(teacher,path);
    const scores = definition.criteria.map(criterion => {
      const level = criterion.levels[0];
      return { criterionId:criterion.id,levelId:level.id,value:Number(level.score).toFixed(2) };
    });
    await mutate(teacher,path,{ action:'save',key:randomUUID(),clientId,epoch,baseVersion:version,draft:{ ...draft,scores } });
    await mutate(teacher,path,{ action:'release',clientId,epoch });
  }
  async function library(teacher,student,room) {
    const id = randomUUID(), api = `/api/library/${id}`;
    await mutate(teacher,'/api/library',{ id },201);
    await responseBody(await teacher.page.request.put(api,{ headers:{ Origin:origin },multipart:{
      key:randomUUID(),version:'0',title:documentTitle,format:'markdown',sourceLabel:'Cô An · Lớp 10A1',
      markdown:'## Hạt mầm và trang viết\n\nMột trang viết bắt đầu bằng một điều nhỏ ta đã nhìn thấy.\n\n> Hãy kể về một chi tiết em quan sát được hôm nay.'
    } }));
    await mutate(teacher,api,{ action:'share',classIds:[room.classId] });
    await mutate(teacher,api,{ action:'feature',classId:room.classId,slot:1 });
    await mutate(student,api,{ action:'favorite',favorite:true });
    return { id,url:`/library/${id}` };
  }
  return { db,actor,page,rubrics,connect,fake,classroom,approve,join,assignment,change,submit,score,completeScores,library,
    async close() {
      try {
        for (const context of contexts) await context.close();
        for (const subject of usernames) await kc('/users/' + subject,'DELETE');
        for (const subject of subjects) await fake(subject,'reset');
      } finally { await db.end(); }
    }
  };
}
