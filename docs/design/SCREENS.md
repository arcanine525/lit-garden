# Chi tiết màn hình — Vườn Văn live

Đọc sau [DESGIN.MD](../../DESGIN.MD). Đường dẫn ảnh trong bảng là tên file dưới `../design-references/vuon-van-ca-nhan.pages.dev/`; JSON cùng tên dưới `../research/vuon-van-ca-nhan.pages.dev/`. Mọi giá trị px là CSS pixel. Không lấy layout demo thay cho live.

## Login

- `.login-wrap`: min-height100vh, grid `1fr 1fr`, nền `#f6f7e9`. 1440: cột ảnh 720px; 768: cột ảnh384px. Không có card border/shadow quanh form.
- `.login-art`: background ảnh sách center/cover, relative; `::after` absolute inset0, gradient `linear-gradient(0deg,#254c4266,transparent)`.
- Heading trên ảnh: absolute bottom35/left40, z1, white, Lora45px, max-width400, ba dòng “Một khu vườn nhỏ,” / “nhiều trang viết” / “đang chờ.”; mobile font30, bottom20/left25.
- `.login-box`: align-self center; max-width430; padding40; margin auto; width100%. 1440: x865/y166.89/w430/h566.22, content width350; 768: x384/y228.89/w384/h566.22, content304.
- Mobile≤760: wrapper block; ảnh cao210; login-box padding30; tại390 box x0/y210/w390/h546.22, content330.
- Brand flower35px, name27/600, tagline10; brand padding-bottom30; h2 “Vào khu vườn của mình” 24/700.
- Hai label13/600; input height45.4375 ở baseline, padding11/12, margin-top6; label mb14. Không tự thêm placeholder hay icon mắt.
- Submit min-height40; footnote margin-top20, font11/1.8; demo link12/500 màu xanh, underline native của anchor.
- Baseline: `login-1440`, `login-768`, `login-390`, `login-focus-390`.

## Home

- Hero grid `1.15fr 1fr`, min-height315; copy padding `36px 36px 32px`; ≤1150 padding30; mobile26. Geometry và layers tại DESGIN.
- Text giáo viên: “Nâng niu ý tưởng,” / “Ươm dưỡng tình yêu văn chương”; học sinh: “Hôm nay,” / “em gieo điều gì vào trang viết?”. Giữ dấu, casing, hai span nowrap.
- Eyebrow mb16; heading mb12; tagline dưới heading; button-row CTA + link rubric.
- Stats grid4 equal/gap16/mb28; tại≤1150 gap10, ≤760 hai cột. Icon stat32×32, radius10, line-height32; màu mỗi ô khác nhau theo `nth-child` nguồn.
- Panel bài mở nằm trong columns `1.65fr 1fr`, gap24. Row có book icon44×51, border-left4, radius `6px 12px 12px 6px`; icon serif20.
- Book màu mặc định nền `#e7eef8`, chữ `#6884b0`, border `#c4d4e9`; `.assignment:nth-child(odd)` đổi sang nền `#f6e9e4`, border `#e9cec4`, chữ `#ad7f6d`. Tính nth-child trên DOM thật, không theo index mảng đơn thuần.
- Library invitation h3 24px; p14px, margin `12px 0 0`. Quote/image ngay dưới invitation, khác panel thường; giữ mask ảnh.
- Baseline: `teacher-home-{1440,768,390}`, `student-home-{1440,768,390}`.

## Lớp học và roster

- Header “Lớp học của tôi”, đoạn mô tả, button row mb24; grid3 3 cột/gap20, ≤1150 2 cột, ≤760 1 cột/gap0.
- Class card nền `#fffdf7`, border1 `--line`, padding24, radius18, relative/overflow hidden. Pseudo flower `✿` font90, right12/top-16, màu`#e3ebd6`; h2 relative ở phía trên.
- Class-open button thừa kế font h2, full width, text-align left, padding0; arrow16px xanh/margin-left10; action buttons margin-top18. Mobile class-card mb16.
- Roster panel margin-top24; header có link quay lại, h2 margin-top12, small năm học; CTA cấp tài khoản bên phải; mỗi học sinh dùng assignment-row, không phải table.
- Dialog tạo lớp nhiều dòng width580 desktop hoặc viewport−32 mobile; tại1440 x430/y249.125/h401.734; tại390 x16/y221.125/w358/h401.734. Padding28, border1, radius20.
- Edit class có nút× float right font22; tạo nhiều lớp/import dùng nút Đóng riêng. Không đồng nhất mọi dialog thành một footer chung.
- CSV preview dùng table trong vùng max-height280/overflow auto; action buttons flex-wrap, disabled opacity .5.
- Baseline: `teacher-classes-*`, `teacher-class-detail-1440`, `teacher-create-classes-dialog-*`, `teacher-edit-class-dialog-1440`, `teacher-import-{dialog,validation}-1440`, các `teacher-delete-class-*` và `teacher-create-student-dialog-1440`.

## Giao bài

- Danh sách: page-head tiêu đề rồi page-head riêng chứa mô tả/nút giao bài; panel chứa row. Không thêm tìm kiếm/filter không có ở nguồn.
- Dialog Xem bài: h2 tên, tag rubric+thang, h3 “Đề bài” mt20, prompt pre-wrap; có ngữ liệu thì h3+p; cuối là tham chiếu.
- Form mới: h1 “Gieo một ý tưởng mới”; một panel full width. Grid2 gap20 gồm Tên bài/Lớp, Rubric/Điểm tối đa. ≤760 grid2 một cột/gap0; 768 vẫn hai cột.
- Sau grid: textarea Đề bài, Ngữ liệu, Nội dung tham chiếu; min-height110/line-height1.8/resize vertical; checkbox AI width auto/margin-right8; footnote rồi nút submit.
- Không có aside preview rubric hoặc date picker trong live. Đó là layout demo.
- Baseline: `teacher-assignments-*`, `teacher-assignment-detail-dialog-1440`, `teacher-new-assignment-*`.

## Rubric

- h1 + muted p; tabs wrap gap8, mb20. Mỗi button padding8/14/radius20/font12; active xanh nền + white.
- Panel section-head chứa h2 22px và tag blue thang chuẩn. Các details `.rubric-block` mb18.
- Summary12/600, padding13px 0, border-bottom1 `--line`, native triangle marker. Không thay triangle bằng icon khác nếu muốn khớp.
- Level row flex align-start/gap12, padding12px 0, border-bottom1 `#eef0e8`, font12; score bold min-width40/color`#5b7e9e`.
- Mỗi details độc lập, có thể mở nhiều cùng lúc; chuyển tab dựng lại nội dung, mặc định đóng. Số tiêu chí: 5,5,8,8.
- Baseline: `teacher-rubrics-*`, `teacher-rubric-{0,1,2,3}-open-1440`.

## Bàn chấm và màn hình chấm

- Table width100%, border-collapse collapse, font12; th/td padding13/10, vertical-align top, border-bottom1; th10/500/uppercase/tracking .5. Live có 3 cột: học sinh/bài, trạng thái, action. Không có cột điểm/phiên bản như demo.
- `.grading-layout`: grid `minmax(0,1.2fr) minmax(320px,1fr)`, gap24; ≤1150 một cột. Tại1440: x273/y188.09/w1129, hai cột602.72 và502.28.
- Panel trái: h2 bài, reference details, word-count, essay min-height250/white-space pre-wrap/font17/2; review tools, status, note editor, list comments, scan result; AI conditional.
- Panel phải: h2, mỗi label+select rồi details mô tả; textarea overall; footnote quy đổi; nút lưu/trả và xuất bản đã lưu. Hai panel là grid items stretch cùng hàng, không tự làm aside sticky.
- Tools flex-wrap/gap10/margin12px 0; select width auto/margin0 5px. Note editor nền xanh nhạt/padding14/radius12. Comment padding14/border-left3/radius0 9px 9px 0/margin13px 0/font12.
- Baseline: `teacher-grading-*`, `teacher-review-*`, `teacher-review-reference-scan-1440`, `teacher-review-no-selection-1440`, `teacher-review-comment-editor-1440`.

## Trang viết học sinh

- h1 tên bài → writing-clock-top mb22 → form-layout → panel history. Grid `minmax(0,1.5fr) minmax(260px,1fr)`, gap24; ≤1150 một cột. 1440: widths663/442.
- Clock button min-height48, padding12/22, font15/600, border1`#326149`; panel mt12/padding14/radius12/border`#cfddbf`; SVG54×56; time tabular-nums.
- Editor textarea nguồn bị ẩn; toolbar52px cao ở desktop, border1/radius12 12 0 0/padding7 10/gap4; buttons36×36/radius6/font18 Arial; divider22px×1, margin0 6px; color control49px, select opacity0 phủ control.
- `.rich-editor`: border1`#cbd6c2`, background`#fffefb`, padding16, min-height300, max-height70vh, overflow auto, radius0 0 12 12; font17/34 Lora; pre-wrap/overflow-wrap:anywhere. Không dùng min-height360/padding22 của rule `.essay-editor` cũ.
- Tại1440 editor x297/w615/h300; toolbar cùng width615. Nội dung y thay đổi khi đồng hồ mở; không hard-code y.
- Phần dưới: word-count bold;margin8px 0; small lưu nháp; label giải thích mt15; submit; panel history có details mở bản đầu, thời gian `vi-VN`.
- Baseline: `student-write-*`, `student-write-clock-1440`, `student-write-formatted-local-draft-1440` (nháp thử cục bộ, không bài thật).

## Khu vườn

- Header “Khu vườn của em”; p mô tả; garden-cards grid3 minmax(0,1fr), gap20, mb28. Card flex column, overflow hidden, border1, radius20.
- Image ratio4/5; caption flex column gap9/padding20 21 23/relative; name25/500/1.3 Lora `#34543f`; count28/500/1.25 `#3d6549`; flower count`#9a6177`, fruit count`#9d782a`; label12/1.6 `#69765f`.
- 1440 card363×572.75; 768 card163×302.09; 390 card358×188.89. Mobile ảnh149.516px/caption206.469px trong phần content width356, không tính border2.
- ≤600: hàng ngang ảnh42%/caption58%; mỗi nhóm một hàng; arrow absolute; vùng danh sách dưới cards có section-head và rows hoặc empty copy.
- Baseline: `student-garden-*`, `student-garden-{sprout,flower,fruit}-1440`.

## Thư viện và mật khẩu

- Teacher có add-details.panel trước list.panel; học sinh chỉ có list.panel. Summary “+ Thêm tài liệu” dùng link12px. Form một cột, cùng control tokens.
- Mode file/link bật/tắt div và required/disabled tương ứng. File input giữ native browser control; không dựng dropzone.
- Filter button-row hai secondary buttons; `aria-pressed` có đổi nhưng CSS hiện không có style active riêng cho hai nút. Empty message là p thông thường, **không** `.empty` padding40.
- Item có dữ liệu theo mã: assignment flex-wrap; body min-width120; title, small source, read/link, favorite. Chưa có screenshot populated live.
- Reader theo nguồn: `dialog.reader-dialog` width min(850px,95vw), max-width95vw; reader pre-wrap/max-height65vh/overflow auto; iframe100%×62vh; section-head title/Đóng, nguồn và link tải. Chưa xác nhận render bằng dữ liệu thật.
- Password panel max-width550; mô tả, 2 label password, footnote6 ký tự và submit; breadcrumb vẫn có thể là mục trước đó vì `password()` không đổi livePage.
- Baseline: `teacher-library-*`, `teacher-library-add-{file,link}-1440`, `student-library-*`, `student-library-favorites-1440`, `teacher-password-1440`.
