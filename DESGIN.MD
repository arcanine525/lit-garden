# Vườn Văn — Đặc tả dựng lại giao diện

Tên file `DESGIN.MD` giữ đúng yêu cầu. Nguồn: <https://vuon-van-ca-nhan.pages.dev/>, khảo sát **19/11/2026** với vai trò giáo viên và học sinh. Mục tiêu triển khai: **độ khớp pixel >90% ở từng màn hình/viewport chính**. Chưa dựng ứng dụng clone, vì vậy tài liệu này **không phải chứng nhận đã đạt >90%**.

Thông số dưới đây lấy từ CSS gốc và `getComputedStyle` trong Chrome, không suy ra bằng cách nhìn ảnh. Các nhánh chưa xuất hiện trong dữ liệu thật được ghi rõ. Đọc cùng [FEATURES.MD](FEATURES.MD) để giữ đúng hành vi và phân biệt bản thật với demo.

## 1. Bộ tham chiếu và cách sử dụng

| Tài nguyên | Vị trí |
|---|---|
| Toàn bộ ảnh/DOM/style đo theo màn hình | [INDEX.md](docs/research/vuon-van-ca-nhan.pages.dev/INDEX.md) |
| Stylesheet nguồn, thứ tự cascade nguyên bản | [style.css](docs/research/vuon-van-ca-nhan.pages.dev/source/style.css) |
| Template màn hình live và nội dung nguyên văn | [live.js](docs/research/vuon-van-ca-nhan.pages.dev/source/live.js) |
| Text, rect, computed CSS, font status | `docs/research/vuon-van-ca-nhan.pages.dev/<screen>-<width>.json` |
| DOM đã render | Cùng tên `.html`; input value được bỏ khỏi bản lưu |
| Ảnh full-page ở DPR 1 | `docs/design-references/vuon-van-ca-nhan.pages.dev/<screen>-<width>.png` |
| Ảnh để xem nhanh | Cùng tên `-review.png`, rộng tối đa 640px; không dùng chấm pixel |
| Before/after tương tác | [interaction-states.json](docs/research/vuon-van-ca-nhan.pages.dev/interaction-states.json) |
| Manifest ảnh/font và checksum | [assets.json](docs/research/vuon-van-ca-nhan.pages.dev/assets.json) |
| Chấm pixel-diff | [scripts/pixel_diff.py](scripts/pixel_diff.py) |

Môi trường baseline: Chrome **157.0.8103.79**, macOS, locale `vi-VN`, timezone `Asia/Ho_Chi_Minh`, deviceScaleFactor 1; desktop **1440×900**, tablet **768×1024**, mobile **390×844**, CSS pixel. Ảnh full-page có chiều cao lớn hơn viewport. Thanh mobile fixed nằm ở đáy viewport ban đầu trong ảnh full-page; không chuyển nó xuống đáy tài liệu.

Ưu tiên: CSS và số đo cùng screenshot live → template live → screenshot demo cho riêng demo. Hai ảnh credential người dùng cung cấp không phải baseline kích thước: giao diện live hiện có ảnh trang trí phía trên ở mobile, kích thước font nhỏ hơn ảnh chụp được gửi, và không có custom password-eye.

## 2. Ngôn ngữ hình ảnh

Nền giấy kem, chữ xanh rêu đậm, khung xanh nhạt, góc bo mềm. Heading serif Lora, UI sans Be Vietnam Pro. Minh họa khu vườn màu nước trên cuốn sách, trong lọ mực và các trạng thái trồng cây. Phần lớn card **không có shadow**; tránh thêm bóng, gradient hoặc icon hiện đại ngoài nguồn gốc. Khoảng trắng và nội dung tiếng Việt quyết định ngắt dòng.

## 3. Design tokens

### 3.1. Màu nền, chữ, border

```css
:root {
  /* Tên biến thực tế trong stylesheet gốc */
  --ink: #29493b;
  --muted: #738174;
  --green: #39745b;
  --blue: #567bba;
  --cream: #faf9f1;
  --line: #e2e8da;
  --pink: #f7e9e7;
  --serif: 'Lora', Georgia, serif;
  --sans: 'Be Vietnam Pro', Arial, sans-serif;

  /* Alias phục vụ triển khai, giá trị đo từ nguồn */
  --surface: #fffef9;
  --surface-secondary: #fffdf7;
  --surface-input: #fffefb;
  --surface-sidebar: #f3f5e9;
  --surface-login: #f6f7e9;
  --surface-hero: #eef3df;
  --surface-quote: #f0f3e8;
  --border-input: #d6dfcf;
  --border-secondary: #d8e1ce;
  --nav-active-bg: #e1ead8;
  --nav-active-text: #28553e;
  --nav-hover-bg: #e8efdf;
  --nav-text: #60765f;
  --highlight-yellow: #fff0a1;
  --highlight-green: #c3ebcb;
  --highlight-pink: #f9cadb;
  --highlight-blue: #cfe6ff;
}
```

| Thành phần | Background | Text / border |
|---|---|---|
| Topbar | `#fffdf6cc` (alpha .8) | border-bottom `--line` |
| Mobile nav | `#fffdf6f5` | border-top `--line` |
| Primary button | `--green` | white |
| Secondary button | `#fffdf7` | text `#4d6c54`, border `#d8e1ce` |
| Blue button | `#e8eef8` | text `#4c6ca2`, border `#d4dfef` |
| Danger button | `#f8e8e3` | text `#934e40` |
| Tag mặc định | `#eef3e6` | `#5d7b4f` |
| Tag blue | `#eaf0f8` | `#587bb0` |
| Tag pink / Chờ chấm | `#f9eae4` | `#a77264` |
| Tag gold | `#f7efd9` | `#9a8344` |
| Avatar | `#dce7cf` | `#4e6f47` |
| Comment | `#faf5e8` | border-left `#d2bca0`, quote `#8c806a` |
| Toolbar editor | `#f5f7f0` | border `#dce3d5`, text `#344b3e` |
| Note editor, clock panel, scan result | `#f3f6e9` | text `--ink` |
| Inline info | `#edf2e6` | text `--ink` |
| Toast | `#29493b` | white |
| Backdrop dialog | `#23372c66` | blur 3px |

Không gộp các nền trắng ngà `#fffef9`, `#fffdf7`, `#fffefb` thành một màu. Không dùng nền autofill xanh trong ảnh credential làm nền input mặc định.

### 3.2. Typography

Load **Be Vietnam Pro 400/500/600/700**, **Lora normal và italic 400/500/600/700**, đủ glyph tiếng Việt. [fonts.css](docs/research/vuon-van-ca-nhan.pages.dev/source/fonts.css) lưu response của Google Fonts; [fonts-local.css](docs/research/vuon-van-ca-nhan.pages.dev/source/fonts-local.css) và manifest kèm tệp để tự host. Response font có thể khác theo user agent; khi tự host phải chờ `document.fonts.ready` và đối chiếu kích thước chữ với baseline.

| Vai trò / selector | Font | Size / weight / line-height | Khác |
|---|---|---|---|
| `body` | Be Vietnam Pro | 14 / 400 / 23.1px (`1.65`) | margin 0 |
| `h1` | Lora | 37 / 700 / 48.1px | letter-spacing -1px, margin-bottom 12px |
| `.page-head h1` mobile | Lora | 29 / 700 / 37.7px | ≤760px |
| `h2` | Lora | 24 / 700 / 31.2px | margin-bottom 12px |
| `.section-head h2` | Lora | 22 / 700 / 28.6px | margin 0; mobile 21/27.3 |
| `h3` | Lora | 18 / 700 / 23.4px | margin-bottom 8px |
| Brand name | Lora | 27 / 600 / normal | margin 9px 0 |
| Brand tagline | Be Vietnam Pro | 10 / 400 / 16.5px | letter-spacing .1px |
| Nav item | Be Vietnam Pro | 13 / 400 / 21.45px | active 600; icon 19px |
| Eyebrow | Be Vietnam Pro | 10 / 600 / 16.5px | uppercase, letter-spacing 2px; mobile hero 9px |
| Label và input trong label | Be Vietnam Pro | 13 / 600 / 21.45px | control `font:inherit` |
| Primary/secondary button | Be Vietnam Pro | 12 / 500 / 19.8px | mobile assignment button 10px |
| Link button | Be Vietnam Pro | 12 / 500 / 19.8px | xanh `--green` |
| Small | Be Vietnam Pro | 12 / 400 / 19.8px | màu muted |
| Footnote | Be Vietnam Pro | 11 / 400 / 19.8px (`1.8`) | màu muted |
| Assignment title | Be Vietnam Pro | 13 / 500 / 21.45px | display block; mb 6px |
| Meta, tag | Be Vietnam Pro | 10 / 400 / 16.5px | meta flex-wrap |
| Stat number | Lora | 32 / 500 / normal | mobile 28px; ô Thầy Cô 23px |
| Essay đọc | Lora | 17 / 400 / 34px (`2`) | mobile `.essay` 16px |
| Rich editor | Lora | 17 / 400 / 34px | mobile vẫn 17px, không áp rule `.essay` |
| Quote trong card | Lora italic | 16 / 400 / 28px (`1.75`) | `#405947`, text-wrap pretty |
| Quote author | Be Vietnam Pro | 11 / 400 / 16.5px | letter-spacing .3px; align right |
| Footer | Lora italic | 12 / 400 / normal | `#91a088`, centered, margin-top 30px |

**Hero slogan là container query, không dùng 42px cố định:**

```css
.hero-copy { container-type: inline-size; }
.hero h1.garden-slogan {
  max-width: none;
  font-size: clamp(16px, 5.4cqi, 34px);
  line-height: 1.35;
  font-style: italic;
}
.garden-slogan > span { display: block; white-space: nowrap; }
```

Kích thước thực đo trên hero giáo viên: **30.5539px** ở 1440; **16px** ở 768; **16.416px** ở 390. Hai dòng slogan giữ nguyên; đừng áp heading 34/35/42px từ các rule bị ghi đè ở đầu CSS. `garden-tagline` 13/400/20.8px, max-width none.

### 3.3. Spacing, radius và shadow

Nguồn không có spacing scale thuần 4/8px. Giữ các giá trị như **23, 26, 31, 38px** thay vì làm tròn theo một design system mới.

| Token / thành phần | Giá trị |
|---|---|
| Content desktop | padding `28px 38px 45px`; max-width 1370px; margin auto |
| Content tablet ≤1150 | padding 25px |
| Content mobile ≤760 | padding `18px 16px 85px` |
| Panel | padding 23px; mb 23px; border 1px; radius 16px; mobile padding 19px |
| Hero | radius 22px; mb 26px; border 1px |
| Stat | padding `19px 20px`; radius 15px; ≤1150 padding 16px |
| Class card | padding 24px; radius 18px |
| Input/select/textarea | padding `11px 12px`; mt 6px; border 1px; radius 10px |
| Label | mb 14px |
| Button | padding `10px 17px`; radius 10px; gap 8px; min-height 40px |
| Button row | gap 10px; wrap; align center |
| Section head | gap 12px; mb 18px; align center; space-between |
| Page head | gap 18px; mb 24px; space-between |
| Grid2/Grid3 | gap 20px |
| Main columns/form/grading | gap 24px |
| Assignment row | padding `18px 0`; gap 16px; top-border 1px `#edf0e6`; mobile gap 10px |
| Tag | padding `3px 9px`; radius 20px; gap 4px; nowrap |
| Tab | padding `8px 14px`; radius 20px; gap giữa tab 8px; tabs mb 20px |
| Dialog | padding 28px; radius 20px; border 1px; max-width 580px |
| Empty state | padding `40px 20px`; centered; muted |
| Toast | padding `13px 22px`; radius 12px; shadow `0 5px 30px #22332230` |
| Garden card | radius 20px; shadow `0 3px 12px #324f3710` |
| Clock toggle | shadow `0 3px 10px #29493b20`; min-height 48px |

## 4. Khung trang và responsive

### 4.1. Desktop shell

- `.shell`: grid `235px 1fr`, min-height 100vh. `.main`: min-width 0.
- Sidebar: nền `#f3f5e9`, border-right 1px, padding `31px 18px 22px`, **sticky top 0, height 100vh**, flex column. Brand padding `0 14px 30px`.
- Nav label: 10px, tracking 1.5px, màu `#899483`, padding `15px 14px 9px`.
- Nav item: full width, padding `12px 14px`, margin `3px 0`, gap 12px, radius 10px. Icon width 22px. Active được quyết định bởi màn hình hiện hành.
- Teacher sidebar note: margin-top auto, padding 15px, radius 15px, nền `#e9eedf`, chữ 11px `#66765c`, icon mặt trời 23px `#bf9b37`. Không có ở học sinh.
- Topbar: **không sticky**, cao 76px, padding `0 38px`, gap 16px. Breadcrumb 12px muted. Actions gap 12px; avatar 35×35; nút tài khoản 11px, padding `6px 10px`, radius 8px, border 1px.
- Content max-width 1370px bao gồm padding; căn giữa trong main, không căn giữa toàn viewport.

### 4.2. Breakpoints chính xác

| Điều kiện | Thay đổi |
|---|---|
| `max-width:1150px` | Sidebar 205px, padding `25px 12px`; topbar padding 25px; content 25px; hero-copy 30px; columns `1.4fr 1fr`; stats gap 10px; form-layout/grading-layout 1 cột; grid3 2 cột; `.sticky` thành static |
| `max-width:900px` | Garden gap 12px; caption 15px; tên nhóm 22px; số 25px; arrow right 12/top 15 |
| `max-width:760px` | Ẩn sidebar, shell block; topbar cao 66px/padding 16px; ẩn breadcrumb và tên tài khoản; hiện mobile brand 23px; top-actions gap 7px, account button 10px; bottom nav fixed; stats 2 cột; columns/grid2/grid3 1 cột gap 0; panel 19px; hero overlay; login xếp dọc |
| `max-width:600px` | Garden 1 cột gap 16px; mỗi card grid `42% 58%`, ảnh trái; caption 20px; tên 25px; arrow top22/right16; số vẫn 25px kế thừa rule 900 |
| `prefers-reduced-motion:reduce` | Chỉ tắt animation `.spark` trong nguồn; không tự suy ra các motion khác cũng bị tắt |

**768px vẫn dùng sidebar** và bốn stat một hàng. Không thay bằng hamburger hoặc layout mobile ở 768. Root/body font không đổi theo breakpoint. Không có dark mode trong stylesheet khảo sát.

Mobile nav: fixed left/right/bottom 0, z-index 10, padding 6px, `overflow-x:auto`; button `flex:1 0 auto`, padding 5px, chữ 10px, icon 20px, flex column; active xanh/700. Đo tại 390×844: **390×72.5**, y=771.5. Giáo viên 6 mục, học sinh 4 mục.

### 4.3. Số đo đối chiếu trang chính giáo viên

Tọa độ x/y tính từ viewport tại scroll 0; làm tròn 2 chữ số để đọc. JSON giữ độ chính xác đầy đủ.

| Khối | 1440×900 | 768×1024 | 390×844 |
|---|---|---|---|
| Sidebar | width 235 | width 205 | ẩn |
| Topbar | x235, y0, 1205×76 | x205, y0, 563×76 | x0, y0, 390×66 |
| Hero | x273, y104, 1129×315 | x230, y101, 513×315 | x16, y84, 358×355 |
| Stats | x273, y445, 1129×135.19 | x230, y442, 513×175.38 | x16, y465, 358×304.56 |
| Một cột stat | 270.25 | 120.75 | 174 |
| Columns dưới stats | x273, y608.19, width1129 | x230, y645.38, width513 | x16, y797.56, width358 |
| Hai cột nội dung | 688.02 / 416.97 | 285.23 / 203.75 | một cột 358 |

Chiều cao phụ thuộc nội dung snapshot; không cố định chiều cao card theo bảng nếu dữ liệu đổi. Grid item mặc định stretch làm panel bài đang mở trên desktop cao bằng cột thư viện/quote bên cạnh.

## 5. Màn hình và component

Thông số sâu cho từng nhóm nằm trong [đặc tả màn hình](docs/design/SCREENS.md), [states và tương tác](docs/design/INTERACTIONS.md). Các bảng sau là hợp đồng bố cục chính.

| Màn hình live | Thứ tự thành phần | Interaction model | Baseline desktop |
|---|---|---|---|
| Login | login-art + login-box (brand → h2 → form → footnote → demo link) | submit/click, focus/native validation | `login-1440` |
| Home giáo viên | Hero → 4 stats → columns (bài mở / thư viện + quote) → footer | click điều hướng; spark theo thời gian | `teacher-home-1440` |
| Home học sinh | Hero → columns như trên → footer | click Thăm vườn/Làm bài | `student-home-1440` |
| Lớp học | h1 → mô tả → button row → grid3 class cards | click card; dialog CRUD/import | `teacher-classes-1440` |
| Chi tiết lớp | Tiêu đề lớp → toolbar chung → panel roster | click back/cấp/reset | `teacher-class-detail-1440` |
| Danh sách giao bài | h1 → page-head mô tả + nút → panel rows | click Xem bài/Giao bài | `teacher-assignments-1440` |
| Giao bài mới | h1 → panel form grid2 + các textarea toàn dòng | form submit; select/checkbox | `teacher-new-assignment-1440` |
| Bàn chấm bài | h1 → mô tả + export → panel/table | click review/download | `teacher-grading-1440` |
| Chấm bài | h1 → grading-layout 2 panel → footer | chọn text, click tools, accordion/select | `teacher-review-1440` |
| Học sinh làm bài | h1 → timer → form-layout → history panel | nhập, format, timer, submit, accordion | `student-write-1440` |
| Khu vườn | h1 → mô tả → 3 garden cards → panel danh sách | click lọc; hover; không scroll-driven | `student-garden-1440` |
| Rubric | h1 → mô tả → 4 tabs → panel tiêu chí | click đổi tab; native details | `teacher-rubrics-1440` |
| Thư viện | h1 → add-details (GV) → panel bộ lọc/list | click/form/filter/reader | `teacher-library-1440` |
| Đổi mật khẩu | h1 → panel max-width550 → form | submit/validation | `teacher-password-1440` |

Không có scroll-snap, parallax, auto-switch tab theo cuộn, smooth-scroll library hoặc intersection animation trong mã nguồn khảo sát. Sidebar sticky, topbar trôi khỏi viewport khi cuộn; thanh mobile fixed. Click điều hướng chính gọi `scrollTo(0,0)`; một số màn hình con gọi trực tiếp renderer nên có thể giữ scroll cũ — khi chụp baseline chuẩn phải đưa về scroll 0.

## 6. Minh họa và lớp phủ

Tái sử dụng **đúng các tệp đã tải** trong `docs/research/vuon-van-ca-nhan.pages.dev/source/`, không vẽ/generate lại ảnh cho bản clone cần >90%. Kích thước nội tại và SHA-256 nằm trong [assets.json](docs/research/vuon-van-ca-nhan.pages.dev/assets.json).

| Asset | Vị trí | Rendering |
|---|---|---|
| `vuon-trong-trang-sach.webp` (1536×1024) | Login-art; hero cả hai vai trò | Login background center/cover; hero img absolute inset0, width/height100%, object-fit cover, object-position `center 57%` |
| `khu-vuon-trong-lo-muc.webp` (960×640) | Quote card ở home | width100%, height auto, contain; margin-top -24px; mask từ transparent tới đen ở 46px |
| `garden-sprout.webp` (1122×1402) | Card Mầm | aspect-ratio 4/5, object-fit cover |
| `garden-flower.webp` (1122×1402) | Card Hoa | Như Mầm |
| `garden-fruit.webp` (1122×1402) | Card Quả | Như Mầm |

Hero layers desktop: nền `#eef3df` → ảnh trong cột phải → pseudo `hero-art::after` với `linear-gradient(90deg,#eef3df 0%,transparent 27%), radial-gradient(ellipse at 80% 10%,#fff6beaa,transparent 65%)` → hero-copy z2, gradient `linear-gradient(90deg,#eef3df 78%,#eef3df00)` và margin-right -35px → ba spark z3.

Mobile: hero-art absolute inset0/left33%, opacity .5; overlay chỉ còn radial gradient. Hero-copy padding26, margin0, gradient `linear-gradient(90deg,#eef3dff2 45%,#eef3df77)`; hero min-height355. Cần giữ cả opacity lẫn gradient để ảnh đủ nhạt.

Quote card là flex column, nền `#f0f3e8`; text block padding `26px 28px 32px`; image order2; pseudo `:after` **display:none**. Những rule `.garden-note` cũ ở đầu stylesheet bị ghi đè bởi `.garden-quote` ở cuối.

Brand/nav dùng glyph Unicode (`✿`, `⌂`, `♧`, `▤`, `✎`, `▦`, `☼`, `↗`, `✦`, `✧`), không phải thư viện icon. Có SVG cây đồng hồ trong `workbench.js`; chỉ tái sử dụng paths nguồn. Fallback glyph phụ thuộc hệ điều hành, vì vậy môi trường QA phải đồng nhất.

## 7. States, focus và motion

| State | Giá trị chuẩn |
|---|---|
| Button hover | `filter:brightness(.96)`; background token không đổi; không có transition duration được khai báo |
| Button disabled | opacity .5; cursor not-allowed |
| Nav hover | background `#e8efdf`; active nền `#e1ead8`, chữ `#28553e`, weight600; hover rule có thể ghi đè nền active khi con trỏ ở trên |
| Tab active | background `--green`, text white; inactive `#eef0e5` |
| Garden hover | border `#9fb58d`; shadow `0 7px 22px #324f3720`; transition box-shadow/border-color .2s ease |
| Garden selected | Mầm `#739b5e`, Hoa `#c6889e`, Quả `#c8a354`; border và ring `0 0 0 2px` cùng màu |
| Library entry hover | h3 xanh `--green`, underline offset5px; parent không đổi màu |
| Class name hover | underline offset5px |
| Rich toolbar hover | background `#e3eadc` |
| Rich toolbar focus | outline `2px solid #658b72`, offset1px |
| Input/button focus chung | outline-offset4px, outline native browser; Chrome khảo sát input focus `rgb(0,95,204) auto 1px` |
| Dialog | native top layer; backdrop `#23372c66` + blur3px; centered |
| Toast live | fixed bottom25px, left50%, translateX(-50%), z20, font12; tự ẩn sau 6000ms |
| Spark | `glow 5s ease-in-out infinite`; 50% opacity .35, scale .75; s2 delay2s, s3 delay1s |

Spark base font30px, text-shadow `0 0 14px #ffe9a5`, màu `#fff8cb`; s1 top13/right15%; s2 top62/right36%, font20; s3 bottom13/right9%. Timer cập nhật mỗi 500ms khi đang chạy và mở, nhưng thời gian hiển thị theo giây. Native details và tabs không có animation mở/đóng tự dựng.

Trạng thái đã mở: 4 tab rubric + tiêu chí đầu; dialog tạo/sửa/xóa bị chặn/xóa trống/cấp/reset tài khoản; import preview lỗi; library file/link; comment editor/cancel/no-selection/scan; garden cả ba bộ lọc; timer mở/tạm dừng; editor nháp có format; login focus/required. Trạng thái thiếu fixture: live reader file, feedback đã trả, AI feedback, credential được cấp, import thành công, pagination >100. Không dùng dữ liệu giả không ghi nhãn để tuyên bố đã quan sát các trạng thái này.

## 8. Hướng dẫn triển khai

1. **Foundation:** dựng font, màu, reset, shell responsive; dùng nguyên CSS nguồn làm chuẩn đối chiếu cascade. `box-sizing:border-box` cho tất cả; `button,input,textarea,select {font:inherit}`; tránh CSS reset làm mất marker details hay outline native.
2. **Shared components:** brand/nav/topbar, button/link/tag/tab, panel/grid, form field, assignment row, dialog, toast. Tách CSS biến thể để không làm sai màu và padding giữa class card, stat và panel.
3. **Theo màn hình:** login → home hai vai trò → classes/dialogs → assignments/new task → rubrics → editor/timer → grading/annotations → garden → library/password. Mỗi task triển khai chỉ nên chịu trách nhiệm một component hoặc một trạng thái, có baseline tương ứng.
4. **Data/interaction:** dùng dữ liệu snapshot cố định khi so pixel, sau đó nối dữ liệu thật. Giữ trạng thái tạm của editor, selection/ranges, timer và dialog tách khỏi dữ liệu đã gửi. Không đưa tính năng chỉ có ở demo vào live như thể bản gốc đã có.
5. **Responsive QA:** test độc lập ở 1440, 768, 390; bổ sung sát breakpoint 1150/1151, 900/901, 760/761, 600/601. Các điểm sát breakpoint là yêu cầu QA triển khai; đợt khảo sát này đo ba viewport chính.

Không thay placeholder/dữ liệu bằng đoạn dài ngẫu nhiên lúc chấm pixel. Đặc biệt tên bài `test`, nội dung `hihi`, bài nộp ngắn và số lượng card hiện tại làm layout khác hẳn các bài mẫu dài của demo.

## 9. Tiêu chuẩn nghiệm thu >90%

**Điều kiện chụp:** cùng viewport/DPR/browser/OS, font đã load, tất cả ảnh đã load và có naturalWidth >0, scroll0, pointer ra ngoài component, cùng dữ liệu và các accordion/tab/timer đang mở. Chụp cả full-page và viewport khi kiểm tra fixed nav/modal. Ảnh baseline gốc có spark động; để chạy QA lặp lại, chụp lại cả nguồn và clone với cùng chế độ `reducedMotion:'reduce'` hoặc cùng quy tắc dừng spark, không chỉ sửa một phía. Tắt timer hoặc cố định trạng thái thời gian ở cả hai phía.

```bash
python3 scripts/pixel_diff.py \
  docs/design-references/vuon-van-ca-nhan.pages.dev/teacher-home-1440.png \
  artifacts/clone/teacher-home-1440.png \
  --threshold 90.1 --tolerance 10 --bands 10 \
  --out artifacts/diff-teacher-home-1440.png
```

Script đếm pixel lệch quá 10 trên bất kỳ kênh RGB; điểm `100 × (1 − pixel_lệch / tổng_pixel)`. **Sai kích thước ảnh trả lỗi**, không resize để làm đẹp điểm. Threshold 90.1 để đáp ứng yêu cầu **lớn hơn** 90, không chỉ bằng 90. Đây là metric pixel cụ thể, không đồng nghĩa tuyệt đối với đánh giá thẩm mỹ của con người.

- Mỗi màn hình chính × ba viewport phải >90%; không lấy trung bình để che màn hình kém.
- Kiểm tra thêm các vùng hero, typography, editor, dialog và navigation riêng; nền kem chiếm nhiều diện tích có thể làm điểm toàn trang cao dù component sai.
- Sai vị trí/kích thước vùng chính nên ≤2 CSS px; màu nền/border phải đúng token; font và ngắt dòng khớp. Mức ≤2px là tiêu chí nghiệm thu đề xuất, không phải kết quả đo clone.
- Kiểm tra hover/active/focus, keyboard tab, native details/dialog Escape, selected garden, toolbar selection, timer, CSV validation; route/role visibility theo FEATURES.
- Không tràn ngang ngoài các vùng có overflow chủ đích; nội dung cuối không bị bottom nav che mất khi cuộn hết. Ba viewport đã đo không có document overflow ngang ở các màn hình chính.
- Xuất báo cáo screenshot gốc/clone/diff và điểm từng màn; giải thích từng vùng sai trước khi sửa CSS.

## 10. Giới hạn và trạng thái bàn giao

Đã thu 82 ảnh theo trạng thái/viewport, DOM, computed styles, CSS, nội dung rubric, ảnh minh họa, font và các state có thể mở mà không ghi nghiệp vụ lên server. Đã đối chiếu 17 giá trị token/layout trong [token-verification.json](docs/research/vuon-van-ca-nhan.pages.dev/token-verification.json). [Quality checks](docs/research/vuon-van-ca-nhan.pages.dev/quality-checks.json) ghi kiểm tra liên kết, credential và ba trường hợp chạy công cụ diff. Các thao tác ghi/AI và state thiếu dữ liệu được đánh dấu trong FEATURES và INTERACTIONS.

Không có PLAN/TODO cũ để lưu trữ. Lộ trình bốn bước foundation → components/screens → interactions/data → visual QA được tích hợp tại đây theo phạm vi hai tài liệu người dùng yêu cầu. Chưa triển khai frontend mới; chưa chạy pixel-diff giữa nguồn và clone. Kết quả hiện tại là bộ đặc tả và baseline để triển khai/đo độ khớp sau này.
