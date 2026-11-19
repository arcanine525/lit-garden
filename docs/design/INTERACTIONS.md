# Trạng thái và tương tác — Vườn Văn

Nguồn: [live.js](../research/vuon-van-ca-nhan.pages.dev/source/live.js) và các module công khai; số đo before/after tại [interaction-states.json](../research/vuon-van-ca-nhan.pages.dev/interaction-states.json). “Đã mở” không có nghĩa đã submit thao tác ghi trên server.

## Điều hướng, cuộn và lớp phủ

| Trigger | Before → after | Persistence / animation |
|---|---|---|
| Click nav | Thay content và nav active; label breadcrumb theo menu | Cùng URL `/`; không history route; scrollTo0 ở điều hướng chính |
| Cuộn desktop | Sidebar vẫn ở top0, topbar đi lên khỏi viewport | Sticky CSS, không có JS đổi kích thước header |
| Cuộn mobile | Bottom nav vẫn fixed ở bottom0 | z10, nền gần opaque; content padding-bottom85 |
| Mở dialog | `dialog.open=false → true`, vào top layer, backdrop blur3 | Native showModal; Escape đóng trừ khi bulk đang busy |
| Đóng dialog | Click×/Đóng/Hủy hoặc native cancel | Không có animation fade/scale trong CSS |
| Toast | display none → block, nội dung lỗi/thành công | Live6000ms; demo4000ms; fixed bottom25/z20 |

Đã yêu cầu scrollTo500 trên teacher home; trang chỉ còn khoảng334px để cuộn: topbar y0→−334, sidebar y≈0. Không gọi đây là ngưỡng 500px kích hoạt hiệu ứng.

## Before/after màu và style

| Component | Default | Hover/selected/focus |
|---|---|---|
| Primary CTA | bg rgb(57,116,91), filter none | filter brightness(.96); geometry không đổi |
| Nav inactive | transparent, rgb(96,118,95) | bg rgb(232,239,223) |
| Garden card | border rgb(220,228,210); shadow rgba(50,79,55,.063) 0 3 12 | hover border rgb(159,181,141); shadow rgba(50,79,55,.125) 0 7 22 |
| Garden Hoa selected | aria-pressed false | true; border rgb(198,136,158); ring0 0 0 2px cùng màu |
| Login input | border rgb(214,223,207), outline native chưa focus | outline rgb(0,95,204) auto1px, offset4px trên Chrome đo |
| Rubric tab | bg #eef0e5, màu inherited ink | active bg #39745b, white |
| Toolbar button | transparent | hover #e3eadc; keyboard focus outline2px #658b72 offset1 |

Button hover không có duration khai báo; computed `transition:all` có thời gian mặc định0s. Chỉ garden border/shadow có `.2s ease`. Không thêm hiệu ứng dịch chuyển lên khi hover.

## Đăng nhập và đổi mật khẩu

- Form trống: HTML validation làm username/password invalid, không gửi login; đã kiểm tra `checkValidity=false`, 2 field invalid. Native validation popup phụ thuộc trình duyệt, không hard-code tooltip thành component của app.
- Login đang gửi: text “Đang vào vườn…”, disabled và aria-busy. Thành công chuyển loading garden rồi dashboard; lỗi toast từ API. Login thành công hai vai trò đã xác nhận; invalid credential/rate limit chưa cố tình kiểm thử.
- Password mismatch bị chặn phía client trước POST; nhập 6–128 ký tự, `autocomplete=new-password`. Buộc đổi password tạm phụ thuộc profile, chưa có fixture để chụp.
- Autofill, password-eye của trình duyệt và focus ring của hệ điều hành không phải một bộ icon/theme do source app định nghĩa.

## Lớp, tài khoản và CSV

- Tạo lớp: click mở nhiều lớp, newline split/trim/deduplicate; busy khóa nút và ngăn cancel. Dialog ban đầu đã chụp; progress/success chưa chạy.
- Sửa/xóa/reset: đã mở từng dialog và đóng lại. Xóa lớp10A1 hiện nhánh chặn do có1 bài giao; TEST hiện xác nhận xóa lớp trống. Chưa chạy POST các tác vụ này.
- CSV: chọn tệp chỉ parse local. Đã dùng fixture `preview-only.csv`:1 dòng hợp lệ,1 username uppercase không hợp lệ; có preview table, lỗi từng dòng và nút Tạo tài khoản disabled. Fixture không được gửi server.
- Import thành công và credential tạm chỉ xác nhận từ mã. Không chụp/giả lập mật khẩu mới để đưa vào tài liệu.

## Editor và đồng hồ

- Toolbar phải nhớ selection trước click; `pointerdown` trên button ngăn mất selection, restore rồi áp định dạng. Màu select phủ lên icon A, không dùng color picker tự do.
- Các màu chữ: default `#283f36`, blue `#295da8`, pink `#8a315a`, green `#397045`, brown `#8b4d20`.
- Nhập “Một trang viết minh họa.” cho kết quả5 từ; đã chọn toàn bộ/in đậm trong nháp local, chụp rồi xóa nháp. Không tạo submission mới.
- Clock hidden→open lần đầu khởi chạy; Bắt đầu/Tạm dừng/Tiếp tục/Đặt lại phụ thuộc elapsed/since. Ẩn panel không có nghĩa đồng hồ tự dừng. Nộp bài gọi pauseClock.
- Tick500ms; trạng thái cây index `min(3,floor(3×elapsed/(goal×60000)))`; goal mặc định30, min1/max240. Không nhầm chu kỳ cây đồng hồ bốn giai đoạn với khu vườn bài viết ba nhóm.
- sessionStorage draft/format/clock tách theo user+assignment. Chỉ tồn tại theo phiên; không dùng nhãn “Đã lưu lên hệ thống”.

## Chấm bài và rubric

- Chọn text trong essay bằng pointer hoặc keyboard; lưu offsets và quote. Click Bình luận mở editor; Cancel đóng; thiếu selection hiện status “Hãy chọn đoạn cần đánh dấu trong bài làm.”
- Tô màu/nhận xét sửa local array; tối đa50 marks; đoạn≤2000 ký tự; note≤3000. Lưu bình luận không đồng nghĩa lưu lên server; cần Lưu và trả bài.
- Rà lỗi cơ bản đã chạy với bài thật rất ngắn, kết quả không có dấu hiệu. Khi có lỗi, code tạo danh sách gợi ý và “Ghi vào bài”; nhánh populated chưa có screenshot live.
- Select điểm và details mô tả độc lập; không có live score-total component trong live. CSV và DOCX đã tải thành công; chưa chọn điểm rồi trả bài.
- Tab rubric click dựng panel khác; marker details native; có thể mở nhiều tiêu chí. Đã chụp tab0/1/2/3 với tiêu chí đầu mở.

## Garden và thư viện

- Garden click chỉ thay selected border/ring, title và danh sách; không đổi ảnh theo hover, không cuộn tự động tới list. “Xem tất cả” reset mọi aria-pressed=false.
- Mầm/Hoa/Quả được thử trong snapshot0/1/0; đã thấy hai empty states và danh sách nhóm Hoa. Nhóm Quả populated chưa có dữ liệu.
- Thư viện file→link: hide file input/disable/required=false; show URL/enable/required=true. Chuyển lại đảo trạng thái. Đã mở cả hai.
- All/favorites đổi aria-pressed và nội dung list; không có CSS nút active riêng. Đã chụp yêu thích trống; chưa star vì thư viện không có tài liệu.
- Reader PDF/TXT, download và trạng thái upload thành công chưa có baseline live. Dùng đặc tả CSS/source để dựng ban đầu, bổ sung baseline khi có fixture được phép.

## Khác biệt demo phải giữ riêng

Demo có notice nền vàng, nút switch-role, hạn nộp, editor giao bài có sidebar rubric preview, table chấm5 cột, score total, lưu nháp, dialog phiên bản và nút AI chỉ báo chưa kết nối. Các screenshot `demo-*` được ghi riêng trong INDEX. Không dùng chúng để suy ra live đã có những control tương tự.

## Gaps và cách nghiệm thu

Những state chưa quan sát trực tiếp: API failure/retry, invalid login, forced password reset, backend validation, thành công nghiệp vụ ghi, đủ100 submission, populated library reader, returned submission, AI. Cần fixture/test account được phép để xác nhận sau; không hạ yêu cầu UX nhưng cũng không đánh dấu “đã kiểm thử”. Trước khi nhận diện pixel >90%, phải so cùng state và cùng dữ liệu; thử tương tác riêng để tránh giao diện tĩnh đạt điểm nhưng nút không hoạt động.
