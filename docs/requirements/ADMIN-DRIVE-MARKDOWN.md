# Admin, Google Drive và Markdown — đặc tả sau phiên grill

Ngày ghi nhận: 19/11/2026. Cập nhật: 20/11/2026. Trạng thái: **Các quyết định nghiệp vụ đã được thống nhất và tổng hợp vào [README](../../README.md) theo yêu cầu người dùng. Chi tiết kỹ thuật còn cần thiết kế/kiểm chứng; chức năng chưa được triển khai.**

Tài liệu này mô tả chức năng dự kiến bổ sung/thay đổi. [FEATURES.MD](../../FEATURES.MD) và [DESGIN.MD](../../DESGIN.MD) vẫn là bằng chứng về hệ thống tham chiếu đã khảo sát; không coi nội dung dưới đây là chức năng đã triển khai.

**Bổ sung từ phiên review chức năng:** xem [FEATURES-REVIEW.md](FEATURES-REVIEW.md). Quyết định mới được ưu tiên ở các điểm giao nhau, gồm ngoại lệ rubric mẫu trong database (F29), các bản công bố kết quả chấm riêng (F31) và phạm vi thư viện không có liên kết ngoài (F40). Các ví dụ file bên dưới là minh họa của phiên trước, chưa phải schema đáp ứng đầy đủ quyết định mới.

## 1. Phạm vi và mô hình sở hữu

- Nhiều giáo viên hoạt động độc lập; không có cấp trường/trung tâm hoặc admin tổ chức trong phạm vi đã chốt.
- Mỗi giáo viên có lớp, bài giao và kết nối Google Drive riêng. Giáo viên không được đọc dữ liệu giảng dạy của giáo viên khác.
- Một học sinh có **một tài khoản dùng cho nhiều giáo viên**. Nội dung từng lớp vẫn thuộc không gian của giáo viên phụ trách và được lưu trên Drive của giáo viên đó.
- Admin quản lý tài khoản giáo viên và khôi phục tài khoản học sinh; không có quyền đọc bài viết, điểm, nhận xét hoặc tải nội dung học tập bằng role admin.
- Drive của giáo viên là **nơi lưu nội dung chính thức duy nhất**. Máy chủ ứng dụng không lưu bản sao nội dung lâu dài.
- Bản nháp cục bộ trên thiết bị được cho phép, gồm cả khi Drive mất kết nối. Bản nháp cục bộ chưa đồng bộ không được xem là bài đã nộp.

## 2. Sổ quyết định đã xác nhận

| ID | Quyết định |
|---|---|
| D01 | Giáo viên hoạt động độc lập, không tổ chức theo trường/trung tâm. |
| D02 | Admin quản lý tài khoản, không đọc nội dung học tập bằng quyền admin. |
| D03 | Admin cấp tài khoản/mật khẩu tạm cho giáo viên; bắt buộc đổi mật khẩu lần đầu. |
| D04 | Nội dung chính thức chỉ nằm trên Drive; không có bản sao lâu dài trên máy chủ. |
| D05 | Nếu nộp thất bại, giữ nháp cục bộ, cho thử lại và tải `.md`; không tự nộp lại thay học sinh. |
| D06 | Học sinh chỉ sử dụng Vườn Văn; không cần Google hoặc quyền chia sẻ file Drive trực tiếp. |
| D07 | Mỗi lần nộp tạo file `.md` riêng, giữ lịch sử từng phiên bản. |
| D08 | Giữ tô màu, bình luận theo đoạn, rubric và nhận xét chung; không sửa nội dung bài gốc khi chấm. |
| D09 | Cả bài viết và nhận xét đều dùng file `.md`; không dùng file `.json` phụ cho dữ liệu chấm. |
| D10 | Editor trực quan mặc định, có chế độ xem/sửa mã Markdown, cho cả giáo viên/học sinh. |
| D11 | Chỉ giáo viên được chèn ảnh; ảnh nằm trên Drive của giáo viên. |
| D12 | Nội dung soạn thảo dùng Markdown thuần; bỏ gạch chân và màu chữ của editor cũ. |
| D13 | Phát hiện bài nộp bị sửa ngoài hệ thống thì báo xung đột và khóa chấm phiên bản đó; bị xóa thì báo không tìm thấy. |
| D14 | Giáo viên chọn thư mục cha; ứng dụng tạo thư mục “Vườn Văn” bên trong. |
| D15 | Nháp tự lưu cục bộ và đồng bộ Drive, hỗ trợ tiếp tục viết trên thiết bị khác. |
| D16 | Mỗi nháp chỉ có một phiên chỉnh sửa; có thao tác chuyển quyền viết sang tab/thiết bị khác. |
| D17 | Khi giáo viên bị khóa, học sinh chỉ xem dữ liệu đã lưu nếu Drive còn truy cập được; không sửa/nộp thêm. |
| D18 | Sau khi có dữ liệu, bản đầu chỉ cho kết nối lại cùng tài khoản Drive; chưa chuyển sang tài khoản khác. |
| D19 | Học sinh dùng chung một tài khoản giữa các giáo viên. |
| D20 | Admin reset mật khẩu học sinh; giáo viên không reset tài khoản học sinh dùng chung. |
| D21 | Học sinh đã có tài khoản nhập mã lớp rồi chờ giáo viên duyệt. |
| D22 | Giáo viên cấp tài khoản học sinh mới, từng người hoặc qua CSV; bắt buộc đổi mật khẩu lần đầu. |
| D23 | Giáo viên được quản lý lớp/tài khoản trước khi kết nối Drive; tạo nội dung cần hoàn tất kết nối. |
| D24 | Admin được tin cậy; giới hạn đọc nội dung là phân quyền theo role, không phải bảo đảm ngăn admin sử dụng mật khẩu tạm mình biết. Cấp/reset phải có nhật ký. |

## 3. Tài khoản và quyền

### 3.1. Admin

- Thêm giáo viên, cấp mật khẩu tạm, quản lý trạng thái khóa/mở khóa tài khoản giáo viên.
- Giáo viên phải đổi mật khẩu tạm trước khi sử dụng chức năng khác.
- Admin xem thông tin quản lý tài khoản và trạng thái kết nối Drive, không đọc nội dung trên Drive.
- Admin được reset mật khẩu tài khoản học sinh dùng chung; không bắt buộc học sinh có email để tự khôi phục mật khẩu trong phạm vi đã chọn.
- Các thao tác cấp/reset tài khoản có nhật ký. Nhật ký không ghi mật khẩu tạm hoặc nội dung học tập.
- Admin là vai trò vận hành được tin cậy. Không tuyên bố cơ chế RBAC có thể ngăn người biết mật khẩu tạm đăng nhập bằng mật khẩu đó.

### 3.2. Giáo viên

- Đăng nhập bằng tài khoản Vườn Văn; Google Drive là kết nối riêng, không thay thế đăng nhập hệ thống.
- Trước khi kết nối Drive: được tạo lớp, cấp tài khoản học sinh, duyệt yêu cầu tham gia lớp.
- Phải kết nối Drive và chọn thư mục trước khi bắt đầu sử dụng chức năng soạn/lưu nội dung, giao bài và chấm bài.
- Được cấp tài khoản học sinh mới từng người hoặc qua CSV. Username học sinh phải duy nhất toàn hệ thống.
- Sau khi cấp, giáo viên không được reset mật khẩu tài khoản học sinh dùng chung; chức năng reset hiện có trong bản tham chiếu phải được chuyển sang admin.
- Khi CSV gặp username đã tồn tại, không đổi mật khẩu hoặc tự đưa tài khoản đó vào lớp. Hiển thị hướng dẫn dùng tài khoản hiện có để nhập mã lớp và chờ duyệt. Đây là hệ quả của D20/D21; không sử dụng nhánh “thêm membership ngay” của bản cũ.

### 3.3. Học sinh

- Tài khoản được giáo viên cấp; bắt buộc đổi mật khẩu tạm lần đầu.
- Dùng cùng tài khoản cho nhiều giáo viên. Không yêu cầu tài khoản Google.
- Với lớp của giáo viên khác: nhập mã lớp → gửi yêu cầu → giáo viên duyệt → mới được đọc đề và nộp bài.
- Chỉ thấy bài làm, nhận xét và tài liệu mà mình có quyền truy cập; không được nhìn bài của học sinh khác chỉ vì học chung lớp.
- Không được chia sẻ trực tiếp file/thư mục Drive của giáo viên. Vườn Văn kiểm tra quyền khi đọc/ghi nội dung.

## 4. Kết nối và tổ chức Drive

- Giáo viên cấp quyền kết nối Google Drive bằng luồng riêng sau đăng nhập Vườn Văn.
- Giáo viên chọn thư mục cha. Ứng dụng tạo thư mục “Vườn Văn” riêng trong thư mục đó.
- Cấu trúc nghiệp vụ: **Lớp → Bài giao → Học sinh → Các phiên bản**. Đề bài, ngữ liệu và ảnh thuộc thư mục bài giao.
- Bản nháp cập nhật trong file `.draft.md`; bài nộp mỗi lần một file mới; nhận xét gắn với đúng phiên bản trong file `.review.md` riêng.
- Điểm, bình luận, tọa độ/vị trí đánh dấu cần được biểu diễn có cấu trúc trong file nhận xét Markdown. Không thêm file JSON riêng cho phần chấm bài.
- Tên file cụ thể, ID ổn định, schema metadata và cách biểu diễn vị trí đánh dấu là chi tiết triển khai; ví dụ dưới đây không phải schema đã chốt:

```text
<Thư mục cha do giáo viên chọn>/
└── Vườn Văn/
    └── <Lớp>/
        └── <Bài giao>/
            ├── de-bai.md
            ├── tham-chieu.md
            ├── assets/
            └── <Học sinh>/
                ├── bai-lam.draft.md
                ├── lan-01.md
                ├── lan-01.review.md
                ├── lan-02.md
                └── lan-02.review.md
```

- Sau khi có dữ liệu, không hỗ trợ chuyển sang tài khoản Google khác trong bản đầu. Cho kết nối lại cùng tài khoản khi mất quyền truy cập.
- Nếu Drive không truy cập được, nội dung chưa có trong nháp cục bộ sẽ không được bảo đảm có sẵn. Không dựng màn hình giả như thể nội dung đã tải thành công.
- Khóa giáo viên không xóa file hoặc thu hồi kết nối theo cách khiến chế độ chỉ đọc của học sinh mất tác dụng. Việc đọc vẫn phụ thuộc quyền Drive thực tế còn hiệu lực.

## 5. Editor Markdown

- Mặc định là soạn trực quan với toolbar; có thể chuyển sang xem/sửa mã Markdown.
- Áp dụng cho nội dung dài của giáo viên và bài viết học sinh; danh sách field cụ thể sẽ được xác định trong bước thiết kế màn hình.
- Giữ định dạng nội dung Markdown: tiêu đề, đậm/nghiêng, danh sách, trích dẫn, bảng, liên kết.
- Không hỗ trợ gạch chân hoặc chọn màu chữ khi soạn. Không dùng HTML tùy ý để tái tạo các định dạng đã loại bỏ.
- Chỉ giáo viên được chèn ảnh; ảnh lưu riêng trên Drive và được tham chiếu trong Markdown. Quyền này phải áp dụng cả khi nhập ở chế độ mã nguồn.
- Tô màu khi chấm bài là annotation riêng; không phải màu chữ trong nội dung Markdown gốc.
- Chuyển qua lại giữa trực quan/mã nguồn phải giữ nội dung và các định dạng được hỗ trợ.
- MDXEditor là ứng viên theo ví dụ người dùng cung cấp, chưa phải thư viện đã chọn cuối cùng. Cần kiểm chứng vòng chuyển đổi Markdown, ảnh riêng tư và khả năng tích hợp annotation trước khi chốt thư viện.

Tham chiếu đã đọc: [MDXEditor demo](https://mdxeditor.dev/editor/demo), [overview](https://mdxeditor.dev/editor/docs/overview), [getting started](https://mdxeditor.dev/editor/docs/getting-started). MDXEditor cung cấp cách soạn trực quan và lấy nội dung Markdown; khả năng đáp ứng toàn bộ yêu cầu cụ thể của Vườn Văn chưa được thử bằng prototype.

## 6. Nháp, đồng bộ và nộp bài

### 6.1. Nháp

- Lưu cục bộ khi người dùng viết; tự đồng bộ file nháp lên Drive khi kết nối hoạt động.
- Thiết bị khác đọc bản nháp đã đồng bộ gần nhất, không được coi bản chưa lên Drive trên một thiết bị là đã có ở mọi nơi.
- Nếu Drive gặp lỗi, giữ nháp cục bộ và hiển thị chưa đồng bộ; cho tải file `.md` dự phòng.
- Quy định “không tự nộp lại” áp dụng cho hành động nộp bài chính thức. Đồng bộ nháp nền không được tự chuyển nháp thành bài nộp.

### 6.2. Một phiên chỉnh sửa

- Mỗi nháp chỉ có một tab/thiết bị được chỉnh sửa và đồng bộ.
- Mở sau ở chế độ xem; có nút “Tiếp tục viết tại đây” để chuyển quyền chỉnh sửa.
- Khi mất quyền chỉnh sửa, phiên trước dừng đồng bộ và giữ nội dung chưa lưu cục bộ.
- Nếu có nội dung chưa đồng bộ ở nơi trước, báo rõ khi chuyển. Không âm thầm ghi đè bản trên Drive bằng nháp cũ khi thiết bị trước kết nối lại.

### 6.3. Bản nộp

- Mỗi lần nộp tạo file `.md` mới, có số phiên bản và mối liên hệ với học sinh/bài giao.
- Chỉ báo “Đã nộp bài” sau khi ghi Drive thành công và hệ thống ghi nhận được lần nộp tương ứng.
- Không sửa file đã nộp qua editor Vườn Văn. Học sinh sửa ở nháp và nộp thành phiên bản tiếp theo.
- Nộp thất bại: báo “Chưa nộp được”, giữ nháp, cho thử lại hoặc tải `.md`; không tự nộp lại nếu học sinh chưa thực hiện thao tác.
- Từng phiên bản có nhận xét riêng; điểm/đánh dấu không được tự chuyển sang phiên bản mới khi nội dung có thể đã khác.

## 7. Chấm bài và toàn vẹn dữ liệu

- Giữ đánh dấu bằng màu, bình luận theo đoạn, chấm rubric và nhận xét chung.
- File bài gốc không bị chèn thêm điểm/nhận xét. Phần chấm nằm trong file Markdown riêng, có dữ liệu cấu trúc đủ để phục hồi vị trí đánh dấu.
- Metadata phục vụ annotation phải gắn với đúng phiên bản/nội dung gốc, không chỉ tên file có thể đổi hoặc một trích đoạn có thể lặp lại.
- Nếu bài nộp bị sửa trực tiếp trên Drive, báo xung đột và tạm khóa chấm **phiên bản bị ảnh hưởng**. Không tự coi nội dung ngoài hệ thống là bài gốc đã nộp.
- Nếu file bị xóa, báo không tìm thấy. Những phiên bản khác không bị ảnh hưởng vẫn hoạt động.
- Không bảo đảm tự khôi phục được bản gốc do máy chủ không giữ bản sao nội dung lâu dài.
- Cơ chế nhận diện xung đột và quy trình giải quyết cụ thể phải được thiết kế trước khi triển khai; không được dùng việc tự chấp nhận nội dung mới làm mặc định.

## 8. Khóa giáo viên

- Giáo viên bị khóa không đăng nhập được.
- Học sinh vẫn có thể xem nội dung đã lưu của giáo viên đó nếu Drive còn truy cập được.
- Không được sửa nháp, đồng bộ nội dung mới hoặc nộp bài vào không gian bị khóa.
- Quyền của học sinh trong lớp của giáo viên khác không bị khóa theo.
- Không xóa file trên Drive khi khóa tài khoản.

## 9. Hệ quả kỹ thuật và giới hạn

Các điểm dưới đây là suy ra từ các quyết định, không phải tính năng đã được triển khai:

- Ứng dụng vẫn cần lưu dữ liệu quản lý tài khoản, lớp, membership, quyền, trạng thái, định danh file và phiên chỉnh sửa. “Chỉ lưu nội dung trên Drive” không đồng nghĩa toàn hệ thống không có cơ sở dữ liệu.
- File có thể đi qua máy chủ khi ứng dụng xử lý đọc/ghi; không được lưu bản sao nội dung lâu dài trong database, log, hàng đợi lỗi hoặc cache phía server như một nguồn lưu nội dung thứ hai.
- Bản nháp trên thiết bị và tệp người dùng chủ động tải về là các bản cục bộ được cho phép, không phải bài nộp chính thức thay Drive.
- Có thể dùng dữ liệu kiểm tra toàn vẹn không chứa nguyên văn bài để phát hiện file bị sửa; phương án cụ thể cần được kiểm chứng khi thiết kế kỹ thuật.
- Mật khẩu và thông tin ủy quyền Drive không được đưa vào log cấp/reset, file Markdown hoặc tài liệu bàn giao.
- Phạm vi OAuth tối thiểu phù hợp là hướng thiết kế cần đánh giá; không mặc định yêu cầu quyền đọc toàn bộ Drive. Tham chiếu: [Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
- Chưa hứa hỗ trợ chỉnh sửa đồng thời kiểu Google Docs, chuyển Drive, quản lý nhiều tổ chức hoặc đồng bộ thay đổi bài nộp từ editor ngoài.

## 10. Điều kiện nghiệm thu chính

| Nhóm | Tình huống cần kiểm tra |
|---|---|
| Admin | Cấp GV/mật khẩu tạm; bắt đổi lần đầu; không gọi được API đọc nội dung bằng role admin; cấp/reset có audit và không log mật khẩu. |
| Học sinh dùng chung | Một tài khoản vào lớp hai GV; chỉ đọc dữ liệu được cấp; reset bởi admin; GV không reset; khóa một GV không khóa lớp còn lại. |
| Enrollment | Nhập mã lớp trước khi duyệt không đọc được đề/nộp bài; duyệt mới có quyền; CSV không làm thay đổi mật khẩu tài khoản đã có. |
| Drive setup | Cho quản lý lớp trước kết nối; chặn tạo nội dung khi chưa thiết lập; chọn parent và tạo folder riêng; không đổi sang tài khoản mới sau khi có dữ liệu. |
| Editor | Trực quan ↔ source giữ Markdown được hỗ trợ; không có màu chữ/gạch chân tùy ý; học sinh không chèn ảnh kể cả qua source; ảnh GV lưu đúng Drive. |
| Draft | Tự lưu local/Drive; đổi thiết bị đọc đúng bản gần nhất; chỉ một phiên ghi; chuyển quyền không làm mất nháp chưa đồng bộ. |
| Submit | Nộp tạo file mới; thất bại không báo thành công; thử lại không tạo trùng ngoài ý muốn; không tự nộp lại. |
| Review | Đọc lại file `.review.md` khôi phục điểm/nhận xét/đánh dấu; bài gốc không đổi; annotation gắn đúng phiên bản. |
| External changes | Sửa bài nộp ngoài app → xung đột/khóa chấm bản đó; xóa → missing; không giả vờ phục hồi được bản gốc. |
| Suspension | GV bị khóa không đăng nhập; HS chỉ đọc nếu Drive hoạt động; không ghi nội dung mới vào không gian bị khóa. |

## 11. Điểm cần giải quyết trong thiết kế kỹ thuật

Không biến các mục này thành tính năng mặc định khi chưa đánh giá:

- Chọn editor sau khi kiểm tra tính tương thích Markdown và annotation; thiết kế UI mới trong phạm vi editor/admin/Drive/enrollment, không áp lời hứa pixel-perfect của màn hình cũ lên các màn hình chưa có baseline.
- Schema file nhận xét Markdown, tách metadata do hệ thống quản lý khỏi nội dung người dùng được sửa.
- Cách hiển thị ảnh Drive riêng tư và cách giữ tham chiếu hữu ích khi tải file ra ngoài hệ thống.
- Chu kỳ đồng bộ, dung lượng nháp/ảnh, định dạng ảnh cho phép, timeout và chuyển quyền phiên chỉnh sửa.
- Quy trình xử lý xung đột Drive sau khi phát hiện: hỗ trợ người dùng xác định bản nào bị thay đổi và khôi phục từ nguồn còn có; không tự bỏ qua kiểm tra toàn vẹn.
- Ranh giới dữ liệu metadata/content và kiểm tra log/cache để tuân thủ lựa chọn không lưu bản sao nội dung lâu dài trên server.
- Bootstrap admin, API permissions và cách xác minh người yêu cầu reset mật khẩu.

Chưa triển khai ứng dụng hoặc kết nối Drive thật trong phiên grill. Bản tổng hợp này là đầu vào cho thiết kế kỹ thuật và cập nhật đặc tả UI của các chức năng mới. Kiến trúc tổng thể, stack đề xuất và trạng thái repo được trình bày tại [README](../../README.md).
