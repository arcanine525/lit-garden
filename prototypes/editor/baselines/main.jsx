import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../../docs/research/vuon-van-ca-nhan.pages.dev/source/fonts-local.css';
import '../../../docs/research/vuon-van-ca-nhan.pages.dev/source/rubrics.js';
import book from '../../../docs/research/vuon-van-ca-nhan.pages.dev/source/vuon-trong-trang-sach.webp';
import sprout from '../../../docs/research/vuon-van-ca-nhan.pages.dev/source/garden-sprout.webp';
import flower from '../../../docs/research/vuon-van-ca-nhan.pages.dev/source/garden-flower.webp';
import fruit from '../../../docs/research/vuon-van-ca-nhan.pages.dev/source/garden-fruit.webp';
import { scenes } from './catalog.js';
import { progressOf, studentAssignments } from './student-fixture.js';
import './style.css';

const scene = scenes.find(({ id }) => id === new URLSearchParams(location.search).get('scene'));
const teacher = scene?.role === 'teacher';
const assignment = 'Mùa xuân trong vườn';
const documentTitle = 'Hạt mầm và trang viết';
const essay = 'Buổi sớm, những giọt sương đọng trên lá. Hoa nở. Em dừng lại để nhìn màu xanh vừa thức dậy.';
const rubricRef = window.RUBRICS;
const roleName = { admin: 'Quản trị viên', teacher: 'Cô An', student: 'Học sinh' };

function Button({ children, kind, ...props }) {
  return <button className={kind === 'primary' ? 'primary' : ''} type="button" {...props}>{children}</button>;
}
function Panel({ title, children }) {
  return <section className="panel">{title && <h2>{title}</h2>}{children}</section>;
}
function Actions({ children }) {
  return <div className="actions">{children}</div>;
}
function Field({ label, value, type = 'text', area, choices, ...inputProps }) {
  return <label>{label}{choices ? <select defaultValue={value}>{choices.map(choice => <option key={choice}>{choice}</option>)}</select>
    : area ? <textarea defaultValue={value}/>
    : <input type={type} defaultValue={value} {...inputProps}/>}</label>;
}
function Tag({ children, tone = '' }) { return <span className={`tag ${tone}`}>{children}</span>; }
function Row({ title, detail, children }) {
  return <div className="row"><div><strong>{title}</strong>{detail && <small>{detail}</small>}</div><div className="row-actions">{children}</div></div>;
}
function Notice({ children }) { return <p className="notice" role="status">{children}</p>; }
function ReviewDialog({ title, children, action }) {
  const ref = React.useRef(null);
  React.useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} aria-label={title}><h2>{title}</h2>{children}<Actions>
    <Button onClick={() => ref.current.close()}>Quay lại</Button><Button kind="primary">{action}</Button>
  </Actions></dialog>;
}
function Rubrics({ admin = false }) {
  const [active, setActive] = React.useState(0);
  const rubric = rubricRef[active];
  return <>
    <div className="tabs" aria-label="Bộ rubric">{rubricRef.map((item, i) => <Button key={item.id} aria-pressed={i === active} onClick={() => setActive(i)}>{item.name}</Button>)}</div>
    <Panel title={rubric.name}>
      <Tag tone="blue">Thang chuẩn {rubric.max} điểm</Tag>
      {admin && <Actions><Button>Tạo phiên bản</Button><Button>Ngừng dùng mẫu</Button></Actions>}
      {rubric.criteria.map(criterion => <details key={criterion.name}><summary>{criterion.name}</summary><dl>
        {criterion.levels.map(level => <div key={level.score} className="level"><dt>{level.score} điểm</dt><dd>{level.text}</dd></div>)}
      </dl></details>)}
    </Panel>
  </>;
}
function SubmissionRows({ teacher = false }) {
  return <Panel title="Các bài viết">
    <Row title={assignment} detail={teacher ? 'An · 10A1 · Lần nộp 2' : '10A1 · Cô An · Hạn 27/11/2026'}><Tag tone={teacher ? 'pink' : ''}>{teacher ? 'Chờ chấm' : 'Đang mở'}</Tag><Button>{teacher ? 'Chấm bài' : 'Mở bài'}</Button></Row>
    <Row title={teacher ? assignment : "Giọt mưa đầu mùa"} detail={teacher ? 'An · 10A1 · Lần nộp 1' : '10B1 · Cô Mai'}><Tag tone="blue">{teacher ? 'Đã trả' : 'Đã đóng · chưa nộp'}</Tag><Button>Xem bài</Button></Row>
  </Panel>;
}
function Editor({ source = false, author = false }) {
  return <Panel title={author ? 'Đề bài' : 'Bài viết của em'}>
    <div className="toolbar" role="group" aria-label="Định dạng Markdown">
      {['Đậm', 'Nghiêng', 'Tiêu đề', 'Danh sách', 'Trích dẫn', 'Bảng', 'Liên kết', ...(author ? ['Ảnh'] : [])].map(name => <Button key={name}>{name}</Button>)}
      <Button aria-pressed={source}>Mã Markdown</Button>
    </div>
    {source ? <textarea className="editor-source" aria-label="Mã Markdown" defaultValue={`# ${assignment}\n\n**Hoa nở.** ${essay}`}/>
      : <div className="editor-paper" role="textbox" aria-label="Nội dung trực quan" contentEditable suppressContentEditableWarning><h3>{assignment}</h3><p>{author ? 'Hãy viết một đoạn văn tả khu vườn vào một buổi sáng mùa xuân.' : essay}</p></div>}
    <Notice>{source ? 'Mất kết nối. Nháp đang ở trên thiết bị này.' : 'Đã đồng bộ nháp lúc 09:41.'}</Notice>
    {!author && <Field label="Giải thích chỉnh sửa (không bắt buộc)" area value="Em thêm một chi tiết về giọt sương." />}
    <Actions>{!author && <Button>Tải nháp Markdown</Button>}<Button kind="primary">{author ? 'Giao bài' : 'Nộp bài'}</Button></Actions>
  </Panel>;
}
const scoreLabel = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2 });
function RubricGrades({ republish }) {
  const rubric = rubricRef[0];
  const [scores, setScores] = React.useState(() => rubric.criteria.map((criterion, index) =>
    !republish && index > 1 ? '' : String(criterion.levels[0].score)
  ));
  const graded = scores.filter(score => score !== '').length;
  const total = scores.reduce((sum, score) => sum + Number(score), 0);
  const complete = graded === rubric.criteria.length;
  return <>
    <section aria-label="Tiêu chí chấm">
      {rubric.criteria.map((criterion, index) => <label key={criterion.name}>{criterion.name}
        <select value={scores[index]} onChange={event => {
          const value = event.target.value;
          setScores(previous => previous.map((score, at) => at === index ? value : score));
        }}>
          <option value="">Chưa chấm</option>
          {criterion.levels.map(({ score }) =>
            <option key={score} value={score}>{scoreLabel.format(score)} điểm</option>
          )}
        </select>
      </label>)}
    </section>
    <Field label="Nhận xét chung (không bắt buộc)" area value="Bài có hình ảnh cụ thể và cách quan sát riêng."/>
    <Notice>{graded}/{rubric.criteria.length} tiêu chí đã chấm · {scoreLabel.format(total)} / {scoreLabel.format(rubric.max)} điểm.
      {' '}{complete ? 'Có thể trả bài.' : 'Chấm đủ tiêu chí để trả bài.'}</Notice>
    <p className="muted">{republish ? 'Nháp đã lưu. Học sinh vẫn thấy kết quả đã công bố.' : 'Nháp đã lưu. Học sinh sẽ thấy kết quả khi cô trả bài.'}</p>
    <Actions><Button kind="primary" disabled={!complete}>{republish ? 'Trả lại bài' : 'Trả bài'}</Button></Actions>
  </>;
}
function Review({ mode }) {
  const result = mode === 'student-result';
  const republish = mode === 'review-republish';
  return <div className="columns">
    <Panel title={assignment}>
      <p className="muted">An · Lớp 10A1 · Lần nộp {mode === 'review-draft' ? 2 : 1}</p>
      <p className="essay">Buổi sớm, <mark>những giọt sương đọng trên lá</mark>. Hoa nở. Em dừng lại để nhìn màu xanh vừa thức dậy.</p>
      <section className="comment" aria-label="Nhận xét theo đoạn">
        <blockquote>“những giọt sương đọng trên lá”</blockquote><p>Chi tiết này giúp người đọc hình dung buổi sáng. Em thử bổ sung một âm thanh.</p>
        {(result || republish) && <><p><strong>An</strong> · Em sẽ thử thêm tiếng chim ở bản sau.</p><Field label="Tin nhắn mới" area /><Button>Gửi phản hồi</Button></>}
        {republish && <small>Nhận xét đã có phản hồi và được khóa.</small>}
      </section>
      {!result && <Actions><Button>Tô màu đoạn chọn</Button><Button>Thêm nhận xét</Button><Button>Rà lỗi</Button></Actions>}
    </Panel>
    <Panel title={result ? 'Kết quả hiện hành' : 'Điểm theo rubric'}>
      <p>Đoạn nghị luận xã hội · Thang 2 điểm</p>
      {result ? <><p className="grade">1,75 / 2,00</p><p>Bài có hình ảnh cụ thể và cách quan sát riêng.</p><Button>Tải nhận xét Markdown</Button></>
        : <><RubricGrades republish={republish}/>
        {republish && <><h3>Lịch sử công bố</h3><Row title="Công bố lần 1" detail="20/11/2026 lúc 09:10"><Tag>Hiện hành</Tag></Row></>}</>}
    </Panel>
  </div>;
}
function Library({ mode }) {
  if (mode === 'library-reader') return <Panel title={documentTitle}><p className="muted">Cô An · Lớp 10A1 · Markdown</p><p className="essay">Một trang viết bắt đầu bằng một điều nhỏ ta đã nhìn thấy.</p><blockquote>Hãy kể về một chi tiết em quan sát được hôm nay.</blockquote><Button>Tải Markdown</Button></Panel>;
  return <Panel title="Tài liệu">
    <Actions>{teacher ? <Button kind="primary">Thêm tài liệu</Button> : <><Button aria-pressed="true">Tất cả</Button><Button>Yêu thích</Button></>}</Actions>
    <Row title={documentTitle} detail="Cô An · 10A1 · Markdown"><Button>Mở tài liệu</Button>{teacher ? <Button>Sửa chia sẻ</Button> : <Button aria-pressed="true">Đã yêu thích</Button>}</Row>
    {teacher && <><Field label="Lớp chia sẻ" value="10A1" choices={['Riêng tư', '10A1', '10A1 và 10A2']}/><label className="checkbox"><input type="checkbox" defaultChecked /> Nổi bật ở lớp 10A1</label><Button kind="primary">Lưu thay đổi</Button></>}
  </Panel>;
}
const stages = [
  { id: 'sprout', art: sprout, title: 'Mầm', detail: 'Đang viết' },
  { id: 'flower', art: flower, title: 'Hoa', detail: 'Chờ chấm' },
  { id: 'fruit', art: fruit, title: 'Quả', detail: 'Đã nhận xét' }
];
const stageDetails = Object.fromEntries(stages.map(stage => [stage.id, stage.detail]));
stageDetails.closed = 'Đã đóng · chưa nộp';

function StudentProgress({ home = false }) {
  const [teacherFilter, setTeacherFilter] = React.useState('');
  const [classFilter, setClassFilter] = React.useState('');
  const teachers = [...new Set(studentAssignments.map(item => item.teacher))];
  const byTeacher = studentAssignments.filter(item => !teacherFilter || item.teacher === teacherFilter);
  const classes = [...new Set(byTeacher.map(item => item.className))];
  const assignments = byTeacher.filter(item => !classFilter || item.className === classFilter);
  const counts = { sprout: 0, flower: 0, fruit: 0 };
  for (const item of assignments) {
    const stage = progressOf(item);
    if (stage !== 'closed') counts[stage]++;
  }
  const featured = assignments.some(item => item.className === '10A1');
  return <>
    <div className="filters">
      <label>Giáo viên<select value={teacherFilter} onChange={event => {
        const next = event.target.value;
        setTeacherFilter(next);
        if (!studentAssignments.some(item => item.className === classFilter && (!next || item.teacher === next))) setClassFilter('');
      }}>
        <option value="">Tất cả giáo viên</option>{teachers.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <label>Lớp<select value={classFilter} onChange={event => setClassFilter(event.target.value)}>
        <option value="">Tất cả các lớp</option>{classes.map(name => <option key={name}>{name}</option>)}
      </select></label>
    </div>
    <div className="garden" aria-label="Tiến độ bài viết">
      {stages.map(({ id, art, title, detail }) => <section key={id} className={home ? 'panel progress-summary' : 'garden-card'} aria-label={title}>
        {!home && <img src={art} alt=""/>}<div><h2>{title}</h2><p>{counts[id]} bài · {detail}</p></div>
      </section>)}
    </div>
    <Panel title="Các bài viết">
      <div role="list" aria-label="Các bài theo bộ lọc">
        {assignments.map(item => <div key={item.title} role="listitem">
          <Row title={item.title} detail={`${item.className} · ${item.teacher}`}>
            <Tag>{stageDetails[progressOf(item)]}</Tag><Button>{progressOf(item) === 'sprout' ? 'Mở bài' : 'Xem bài'}</Button>
          </Row>
        </div>)}
      </div>
    </Panel>
    {home && featured && <Panel title="Tài liệu nổi bật"><Row title={documentTitle} detail="Lớp 10A1 · Cô An"><Button>Mở tài liệu</Button></Row></Panel>}
  </>;
}
function Dashboard() {
  return <>
    <section className="hero"><div><h2>{teacher ? 'Chăm chút từng trang viết' : 'Mỗi bài viết là một hạt mầm'}</h2>
      <p>{teacher ? 'Lớp 10A1 có một bài viết đang chờ nhận xét.' : 'Theo dõi bài viết theo lớp và giáo viên.'}</p><Button kind="primary">{teacher ? 'Xem bài chờ chấm' : 'Mở khu vườn'}</Button></div><img src={book} alt="Khu vườn nhỏ trên trang sách"/></section>
    {teacher ? <><SubmissionRows teacher/><Panel title="Tài liệu nổi bật"><Row title={documentTitle} detail="Lớp 10A1 · Cô An"><Button>Mở tài liệu</Button></Row></Panel></> : <StudentProgress home/>}
  </>;
}
function Content() {
  switch (scene.id) {
    case 'admin-teachers': return <Panel title="Tài khoản giáo viên"><Actions><Button kind="primary">Cấp tài khoản giáo viên</Button></Actions><Row title="Cô Nguyễn An" detail="nguyen.an · Google Drive đã kết nối"><Tag>Hoạt động</Tag><Button>Khóa tài khoản</Button></Row><Row title="Cô Trần Mai" detail="tran.mai · Chưa kết nối Drive"><Tag tone="pink">Đã khóa</Tag><Button>Mở khóa</Button></Row></Panel>;
    case 'admin-reset': return <><Panel title="Tài khoản đã tìm thấy"><Row title="Bình" detail="binh · 10A1 và 10B1"><Button>Đặt lại mật khẩu</Button></Row></Panel><ReviewDialog title="Đặt lại mật khẩu của Bình?" action="Đặt lại mật khẩu"><p>Phiên đăng nhập cũ sẽ hết hiệu lực. Bình cần đổi mật khẩu tạm khi đăng nhập lại.</p></ReviewDialog></>;
    case 'admin-rubrics': return <Rubrics admin/>;
    case 'drive': return <Panel title="Drive của cô An"><Tag tone="pink">Mất quyền truy cập</Tag><p>Thư mục đã chọn <strong>Vườn Văn</strong></p><Notice>Kết nối lại bằng tài khoản Google đã liên kết để tiếp tục lưu bài.</Notice><Actions><Button kind="primary">Kết nối lại Google Drive</Button><Button disabled>Chọn thư mục cha</Button></Actions></Panel>;
    case 'teacher-home':
    case 'student-home': return <Dashboard/>;
    case 'classes': return <><Panel title="Lớp đang hoạt động"><Actions><Button kind="primary">Tạo lớp</Button></Actions><Row title="10A1" detail="Năm học 2026–2027 · 1 thành viên"><Button>Mở lớp</Button></Row></Panel><Panel title="Đã lưu trữ"><Row title="10A2" detail="Năm học 2025–2026"><Button>Khôi phục lớp</Button></Row></Panel></>;
    case 'class-members':
    case 'class-import': return <>
      <Panel title="Thành viên"><Actions><Button>Cấp tài khoản</Button><Button>Nhập CSV</Button></Actions><Row title="An" detail="an · Đang tham gia"><Button>Đưa ra khỏi lớp</Button></Row></Panel>
      <Panel title="Yêu cầu tham gia"><Row title="Bình" detail="binh · Mã lớp VV10A1"><Button>Duyệt Bình</Button><Button>Từ chối</Button></Row></Panel>
      {scene.id === 'class-import' && <ReviewDialog title="Xem trước danh sách CSV" action="Cấp 1 tài khoản"><Row title="Linh" detail="linh"><Tag>Hợp lệ</Tag></Row><Row title="Bình" detail="binh"><Tag tone="pink">Tài khoản đã tồn tại</Tag></Row><p>Bình có thể dùng tài khoản hiện có để gửi yêu cầu tham gia lớp.</p></ReviewDialog>}
    </>;
    case 'join-class': return <Panel title="Nhập mã lớp"><Field label="Mã lớp" value="VV10A1"/><Button disabled>Đã gửi yêu cầu</Button><Notice>Yêu cầu vào lớp 10A1 đang chờ cô An duyệt.</Notice></Panel>;
    case 'teacher-assignments': return <><Actions><Button kind="primary">Giao bài mới</Button></Actions><Panel title="Danh sách bài giao"><Row title={assignment} detail="10A1 · Hạn 27/11/2026 lúc 17:00"><Tag>Đang mở</Tag><Button>Quản lý bài</Button></Row><Row title="Giọt mưa đầu mùa" detail="10A1 · Chưa công khai tham chiếu"><Tag tone="blue">Đã đóng</Tag><Button>Mở lại</Button></Row></Panel></>;
    case 'assignment-author': return <><Panel title="Thông tin bài giao"><div className="filters"><Field label="Tên bài" value={assignment}/><Field label="Lớp" choices={['10A1']}/></div><div className="filters"><Field label="Rubric" choices={['Đoạn nghị luận xã hội']}/><Field label="Thang điểm của bài" type="number" value={2} min={0.25} max={100} step={0.25} required/></div><Field label="Hạn nộp (không bắt buộc)" type="datetime-local"/><Field label="Tham chiếu (không bắt buộc)" area/></Panel><Editor author/></>;
    case 'assignment-reopen': return <><Panel title="Lớp 10A1"><Tag tone="blue">Đã đóng</Tag><p>Tham chiếu chưa công khai. Hạn 27/11/2026 lúc 17:00.</p><Button>Mở lại bài</Button></Panel><ReviewDialog title="Mở lại bài này?" action="Mở lại và giao bổ sung"><p>Bài sẽ được giao bổ sung cho học sinh đang thuộc lớp và chưa nhận bài này. Mỗi em sẽ nhận một thông báo bài mới.</p><p>Hạn nộp và lịch sử các lần nộp được giữ nguyên.</p></ReviewDialog></>;
    case 'teacher-rubrics':
    case 'student-rubrics': return <Rubrics/>;
    case 'teacher-grading': return <><Actions><Button>Tải bảng điểm CSV</Button></Actions><SubmissionRows teacher/></>;
    case 'review-draft':
    case 'review-republish':
    case 'student-result': return <Review mode={scene.id}/>;
    case 'student-assignments': return <SubmissionRows/>;
    case 'student-editor':
    case 'student-source': return <div className="columns"><Editor source={scene.id === 'student-source'}/><div><Panel title="Đề bài"><p>Hãy viết một đoạn văn tả khu vườn vào một buổi sáng mùa xuân.</p><Tag tone="blue">Hạn 27/11/2026</Tag></Panel><Panel title="Đồng hồ tập trung"><p className="clock">12:00 <small>/ 25 phút</small></p><Actions><Button>Tạm dừng</Button><Button>Đặt lại</Button></Actions></Panel></div></div>;
    case 'garden': return <StudentProgress/>;
    case 'teacher-library':
    case 'student-library':
    case 'library-reader': return <Library mode={scene.id}/>;
    case 'notifications': return <Panel title="Hộp thư của em"><Row title="Bài mới: Mùa xuân trong vườn" detail="10A1 · Cô An · 20/11 lúc 09:00"><Tag>Chưa đọc</Tag><Button>Mở bài</Button></Row><Row title="Cô An đã trả bài" detail="10A1 · 20/11 lúc 08:40"><Tag>Chưa đọc</Tag><Button>Xem kết quả</Button></Row><Row title="Hạn nộp đã được gia hạn" detail="10B1 · Cô Mai · 19/11 lúc 16:10"><Tag tone="blue">Đã đọc</Tag><Button>Xem hạn mới</Button></Row></Panel>;
  }
}
function Login() {
  return <main className="login"><div className="login-art"><img src={book} alt="Khu vườn nhỏ trên trang sách"/><p>Một khu vườn nhỏ<br/>nhiều trang viết đang chờ.</p></div>
    <div className="login-content"><p className="wordmark">Vườn Văn</p><h1>{scene.title}</h1><form onSubmit={event => event.preventDefault()}><Field label="Tên đăng nhập"/><Field label="Mật khẩu" type="password"/><button type="submit" className="primary">Đăng nhập</button></form><p className="muted">Tài khoản do giáo viên hoặc quản trị viên cấp.</p></div>
  </main>;
}
const nav = {
  admin: [['Giáo viên', 'admin-teachers'], ['Học sinh', 'admin-reset'], ['Rubric mẫu', 'admin-rubrics']],
  teacher: [['Trang chính', 'teacher-home'], ['Lớp học', 'classes'], ['Bài giao', 'teacher-assignments'], ['Chấm bài', 'teacher-grading'], ['Rubric', 'teacher-rubrics'], ['Thư viện', 'teacher-library'], ['Drive', 'drive']],
  student: [['Trang chính', 'student-home'], ['Lớp học', 'join-class'], ['Bài được giao', 'student-assignments'], ['Khu vườn', 'garden'], ['Rubric', 'student-rubrics'], ['Thư viện', 'student-library']]
};
const navGroup = {
  'class-members': 'classes', 'class-import': 'classes', 'assignment-author': 'teacher-assignments',
  'assignment-reopen': 'teacher-assignments', 'review-draft': 'teacher-grading',
  'review-republish': 'teacher-grading', 'student-editor': 'student-assignments',
  'student-source': 'student-assignments', 'student-result': 'student-assignments', 'library-reader': 'student-library'
};
function Shell() {
  const links = nav[scene.role].map(([name, id]) => <a key={id} aria-current={(navGroup[scene.id] ?? scene.id) === id ? 'page' : undefined} href={`?scene=${id}`}>{name}</a>);
  return <div className="shell">
    <aside className="sidebar"><a className="wordmark" href="?">Vườn Văn</a><p className="muted">{roleName[scene.role]}</p><nav aria-label="Điều hướng chính">{links}</nav></aside>
    <div className="workspace"><header className="topbar"><a className="mobile-brand" href="?">Vườn Văn</a><span className="breadcrumb">Vườn Văn / {scene.title}</span><div className="actions">
      {scene.role !== 'admin' && <a className="button" href="?scene=notifications">Thông báo</a>}<span className="account">{roleName[scene.role]}</span>
    </div></header>
    <main className="content"><h1>{scene.title}</h1><Content/></main></div>
    <nav className="mobile-nav" aria-label="Điều hướng trên điện thoại">{links}</nav>
  </div>;
}
function PasswordGate() {
  return <main className="password-gate">
    <p className="wordmark">Vườn Văn</p>
    <h1>Đổi mật khẩu</h1>
    <Panel title="Đặt mật khẩu mới">
      <Notice>Đây là lần đăng nhập đầu tiên. Em cần đổi mật khẩu tạm để tiếp tục.</Notice>
      <Field label="Mật khẩu mới" type="password" autoComplete="new-password"/>
      <Field label="Nhập lại mật khẩu mới" type="password" autoComplete="new-password"/>
      <Button kind="primary">Đổi mật khẩu</Button>
    </Panel>
  </main>;
}
function App() {
  if (scene?.id === 'password') return <PasswordGate/>;
  if (scene?.role === 'public') return <Login/>;
  if (scene) return <Shell/>;
  return <main className="catalog"><h1>Baseline giao diện Vườn Văn</h1><ul>{scenes.map(item => <li key={item.id}><a href={`?scene=${item.id}`}>{item.title} · {item.state}</a></li>)}</ul></main>;
}
createRoot(document.getElementById('root')).render(<App/>);
