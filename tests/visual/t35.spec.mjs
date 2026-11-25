import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { writeSource } from '../e2e/student-work-fixture.mjs';
import { fixedTime, prepareCaptures } from './capture.mjs';
import { assignmentTitle, createFixture, documentTitle, essay, get, mutate, note } from './fixtures.mjs';

const rubricLabel = 'Đoạn nghị luận xã hội';
const dueAt = '2026-11-27T10:00:00.000Z';

test('T35 captures every approved scene from running application routes', async ({ browser }) => {
  const evidence = await prepareCaptures(browser);
  const fx = await createFixture(browser);
  const { capture,check } = evidence;
  try {
    const login = await fx.page();
    await login.goto('/');
    await expect(login.getByRole('heading',{ name:'Vào khu vườn của mình' })).toBeVisible();
    await capture('login',login,'Keycloak login with empty username and password');
    const binh = await fx.actor('student','Bình','binh',false);
    await expect(binh.page.getByRole('heading',{ name:'Đổi mật khẩu',exact:true })).toBeVisible();
    await capture('password',binh.page,'Bình, first login and mandatory password update');
    await check('Password gate has no app navigation',async () => {
      await expect(binh.page.locator('nav, a[href]')).toHaveCount(0);
      expect((await binh.page.request.get('/api/me')).status()).toBe(401);
    });
    await binh.completePasswordChange();
    const cleanBinh = binh;
    const an = await fx.actor('student','An','an_');
    const admin = await fx.actor('admin','Quản trị viên','t35_quan_tri');
    const a = await fx.actor('teacher','Cô Nguyễn An','nguyen_an');
    const b = await fx.actor('teacher','Cô Trần Mai','tran_mai');
    await fx.rubrics(admin);
    await fx.connect(a,'t35_drive_an');
    const roomA = await fx.classroom(a,'10A1','A11A20262027');
    const roomB = await fx.classroom(b,'10B1');
    const archived = await fx.classroom(a,'10A2',undefined,'2025–2026');
    await mutate(a,'/api/classes',{ action:'archive_class',classId:archived.classId });
    await fx.join(a,an,roomA);

    await mutate(admin,'/api/admin/accounts',{ kind:'suspend_teacher',key:randomUUID(),userId:b.id });
    const identityRows = (await get(admin,'/api/admin/accounts')).accounts;
    expect(identityRows.find(row => row.id === a.id)).toMatchObject({
      username:'nguyen_an',display_name:'Cô Nguyễn An',role:'teacher',status:'active',drive_state:'ready'
    });
    expect(identityRows.find(row => row.id === b.id)).toMatchObject({
      username:'tran_mai',display_name:'Cô Trần Mai',role:'teacher',status:'suspended',drive_state:null
    });
    await admin.page.goto('/admin/accounts');
    const teachers = admin.page.getByRole('region',{ name:'Giáo viên',exact:true });
    await expect(teachers.getByText('Cô Nguyễn An',{ exact:true })).toBeVisible();
    await expect(teachers.getByText(/Đã khóa/)).toBeVisible();
    await capture('admin-teachers',admin.page,'Cô Nguyễn An active with Drive ready, Cô Trần Mai suspended without a Drive connection');
    await mutate(admin,'/api/admin/accounts',{ kind:'resume_teacher',key:randomUUID(),userId:b.id });
    await b.signInAgain();
    await fx.connect(b,'t35_drive_mai');
    await fx.db.query("UPDATE garden.users SET display_name=CASE WHEN id=$1 THEN 'Cô An' ELSE 'Cô Mai' END WHERE id IN ($1,$2)",[a.id,b.id]);

    async function catalog(actor,id) {
      await actor.page.goto('/rubrics');
      await actor.page.getByRole('button',{ name:rubricLabel,exact:true }).click();
      await expect(actor.page.getByRole('heading',{ name:rubricLabel,exact:true })).toBeVisible();
      await capture(id,actor.page,'Source rubric 0, two-point scale, all five criteria closed');
    }
    await catalog(admin,'admin-rubrics');
    await catalog(a,'teacher-rubrics');
    await catalog(cleanBinh,'student-rubrics');
    await a.page.goto('/classes');
    await expect(a.page.getByRole('region',{ name:'10A1',exact:true })).toBeVisible();
    await expect(a.page.getByRole('region',{ name:'Đã lưu trữ',exact:true }).getByRole('heading',{ name:'10A2' })).toBeVisible();
    await capture('classes',a.page,'10A1 active and 10A2 archived in the same view');

    const main = await fx.assignment(a,roomA,assignmentTitle,{ dueAt,reference:'Tham chiếu về khu vườn.' });
    const rainA = await fx.assignment(a,roomA,'Giọt mưa đầu mùa');
    await fx.change(a,rainA,'close');
    await cleanBinh.page.goto('/classes');
    await cleanBinh.page.getByLabel('Mã lớp').fill(roomA.joinCode);
    await cleanBinh.page.getByRole('button',{ name:'Gửi yêu cầu' }).click();
    await expect(cleanBinh.page.getByText('10A1 · Cô An · Đang chờ duyệt',{ exact:true })).toBeVisible();
    const requests = (await get(a,'/api/classes')).requests;
    expect(requests.find(item => item.username === cleanBinh.username)).toMatchObject({ class_id:roomA.classId });
    await capture('join-class',cleanBinh.page,'Bình chờ duyệt 10A1 qua mã A11A20262027. Baseline hiển thị VV10A1, ngoại lệ fixture đã duyệt');
    await fx.join(b,cleanBinh,roomB);
    const rainB = await fx.assignment(b,roomB,'Giọt mưa đầu mùa');
    await fx.change(b,rainB,'close');
    await a.page.goto('/classes');
    await a.page.getByRole('region',{ name:'10A1',exact:true }).getByRole('button',{ name:'Mở lớp' }).click();
    await expect(a.page.getByRole('button',{ name:'Duyệt Bình',exact:true })).toBeVisible();
    await expect(a.page.getByRole('region',{ name:'Thành viên',exact:true }).getByText('an_ · Đang tham gia',{ exact:true })).toBeVisible();
    await capture('class-members',a.page,'An is active in 10A1 and Bình awaits approval');
    const importCsv = a.page.getByRole('button',{ name:'Nhập CSV',exact:true });
    await importCsv.click();
    const csvDialog = a.page.getByRole('dialog');
    await csvDialog.getByRole('textbox',{ name:'Nội dung CSV' }).fill(
      'ho_ten,ten_dang_nhap,lop,nam_hoc\nLinh,linh,10A1,2026–2027\nBình,binh,10A1,2026–2027');
    await csvDialog.getByRole('button',{ name:'Xem trước',exact:true }).click();
    await expect(csvDialog.getByRole('heading',{ name:'Xem trước danh sách CSV' })).toBeVisible();
    await expect(csvDialog.getByRole('listitem').filter({ hasText:'linh' })).toContainText('Hợp lệ');
    await expect(csvDialog.getByRole('listitem').filter({ hasText:'binh' })).toContainText('Tài khoản đã tồn tại');
    await capture('class-import',a.page,'Dialog preview with Linh ready and Bình existing');
    await a.page.keyboard.press('Escape');
    await expect(importCsv).toBeFocused();

    await a.page.goto('/assignments');
    await expect(a.page.getByRole('link',{ name:assignmentTitle,exact:true })).toBeVisible();
    await expect(a.page.getByRole('link',{ name:'+ Giao bài mới',exact:true })).toHaveAttribute('href','/assignments?new=1');
    await capture('teacher-assignments',a.page,'Main assignment open, Giọt mưa đầu mùa closed');
    const draft = await fx.assignment(a,roomA,assignmentTitle,{ draft:true });
    await a.page.goto(draft.url);
    await expect(a.page.getByLabel('Thang điểm của bài', { exact:true })).toHaveValue('2.00');
    await expect(a.page.getByRole('button',{ name:'Lưu nháp',exact:true })).toBeEnabled();
    await expect(a.page.getByRole('button',{ name:'Giao bài',exact:true })).toBeEnabled();
    await expect(a.page.getByRole('region',{ name:'Đề bài',exact:true }).locator('.garden-editor-text')).toBeVisible();
    await capture('assignment-author',a.page,'10A1, assignment draft, source rubric and scale 2');
    await check('Worksheet formatting is exported and can return to the rich editor',async () => {
      const editor = a.page.getByRole('region',{ name:'Đề bài',exact:true });
      const text = editor.locator('.garden-editor-text p').first();
      await text.click();
      await text.evaluate(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
      await editor.getByRole('button',{ name:'Đậm',exact:true }).click();
      await expect(text.locator('strong')).toBeVisible();
      await editor.getByRole('button',{ name:'Mã Markdown',exact:true }).click();
      await expect(editor.getByRole('textbox',{ name:'Mã Markdown' })).toHaveValue(/\*\*Hãy viết một đoạn văn/);
      await editor.getByRole('button',{ name:'Trực quan',exact:true }).click();
      await expect(text.locator('strong')).toBeVisible();
    });
    await check('Assignment reference retains Markdown when switching with the keyboard',async () => {
      const page = a.page;
      const source = page.getByRole('textbox',{ name:'Tham chiếu (không bắt buộc)',exact:true });
      await source.fill('**Hình ảnh** trong vườn.');
      const format = page.locator('summary[aria-label="Định dạng tham chiếu"]');
      await format.press('Enter');
      const rich = page.locator('.assignment-supplement .garden-editor:visible');
      await expect(rich.locator('.garden-editor-text strong')).toHaveText('Hình ảnh');
      await format.press('Enter');
      await expect(source).toHaveValue('**Hình ảnh** trong vườn.');
    });

    const [v1,v2] = await fx.submit(an,main,[essay,essay]);
    const { thread } = await fx.score(a,v1,{ publish:true,text:essay });
    const discussion = await get(an,thread);
    await mutate(an,thread,{ action:'send',key:randomUUID(),publicationId:discussion.publicationId,
      commentDigest:discussion.commentDigest,body:'Em sẽ thử thêm tiếng chim ở bản sau.' });
    await fx.completeScores(a,v1);
    const library = await fx.library(a,an,roomA);
    await a.page.goto('/');
    await expect(a.page.getByRole('heading',{ name:/Nâng niu ý tưởng/ })).toBeVisible();
    await expect(a.page.getByRole('link',{ name:'Xem bài chờ chấm · 1',exact:true })).toHaveAttribute('href','/reviews?waiting=1');
    await expect(a.page.getByRole('link',{ name:'+ Giao một bài mới',exact:true })).toHaveAttribute('href','/assignments?new=1');
    await capture('teacher-home',a.page,'Cô An with 10A1, one open assignment and latest submission awaiting review');
    await a.page.goto('/reviews');
    await expect(a.page.getByText(/An · 10A1 · Lần nộp 2/)).toBeVisible();
    await capture('teacher-grading',a.page,'An v2 awaits a return; v1 was returned');

    await fx.score(a,v2,{ partial:true,text:essay });
    await a.page.goto(`/reviews/${v2.id}`);
    await expect(a.page.getByRole('button',{ name:'Trả bài',exact:true })).toBeDisabled();
    await expect(a.page.getByRole('region',{ name:'Điểm theo rubric' }).getByRole('combobox')).toHaveCount(5);
    await expect(a.page.getByText(/2\/5 tiêu chí đã chấm · 1,00 \/ 2,00 điểm/)).toBeVisible();
    await expect(a.page.getByText(note,{ exact:true })).toBeVisible();
    await capture('review-draft',a.page,'An v2 with one anchored comment and 2/5 scored criteria');
    await check('Review range selection opens the focused annotation field by keyboard',async () => {
      const page = a.page;
      const selection = page.getByText('Chọn đoạn bằng bàn phím',{ exact:true });
      await selection.focus();
      await selection.press('Enter');
      const excerpts = page.getByRole('combobox',{ name:'Đoạn trong bài',exact:true });
      await excerpts.focus();
      await excerpts.press('b');
      await expect(excerpts).not.toHaveValue('');
      await page.getByRole('button',{ name:'Thêm nhận xét',exact:true }).press('Enter');
      await expect(page.getByRole('textbox',{ name:'Nhận xét cho đoạn chọn',exact:true })).toBeFocused();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button',{ name:'Hủy',exact:true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button',{ name:'Thêm nhận xét',exact:true })).toBeFocused();
    });
    await a.page.goto(`/reviews/${v1.id}`);
    await expect(a.page.getByRole('button',{ name:'Trả lại bài',exact:true })).toBeEnabled();
    await expect(a.page.getByRole('region',{ name:'Điểm theo rubric' }).getByRole('combobox')).toHaveCount(5);
    await expect(a.page.getByText(/5\/5 tiêu chí đã chấm · 2,00 \/ 2,00 điểm/)).toBeVisible();
    await a.page.getByRole('region',{ name:'Nhận xét theo đoạn' }).getByText('Hội thoại',{ exact:true }).click();
    await expect(a.page.getByText('Em sẽ thử thêm tiếng chim ở bản sau.',{ exact:true })).toBeVisible();
    await capture('review-republish',a.page,'An v1 with current result, full rubric and locked replied comment');
    await an.page.goto(`/results/${v1.id}`);
    await expect(an.page.getByText('1,75 / 2,00',{ exact:true })).toBeVisible();
    await an.page.getByRole('region',{ name:'Nhận xét theo đoạn' }).getByText('Hội thoại',{ exact:true }).click();
    await expect(an.page.getByText('Em sẽ thử thêm tiếng chim ở bản sau.',{ exact:true })).toBeVisible();
    await capture('student-result',an.page,'Current result of An v1 with the anchored comment and its reply');
    await fx.change(a,main,'close');
    await fx.approve(a,cleanBinh,roomA);
    await a.page.goto(main.url);
    const open = a.page.getByRole('button',{ name:'Mở lại bài',exact:true });
    await open.focus();
    await open.press('Enter');
    const dialog = a.page.getByRole('dialog',{ name:'Mở lại bài này?' });
    await expect(dialog).toBeVisible();
    await capture('assignment-reopen',a.page,'An already has a recipient, Bình approved while closed');
    await check('Reopen dialog traps keyboard focus and returns focus on Escape',async () => {
      await expect(dialog.getByRole('button',{ name:'Quay lại',exact:true })).toBeFocused();
      await a.page.keyboard.press('Tab');
      await expect(dialog.getByRole('button',{ name:'Mở lại và giao bổ sung' })).toBeFocused();
      await a.page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(open).toBeFocused();
    });
    if (!(await dialog.isVisible())) await open.click();
    await dialog.getByRole('button',{ name:'Mở lại và giao bổ sung' }).click();
    await expect(a.page.getByText('Đã mở lại bài.',{ exact:true })).toBeVisible();

    await cleanBinh.page.goto('/assignments');
    await expect(cleanBinh.page.getByRole('link',{ name:assignmentTitle,exact:true })).toBeVisible();
    await capture('student-assignments',cleanBinh.page,'Bình has main open in 10A1 and an unsubmitted closed assignment in 10B1');
    await cleanBinh.page.goto(main.write);
    await cleanBinh.page.evaluate(({student,id,since}) => {
      sessionStorage.setItem(`garden:focus-clock:${student}:${id}`,JSON.stringify({ elapsed:720000,since,goal:25,open:true,started:true }));
    },{ student:cleanBinh.id,id:main.id,since:fixedTime.getTime() });
    await cleanBinh.page.reload();
    await expect(cleanBinh.page.getByRole('button',{ name:'Nộp bài',exact:true })).toBeEnabled();
    await expect(cleanBinh.page.getByRole('heading',{ name:assignmentTitle,level:1 })).toBeVisible();
    await expect(cleanBinh.page.getByRole('timer',{ name:'Thời gian tập trung' })).toHaveText('00:12:00');
    await expect(cleanBinh.page.getByRole('button',{ name:'Tạm dừng',exact:true })).toBeVisible();
    await writeSource(cleanBinh.page,`# ${assignmentTitle}\n\n${essay}`);
    await cleanBinh.page.getByLabel('Giải thích (tùy chọn)').fill('Em thêm một chi tiết về giọt sương.');
    await expect(cleanBinh.page.getByText('Đã đồng bộ nháp lên Drive.',{ exact:true })).toBeVisible();
    await capture('student-editor',cleanBinh.page,'Bình, rich Markdown synced, fixed clock at 12:00 of 25 minutes');
    const editor = cleanBinh.page.locator('.garden-editor');
    await editor.getByRole('button',{ name:'Mã Markdown',exact:true }).click();
    await cleanBinh.page.context().setOffline(true);
    await editor.getByRole('textbox',{ name:'Mã Markdown' }).fill(`# ${assignmentTitle}\n\n**Hoa nở.** ${essay}`);
    await expect(cleanBinh.page.getByText(/Nháp chưa đồng bộ lên Drive/)).toBeVisible();
    await capture('student-source',cleanBinh.page,'Bình editing source offline with recoverable device draft');
    await cleanBinh.page.context().setOffline(false);

    const bird = await fx.assignment(a,roomA,'Một tiếng chim');
    const road = await fx.assignment(b,roomB,'Đường về nhà');
    await fx.submit(cleanBinh,bird,['Em nghe tiếng chim.']);
    const [returned] = await fx.submit(cleanBinh,road,['Đường về nhà qua khu vườn.']);
    await fx.score(b,returned,{ publish:true });
    await mutate(cleanBinh,`/api/library/${library.id}`,{ action:'favorite',favorite:true });
    await cleanBinh.page.goto('/');
    await expect(cleanBinh.page.getByRole('link',{ name:`Mở tài liệu · ${documentTitle}`,exact:true })).toBeVisible();
    await expect(cleanBinh.page.getByRole('link',{ name:'Thăm vườn',exact:true })).toHaveAttribute('href','/garden');
    await capture('student-home',cleanBinh.page,'Four assignments across Cô An and Cô Mai, plus featured library document');
    await cleanBinh.page.goto('/garden');
    await expect(cleanBinh.page.getByRole('list',{ name:'Các bài theo bộ lọc' }).getByRole('listitem')).toHaveCount(4);
    await capture('garden',cleanBinh.page,'One Mầm, one Hoa, one Quả and one closed unsubmitted across 10A1 and 10B1');
    await check('Garden filters work using keyboard and selected results use the same counts',async () => {
      const page = cleanBinh.page;
      const flower = page.getByRole('region',{ name:'Hoa',exact:true }).getByRole('button');
      await flower.focus();
      await flower.press('Enter');
      await expect(flower).toHaveAttribute('aria-pressed','true');
      const list = page.getByRole('list',{ name:'Các bài theo bộ lọc' });
      await expect(list.getByRole('listitem')).toHaveCount(1);
      await page.getByRole('button',{ name:'Xem tất cả ↗',exact:true }).press('Enter');
      await expect(list.getByRole('listitem')).toHaveCount(4);
      await page.getByText('Lọc bài viết theo lớp và giáo viên',{ exact:true }).press('Enter');
      const filter = page.getByRole('combobox',{ name:'Giáo viên',exact:true });
      await filter.focus();
      await page.keyboard.press('c');
      await expect(filter).not.toHaveValue('');
      await expect(page).toHaveURL(/teacher=/);
      await expect(filter).toBeFocused();
      await expect(page.getByRole('list',{ name:'Các bài theo bộ lọc' }).getByRole('listitem')).toHaveCount(2);
      const classFilter = page.getByRole('combobox',{ name:'Lớp',exact:true });
      await classFilter.focus();
      await classFilter.press('1');
      await expect(page).toHaveURL(/class=/);
      await expect(classFilter).toBeFocused();
    });

    await a.page.goto('/library');
    await a.page.getByText('Sửa chia sẻ',{ exact:true }).click();
    const feature = a.page.getByRole('group',{ name:'Tài liệu nổi bật' });
    await expect(feature.getByRole('combobox',{ name:'10A1',exact:true })).toHaveValue('1');
    await capture('teacher-library',a.page,'Hạt mầm và trang viết shared and featured in 10A1 on the library list');
    await cleanBinh.page.goto('/library');
    await expect(cleanBinh.page.getByRole('link',{ name:documentTitle,exact:true })).toBeVisible();
    await capture('student-library',cleanBinh.page,'One shared and favorited library document');
    await cleanBinh.page.goto(library.url);
    await expect(cleanBinh.page.getByRole('link',{ name:'Tải tài liệu',exact:true })).toBeVisible();
    await capture('library-reader',cleanBinh.page,'Markdown document with heading, opening sentence, quotation and download');

    await fx.change(a,main,'extend_deadline',{ key:randomUUID(),dueAt:'2026-11-28T10:00:00.000Z' });
    await fx.db.query(`UPDATE garden.notifications
      SET created_at=CASE event_kind WHEN 'assigned' THEN '2026-11-20T02:00Z'::timestamptz
        WHEN 'returned' THEN '2026-11-20T01:40Z'::timestamptz ELSE '2026-11-19T09:10Z'::timestamptz END,
        read_at=CASE WHEN event_kind='deadline_extended' THEN '2026-11-19T09:20Z'::timestamptz END
      WHERE user_id=$1 AND ((target_id=$2 AND event_kind IN ('assigned','deadline_extended')) OR (target_id=$3 AND event_kind='returned'))`,
    [cleanBinh.id,main.id,returned.id]);
    await fx.db.query('DELETE FROM garden.notifications WHERE user_id=$1 AND target_id NOT IN ($2,$3)',[cleanBinh.id,main.id,returned.id]);
    await cleanBinh.page.goto('/notifications');
    await expect(cleanBinh.page.getByRole('status').filter({ hasText:'Chưa đọc' })).toHaveCount(2);
    await capture('notifications',cleanBinh.page,'Two unread notices and one read extension at fixed times');
    await check('Unread status changes with keyboard and keeps focus',async () => {
      const row = cleanBinh.page.getByRole('listitem').filter({ has:cleanBinh.page.getByRole('heading',{ name:'Bài mới',exact:true }) });
      const button = row.getByRole('button',{ name:'Chưa đọc · Đánh dấu đã đọc',exact:true });
      await button.focus();
      await button.press('Enter');
      await expect(row.getByRole('status')).toHaveText('Đã đọc');
      await expect(row.getByRole('status')).toBeFocused();
    });

    await admin.page.goto('/admin/accounts?role=student');
    const search = admin.page.getByRole('searchbox');
    await search.fill(cleanBinh.username);
    await search.press('Enter');
    await expect(admin.page.getByRole('heading',{ name:'Tài khoản đã tìm thấy' })).toBeVisible();
    const reset = admin.page.getByRole('listitem').filter({ hasText:cleanBinh.username });
    await reset.getByRole('button',{ name:'Đặt lại mật khẩu' }).click();
    const resetDialog = admin.page.getByRole('dialog',{ name:'Đặt lại mật khẩu của Bình?' });
    await expect(resetDialog.getByRole('button',{ name:'Xác nhận đặt lại' })).toBeDisabled();
    await resetDialog.getByRole('checkbox').check();
    await expect(resetDialog.getByRole('button',{ name:'Xác nhận đặt lại' })).toBeEnabled();
    await capture('admin-reset',admin.page,'Bình belongs to two classes; dialog confirmation after administrative identity verification');
    await fx.fake('t35_drive_an','revoke');
    await a.page.request.get(main.api);
    await a.page.goto('/drive');
    await expect(a.page.getByRole('button',{ name:'Kết nối lại Drive' })).toBeVisible();
    await capture('drive',a.page,'Cô An and same-account reconnect after revocation in fake Drive');

    await check('No document overflow on either side of the four breakpoints',async () => {
      const page = cleanBinh.page;
      await page.goto('/garden');
      for (const width of [1149,1151,899,901,759,761,599,601,390]) {
        await page.setViewportSize({ width,height:844 });
        const size = await page.evaluate(() => ({ width:innerWidth,scroll:document.documentElement.scrollWidth }));
        expect(size.scroll,`width ${width}`).toBe(size.width);
      }
    });
    await check('Fixed bottom navigation leaves the last garden action fully visible',async () => {
      const page = cleanBinh.page;
      await page.setViewportSize({ width:390,height:844 });
      await page.goto('/garden');
      const last = page.locator('main .progress-rows a').last();
      const bottomNav = page.locator('.app-bottom-nav');
      await expect(last).toBeVisible();
      await expect(bottomNav).toBeVisible();
      await last.focus();
      await page.evaluate(() => window.scrollTo(0,document.documentElement.scrollHeight));
      const control = await last.boundingBox();
      const nav = await bottomNav.boundingBox();
      expect(control).not.toBeNull();
      expect(nav).not.toBeNull();
      expect(control.y + control.height).toBeLessThanOrEqual(nav.y);
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    });
    await evidence.finish();
  } finally { await fx.close(); }
});
