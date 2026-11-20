# Rà soát chức năng — quyết định sau phiên grill

Ngày ghi nhận: 20/11/2026. Trạng thái: **Đã xác nhận 42 quyết định nghiệp vụ trong phiên rà soát. Các điểm kỹ thuật cần thiết kế tiếp được ghi riêng ở mục 3. Chưa triển khai ứng dụng.**

Nguồn: người dùng yêu cầu review [FEATURES.MD](../../FEATURES.MD) và trả lời lần lượt các câu hỏi về phạm vi sản phẩm. Tài liệu này bổ sung [Admin–Drive–Markdown](ADMIN-DRIVE-MARKDOWN.md). FEATURES.MD tiếp tục mô tả website tham chiếu, không được sửa thành danh sách chức năng đã triển khai của sản phẩm mới.

Khi có khác biệt, áp dụng quyết định mới tại đây. Đặc biệt F40 thay phần hỗ trợ liên kết ngoài của F15; F29 làm rõ ngoại lệ lưu rubric dùng chung trong database.

## 1. Sổ quyết định

Mã F tương ứng số câu hỏi trong phiên review, tách biệt với D01–D24 của phiên trước.

| ID | Chọn | Quyết định đã xác nhận |
|---|---|---|
| F01 | A | Tự lưu nháp chấm lên Drive; học sinh chỉ xem điểm/nhận xét khi giáo viên bấm Trả bài. |
| F02 | A | Sửa kết quả đã trả trong nháp riêng; học sinh tiếp tục thấy kết quả đã công bố cho đến khi Trả lại bài. Giữ lịch sử công bố. |
| F03 | A | Cho nộp bản mới khi bản cũ chưa chấm xong. Hàng chờ ưu tiên bản mới nhất; giữ phần chấm dở của bản cũ và vẫn cho chấm/trả bản đó. Không tự chuyển nhận xét sang bản mới. |
| F04 | B | Kết quả tổng hợp chỉ xét bản nộp mới nhất. Bản mới chưa trả thì hiện Chờ chấm, không lấy điểm bản cũ thay thế; điểm bản cũ vẫn có trong lịch sử các lần nộp. Khu vườn trở về Hoa. |
| F05 | A | Có hội thoại nhiều lượt giữa giáo viên và học sinh dưới từng nhận xét đã trả, gắn với đúng phiên bản bài nộp. |
| F06 | B | Nhận xét đã có phản hồi không được sửa/xóa; giáo viên đính chính bằng tin nhắn mới. |
| F07 | C | Admin quản lý rubric dùng chung; giáo viên chỉ chọn, không tự tạo/sửa rubric riêng. |
| F08 | A | Bài đã giao giữ nguyên rubric và thang điểm. Cập nhật rubric chỉ áp dụng cho bài giao mới; rubric ngừng dùng vẫn đọc được ở bài cũ. |
| F09 | C | Không sửa đề đã giao; muốn thay đổi phải tạo bài giao mới. |
| F10 | A | Tự lưu nháp bài giao lên Drive, cho sửa trước khi bấm Giao bài. Học sinh chỉ thấy sau khi công bố; đề, rubric và thang điểm được cố định khi giao. |
| F11 | A | Hạn nộp không bắt buộc; quá hạn vẫn được nộp và đánh dấu Nộp muộn trên từng phiên bản. |
| F12 | A | Giáo viên đóng/mở lại bài thủ công, độc lập với hạn nộp. Khi đóng, học sinh được xem/tải nháp nhưng không sửa hoặc nộp thêm; giáo viên vẫn chấm, hai bên vẫn trao đổi. |
| F13 | A | Tham chiếu mặc định chỉ giáo viên xem. Được công khai cho cả lớp khi bài đã đóng; sau khi công khai không được mở lại để nhận thêm bản nộp. |
| F14 | A | Tài liệu thư viện mặc định riêng tư với giáo viên; chọn chia sẻ cho một hoặc nhiều lớp của mình. |
| F15 | A | Thêm PDF/TXT, liên kết và tài liệu soạn Markdown; tệp và Markdown lưu trên Drive giáo viên. **Phần liên kết đã bị F40 loại khỏi bản đầu.** |
| F16 | B | Xóa tài liệu khỏi thư viện và chuyển file do ứng dụng quản lý vào thùng rác Drive. Nhánh gỡ liên kết ngoài trong lựa chọn gốc không còn áp dụng sau F40. |
| F17 | A | Bản đầu không triển khai AI; bỏ các nút và tùy chọn AI. |
| F18 | A | Cho lưu trữ/khôi phục lớp. Lớp lưu trữ ẩn khỏi danh sách hoạt động, chỉ đọc lịch sử; dừng giao bài, viết, nộp, chấm và trao đổi. |
| F19 | A | Học sinh rời lớp vẫn đọc bài đã nộp, đề tương ứng và nhận xét đã trả của mình; mất quyền đọc thư viện và bài chưa nộp, không được viết/nộp/trao đổi. Giáo viên giữ lịch sử; tài khoản chung và lớp khác không bị ảnh hưởng. |
| F20 | C | Chỉ giáo viên được đưa học sinh ra khỏi lớp; chưa có yêu cầu hoặc thao tác tự rời lớp của học sinh. |
| F21 | A | Khi nhận lại học sinh, khôi phục membership và lịch sử cũ; chỉ tiếp tục viết/nộp ở bài còn mở. |
| F22 | A | Học sinh mới vào lớp tự nhận các bài đang mở, kể cả bài quá hạn và áp dụng quy tắc nộp muộn. Không nhận bài đã đóng. |
| F23 | B | Giữ CSV bảng điểm; bài viết/nhận xét tải dạng Markdown. Bản đầu chưa xuất DOCX. |
| F24 | A | Giữ bật/ẩn đồng hồ, tạm dừng, tiếp tục, đặt lại và mốc nở hoa trên thiết bị. Không dùng thời gian này để chấm điểm hoặc báo cáo thời gian học. |
| F25 | A | Có trung tâm thông báo trong ứng dụng, trạng thái chưa đọc và liên kết tới nội dung liên quan; chưa có email/push. Bao gồm bài mới, trả bài và phản hồi trao đổi. |
| F26 | A | Trong ứng dụng, giáo viên chỉ đọc bài đã nộp; không có quyền mở nháp học sinh qua UI/API. Chủ Drive vẫn có thể đọc file trực tiếp trên Drive. |
| F27 | A | Giải thích chỉnh sửa không bắt buộc; tự lưu cùng nháp và gắn với từng lần nộp. |
| F28 | A | Tham chiếu không bắt buộc để giao/chấm bài; chỉ công khai khi có nội dung. |
| F29 | A | Rubric mẫu do admin quản lý lưu trong database hệ thống. Khi giao bài, lưu bản rubric cố định trên Drive giáo viên. Đây là ngoại lệ cho cấu hình dùng chung; bài viết, điểm và nhận xét vẫn chỉ lưu chính thức trên Drive. |
| F30 | A | Nháp chấm được thiếu điểm; Trả bài phải có đủ điểm mọi tiêu chí. Nhận xét chung không bắt buộc. |
| F31 | A | Nháp chấm lưu riêng. Mỗi lần Trả bài/Trả lại bài tạo bản công bố mới, giữ nguyên nội dung các bản công bố trước. |
| F32 | A | Giữ nút Rà lỗi cơ bản theo quy tắc, không dùng AI. Giáo viên chọn gợi ý đưa vào nhận xét; không sửa bài gốc hoặc tự trừ điểm. |
| F33 | A | Được sửa thông tin/Markdown, thay PDF/TXT của tài liệu đã chia sẻ; học sinh thấy bản cập nhật sau khi Lưu thay đổi. Giữ phạm vi chia sẻ và lượt yêu thích. Nhánh sửa liên kết ngoài không áp dụng sau F40. |
| F34 | B | Không có bản demo công khai trong bản đầu; bỏ liên kết Xem bản trải nghiệm khỏi trang đăng nhập. |
| F35 | A | Trang chính và khu vườn tổng hợp các lớp đang tham gia, có bộ lọc lớp/giáo viên. Bài ghi rõ lớp và giáo viên; số Mầm–Hoa–Quả theo bộ lọc hiện tại. |
| F36 | A | Bài đã đóng mà chưa nộp không tính vào Mầm; vẫn hiện trong danh sách với trạng thái Đã đóng — chưa nộp. Mở lại thì trở về Mầm. |
| F37 | B | Chỉ giáo viên xem lịch sử sửa kết quả. Học sinh chỉ thấy kết quả công bố hiện hành của từng phiên bản bài nộp; không thấy nháp chấm hoặc nội dung công bố đã bị thay thế. |
| F38 | A | Tin nhắn hội thoại đã gửi không được sửa/xóa; đính chính bằng tin mới. |
| F39 | A | Giáo viên chọn tài liệu nổi bật theo lớp để hiện trên trang chính học sinh; chỉ hiển thị cho người có quyền đọc tài liệu. |
| F40 | C | Bản đầu không hỗ trợ liên kết ngoài trong thư viện; chỉ PDF/TXT và tài liệu Markdown lưu trên Drive qua ứng dụng. Quyết định này thay phần liên kết ở F15, F16 và F33. |
| F41 | A | Được gia hạn, không rút ngắn hạn đã công bố. Thông báo cho học sinh, tính lại nhãn Nộp muộn theo hạn mới và giữ lịch sử đổi hạn. |
| F42 | A | Chỉ học sinh đã được giao bài mới xem đề và tham chiếu công khai. Muốn chia sẻ cho học sinh vào sau khi bài đã đóng, giáo viên đưa nội dung vào thư viện lớp. |

## 2. Các điểm cần kết hợp khi thiết kế

Các mục này giải thích cách áp dụng đồng thời các quyết định, không tự bổ sung tính năng mới.

### Bài nộp và lần công bố kết quả là hai loại phiên bản

- Một bài nộp có thể có nhiều lần công bố kết quả chấm. Nháp chấm không phải kết quả đã công bố.
- Giáo viên xem các lần công bố; học sinh xem kết quả hiện hành của mỗi bài nộp.
- Nếu lần nộp 2 đang chờ chấm thì kết quả tổng hợp vẫn Chờ chấm, kể cả giáo viên vừa trả lại kết quả của lần nộp 1. Không dùng thời điểm trả bài để chọn bản nộp mới nhất.
- CSV/Markdown xuất cho từng vai trò phải tuân thủ quyền xem; không để thao tác tải xuống làm lộ nháp chấm hoặc lịch sử công bố đã ẩn với học sinh.
- File `.review.md` duy nhất ở ví dụ cũ không đủ diễn tả F31. Cần nháp riêng và các bản công bố Markdown riêng; tên file/schema chưa chốt.

### Trạng thái đóng bài, lớp và membership

- Quá hạn không tự đóng bài; nộp muộn vẫn được nếu bài đang mở và các quyền khác còn hiệu lực.
- Gia hạn thay đổi nhãn nộp muộn theo hạn mới, không thay nội dung/thời điểm của bản nộp và không tự mở lại bài đã đóng.
- Đóng bài không ngừng chấm/trao đổi; lưu trữ lớp ngừng cả chấm/trao đổi.
- Quyền ghi còn phụ thuộc trạng thái giáo viên theo D17. Mở lại bài không tự vượt qua trạng thái khóa giáo viên, lớp lưu trữ hoặc học sinh đã rời lớp.
- Bài đã công khai tham chiếu không mở lại. Khôi phục lớp hoặc membership không tự mở lại bài đó.
- Học sinh mới không nhận bài đã đóng. Công khai tham chiếu không cấp quyền đọc đề/tham chiếu cho người chưa được giao bài; giáo viên dùng thư viện nếu muốn chia sẻ với học sinh vào sau (F42).

### Nội dung trên Drive và dữ liệu quản lý

- Database được lưu rubric mẫu dùng chung theo F29. Bản rubric dùng để chấm bài đã giao được cố định trên Drive giáo viên.
- Nháp chấm, kết quả công bố, hội thoại và các bản lịch sử có nội dung vẫn chịu quy tắc không lưu nội dung chính thức lâu dài trên server. Schema Markdown cho hội thoại chưa chốt.
- Thông báo chỉ được đưa người dùng tới nội dung họ còn quyền xem. Thiết kế metadata thông báo không được vô tình lưu nguyên văn bài/nhận xét trong database.
- Quy tắc giáo viên không xem nháp chỉ áp dụng trong ứng dụng; không thể ngăn chủ Drive đọc trực tiếp file họ sở hữu.

### Thư viện và nội dung nổi bật

- F40 bỏ phương thức thêm liên kết ngoài. Điều này không tự cấm cú pháp liên kết trong bài Markdown vốn đã được chốt ở D10–D12.
- Xóa tài liệu khỏi thư viện phải làm mất mục giới thiệu tương ứng với học sinh; lượt yêu thích không cấp thêm quyền đọc file đã xóa.
- Thay nội dung tài liệu giữ phạm vi chia sẻ, nhưng mở/tải tài liệu vẫn phải kiểm tra quyền tại thời điểm truy cập.

## 3. Các điểm còn cần thiết kế kỹ thuật

Các quyết định nghiệp vụ trên là đầu vào thiết kế. Những chi tiết dưới đây chưa được triển khai hoặc kiểm chứng; không tự xem một phương án kỹ thuật là đã được người dùng chọn.

- Khi tải/sửa/xóa file thư viện thất bại trên Drive: trạng thái thành công một phần và cách thử lại cần được thiết kế.
- Schema lưu hội thoại, rubric snapshot, nháp chấm và các lần công bố; xử lý đồng thời khi học sinh trả lời nhận xét mà giáo viên đang sửa trong nháp.
- Luồng công bố kết quả cần xử lý nhất quán giữa file Drive, metadata trạng thái và thông báo; thử lại không tạo trùng lần công bố.
- Quyền đọc/tải file theo membership, bài được giao, lớp lưu trữ, giáo viên bị khóa và trạng thái công bố phải được kiểm tra ở backend.
- Thiết kế giao diện mới và kiểm chứng editor/annotation theo các điểm kỹ thuật đã nêu trong đặc tả Admin–Drive–Markdown.

## 4. Đối chiếu với FEATURES.MD

| Nhóm nguồn | Quyết định sản phẩm mục tiêu |
|---|---|
| AUTH, bản trải nghiệm | Giữ xác thực theo D01–D24; F34 bỏ demo công khai. |
| HOME, GARDEN | F04, F35, F36 xác định tổng hợp nhiều lớp và bản mới nhất; F39 thêm tài liệu nổi bật có quyền theo lớp. |
| CLASS, STUDENT, IMPORT | D19–D22 xử lý tài khoản chung và duyệt lớp; F18–F22 bổ sung vòng đời lớp/membership. |
| TASK | F08–F13, F28, F41–F42: nháp, đề bất biến, hạn mềm/gia hạn, đóng bài và quyền đọc tham chiếu tùy chọn. |
| WRITE, CLOCK | D07, D10–D16 cùng F03, F24, F26, F27; Markdown thay editor gốc, đồng hồ chỉ phục vụ trải nghiệm. |
| REVIEW | F01–F06, F23, F30–F32, F37–F38; nháp/công bố tách biệt, hội thoại, rà lỗi và xuất Markdown/CSV. |
| RUBRIC | F07–F08, F29; admin quản lý cấu hình chung, cố định bản dùng cho từng bài giao. |
| LIB | F14–F16, F33, F39–F40; quyền theo lớp, PDF/TXT/Markdown, sửa/xóa và giới thiệu; không thêm liên kết ngoài. |
| AI và chức năng chưa có | F17 bỏ AI; F25 thêm thông báo trong ứng dụng. |

## 5. Bổ sung Q01 — người nhận khi mở lại bài

**Q01-B — Người dùng xác nhận ngày 20/11/2026:** khi giáo viên mở lại bài chưa công khai tham chiếu, tự giao bổ sung cho học sinh có membership đang hoạt động trong lớp chưa nhận bài, gồm người được duyệt lúc bài đóng; gửi một thông báo bài mới cho mỗi recipient mới. Giữ recipient và lịch sử cũ, không gửi lại thông báo giao bài cho người đã nhận.

Quyết định này bổ sung F12/F22/F42; không đổi mã hoặc nội dung 42 quyết định trước. Không cấp cho yêu cầu chưa duyệt, học sinh đã rời lớp hoặc lớp khác. Mở lại vẫn bị chặn nếu tham chiếu đã công khai, lớp lưu trữ hoặc giáo viên bị khóa. Hạn nộp không tự thay đổi. Recipient mới chưa nộp được tính vào Mầm; người đã nộp vẫn tính theo bản nộp mới nhất.

Retry và duyệt/mở lại đồng thời phải không bỏ sót hoặc tạo trùng recipient/thông báo. Quyết định đã chốt; triển khai và nghiệm thu còn cần làm ở T22 của kế hoạch agent3.
