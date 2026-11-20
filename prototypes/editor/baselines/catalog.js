export const viewports = [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }];

// Exact role, scene and fixture are versioned together with the captures.
export const scenes = [
  ['login', 'public', 'Vào khu vườn của mình', 'Form chưa nhập', 'Tài khoản và mật khẩu trống', 'F34 bỏ mục trải nghiệm công khai.'],
  ['password', 'student', 'Đổi mật khẩu', 'Đổi mật khẩu tạm bắt buộc', 'Bình đăng nhập lần đầu, chỉ thấy form đổi mật khẩu', 'D03 và D22 yêu cầu đổi trước khi mở chức năng.'],
  ['admin-teachers', 'admin', 'Giáo viên', 'Danh sách và tác vụ quản trị', 'Cô An hoạt động, cô Mai bị khóa', 'Role admin mới, tác vụ khóa và xem trạng thái Drive.'],
  ['admin-reset', 'admin', 'Tài khoản học sinh', 'Xác nhận đặt lại mật khẩu', 'Bình dùng chung tài khoản ở hai lớp', 'D20 chuyển đặt lại mật khẩu học sinh sang admin.'],
  ['admin-rubrics', 'admin', 'Rubric mẫu', 'Quản trị phiên bản', 'Đoạn nghị luận xã hội, phiên bản 1', 'F07/F29 thêm quyền quản trị rubric mẫu riêng cho admin.'],
  ['drive', 'teacher', 'Kết nối Google Drive', 'Mất quyền, kết nối lại', 'Drive cô An, thư mục Vườn Văn', 'Google OAuth, Picker và reconnect là luồng mới.'],
  ['teacher-home', 'teacher', 'Góc vườn của cô An', 'Tổng quan', '10A1, một bài đang mở, một bài chờ chấm', 'Thanh điều hướng có thông báo và mục Drive.'],
  ['classes', 'teacher', 'Lớp học của tôi', 'Danh sách và lớp lưu trữ', '10A1 hoạt động, 10A2 lưu trữ', 'F18 thêm danh sách lưu trữ và quyền khôi phục.'],
  ['class-members', 'teacher', 'Lớp 10A1', 'Danh sách thành viên và duyệt', 'An đã tham gia, Bình chờ duyệt', 'D21/F19 thêm duyệt/rời/nhận lại, bỏ reset ở giáo viên.'],
  ['class-import', 'teacher', 'Lớp 10A1', 'Xem trước nhập CSV', 'Một dòng hợp lệ, một username đã có', 'D22 xử lý username hiện có qua xin duyệt.'],
  ['join-class', 'student', 'Tham gia lớp', 'Yêu cầu đang chờ duyệt', 'Bình gửi mã VV10A1', 'D21 thêm màn nhập mã và trạng thái chờ.'],
  ['teacher-assignments', 'teacher', 'Bài giao', 'Danh sách mở và đóng', 'Mùa xuân đang mở, Giọt mưa đã đóng', 'F10–F13 thêm trạng thái, hạn và tham chiếu.'],
  ['assignment-author', 'teacher', 'Giao bài mới', 'Nháp đề chưa giao', 'Mùa xuân trong vườn, 10A1, rubric chuẩn và thang điểm bài đều 2', 'TASK-04 chọn thang điểm. F10/F17/F28 thêm nháp, bỏ AI, tham chiếu tùy chọn.'],
  ['assignment-reopen', 'teacher', 'Mùa xuân trong vườn', 'Xác nhận mở lại', 'An đã nhận, Bình vào lớp khi bài đóng', 'Q01-B cần giải thích việc giao bổ sung và thông báo.'],
  ['teacher-rubrics', 'teacher', 'Rubric', 'Cấu hình chỉ đọc', 'Rubric khảo sát bộ 0, các tiêu chí đóng', 'Dữ liệu nguồn giữ được. Shell có thông báo và Drive nên cần baseline đích.'],
  ['student-rubrics', 'student', 'Rubric', 'Cấu hình chỉ đọc', 'Rubric khảo sát bộ 0, các tiêu chí đóng', 'Dữ liệu nguồn giữ được. Shell có thông báo và mục lớp nên cần baseline đích.'],
  ['teacher-grading', 'teacher', 'Chấm & trả bài', 'Hàng chờ theo bản nộp', 'An có lần 2 chờ chấm, lần 1 đã trả', 'F03/F04 thêm bản hiện hành và lịch sử.'],
  ['review-draft', 'teacher', 'Chấm bài', 'Nháp nhận xét theo đoạn', 'An, lần nộp 2, một đoạn tô vàng, mới chấm 2/5 tiêu chí', 'F01/F30 tách nháp và yêu cầu đủ điểm để công bố.'],
  ['review-republish', 'teacher', 'Chấm bài', 'Trả lại bài và lịch sử', 'An, lần nộp 1, đã có công bố và phản hồi, nháp đủ 5/5 tiêu chí', 'F02/F06/F31 thêm lịch sử, khóa nhận xét có phản hồi. F30 kiểm đủ điểm.'],
  ['student-home', 'student', 'Góc vườn của em', 'Bài tập từ nhiều giáo viên', 'Cùng bốn bài với khu vườn, mặc định hiện cả hai lớp và hai giáo viên', 'F35/F39 thêm phạm vi nhiều lớp và tài liệu nổi bật.'],
  ['student-assignments', 'student', 'Bài được giao', 'Bài mở và đóng chưa nộp', 'Mùa xuân mới được giao, Giọt mưa đã đóng', 'F36 tách bài đóng chưa nộp khỏi Mầm.'],
  ['student-editor', 'student', 'Mùa xuân trong vườn', 'Trực quan, đã lưu nháp và đồng hồ', 'Bình, nháp tiếng Việt, mốc 25 phút', 'D10/D12 đổi toolbar, F24 giữ đồng hồ cục bộ.'],
  ['student-source', 'student', 'Mùa xuân trong vườn', 'Mã nguồn và chưa đồng bộ', 'Bình, nội dung nháp còn trên thiết bị', 'D05/D15 cần hiển thị chưa sync và tải dự phòng.'],
  ['student-result', 'student', 'Kết quả bài viết', 'Nhận xét hiện hành và hội thoại', 'An xem lần 1, một nhận xét có phản hồi', 'F05/F37/F38 giữ hội thoại và chỉ công bố hiện hành.'],
  ['garden', 'student', 'Khu vườn của em', 'Lọc theo lớp và giáo viên', '10A1 cô An có một Mầm và một Hoa. 10B1 cô Mai có một Quả và một bài đóng chưa nộp', 'F04/F35/F36 thay phép đếm và phạm vi bộ lọc.'],
  ['teacher-library', 'teacher', 'Thư viện', 'Chia sẻ và chọn tài liệu nổi bật', 'Hạt mầm và trang viết, chia sẻ 10A1', 'F33/F39/F40 thêm thay, quản lý chia sẻ, bỏ thêm liên kết ngoài.'],
  ['student-library', 'student', 'Thư viện', 'Danh sách được chia sẻ và yêu thích', 'Một tài liệu từ 10A1 đã yêu thích', 'F14/F19 quyền đọc theo lớp, dữ liệu mới và shell đổi.'],
  ['library-reader', 'student', 'Đọc tài liệu', 'Reader Markdown có tải xuống', 'Hạt mầm và trang viết, có heading và trích dẫn', 'F23/F40 thêm đọc/tải Markdown do ứng dụng quản lý.'],
  ['notifications', 'student', 'Thông báo', 'Chưa đọc và đã đọc', 'Bài mới Q01-B, bài được trả, hạn nộp mới', 'F25 thêm trung tâm thông báo, không lộ trích đoạn.']
].map(([id, role, title, state, fixture, reason]) => ({ id, role, title, state, fixture, reason }));
