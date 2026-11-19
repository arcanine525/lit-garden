# Thiết kế metadata, xác thực và giao thức Drive

Ngày: 20/11/2026. Nhánh: `design/metadata-drive-protocol`, baseline `976470f`.
Trạng thái: **thiết kế tham chiếu có SQL và kịch bản chạy được; chưa có ứng dụng, migrations hay tích hợp OAuth/Drive thật**.

Đầu vào: toàn bộ [D01–D24](../requirements/ADMIN-DRIVE-MARKDOWN.md), [F01–F42](../requirements/FEATURES-REVIEW.md), [README](../../README.md) và [FEATURES](../../FEATURES.MD). F ưu tiên khi khác D; FEATURES chỉ là evidence. Không có AI, demo công khai, DOCX, liên kết ngoài trong thư viện, chuyển Drive hay cộng tác nhiều writer. Không tạo thêm agent.

## 1. Các quyết định kỹ thuật

1. Một `users` toàn hệ thống, liên kết `(OIDC issuer, subject)` duy nhất; mỗi user một role trong bản đầu. `teachers`/`students` là subtype có FK role. Giáo viên là ranh giới sở hữu; học sinh được dùng chung, không nhân bản theo giáo viên.
2. PostgreSQL chỉ giữ quản lý/quyền/con trỏ/hash; rubric mẫu là ngoại lệ cấu hình F29. Điểm, thang điểm của bài, nhận xét, tiêu đề/nội dung bài và thư viện, ảnh và hội thoại chỉ lưu trên Drive. Đọc bảng điểm phải đọc Drive; chấp nhận unavailable và chi phí đọc thay vì giữ score cache.
3. Một nháp logic có một head và một lease. Mỗi autosave tạo **file ứng viên mới**, không update bytes file head cũ; đổi head bằng transaction có fencing/version check sau await Drive. Đây là lựa chọn kỹ thuật thay ví dụ một physical `.draft.md` cập nhật tại chỗ: tên draft là logic; file vật lý có generation. Tránh old in-flight write phá bản mới vì Drive không cùng transaction PostgreSQL.
4. Submit, giao bài, trả bài và gửi tin chỉ hiển thị sau khi toàn bộ file cần thiết được đọc lại xác minh rồi commit metadata. Operation intent và file ID được commit **trước** upload. Reconciliation không chứa payload và không tự tạo một lần nộp mới.
5. Nháp chấm, publication revision và submission version là ba trục độc lập. Con trỏ `current_publication_id` quyết định học sinh thấy gì; tổng hợp lấy `MAX(submission_no)`, không lấy lần trả gần nhất.
6. Tin nhắn append-only; comment có pending reply hoặc reply đã gửi bị khóa fingerprint (body + anchor). Mọi publish và reserve reply cùng khóa submission để giải quyết race.
7. Quyền ứng dụng được kiểm tra lại trước commit và trước xuất bytes. Class archive, remove, teacher suspend và close là barrier; thao tác chưa commit gặp barrier bị từ chối, file ứng viên thành orphan. Không hoàn tất âm thầm sau khi quyền ghi bị thu hồi.

## 2. Ranh giới dữ liệu từng nhóm field

| Nơi | Được lưu lâu dài | Không lưu |
|---|---|---|
| `users`, `teachers`, `students` | UUID, issuer/sub, username, tên hiển thị, role/status, auth epoch, thời điểm | Password, mật khẩu tạm, ID/access token plaintext |
| `classes`, membership/enrollment | Tên/năm lớp, UUID, mã lớp băm, trạng thái, người/thời điểm duyệt, version | Nội dung bài hay thông tin xác thực |
| `assignments`, recipients/deadlines | Lớp/chủ sở hữu, trạng thái công bố + accepting, deadline/lịch sử, rubric template ID/revision, file refs | Tiêu đề, đề/ngữ liệu/tham chiếu, rubric snapshot, scale của bài |
| submission/review/message | Chủ sở hữu, recipient/submission/comment UUID, ordinal, thời điểm, operation/file refs, con trỏ publication | Điểm từng tiêu chí/tổng, anchor quote/offset, bình luận, giải thích chỉnh sửa, message text |
| Drive objects/streams | File/folder IDs, MIME, kích thước, SHA-256, Drive version quan sát, integrity/lifecycle, con trỏ head/version, lease | Bytes bài/ảnh, original filename tùy ý, excerpts |
| operations/deletion tasks | Actor, loại/target UUID, idempotency key, fingerprint, expected version/lease epoch, file IDs, state/error enum, worker epoch | Request/response body, serialized editor tree, plaintext lỗi Google, queue payload nội dung |
| library shares/favorites/featured | Item/class/user UUID, slot thứ tự, state/version | Tiêu đề/tác giả/nguồn/trích dẫn; các field này ở Drive Markdown manifest |
| notifications/audit | Mã sự kiện, actor/user/target UUID, operation UUID, thời điểm, read/unread, outcome enum | Snippet bài/điểm/nhận xét, URL tùy ý, JSON metadata tự do |
| `rubric_templates` | Tên, revision và JSON cấu hình tiêu chí/mức điểm do admin quản lý | Bài làm hay score của học sinh; F29 không mở rộng ngoại lệ sang dữ liệu chấm |
| Kho kết nối server | Google `sub`, folder IDs, scopes/status; refresh token envelope-encrypted + key ID | Refresh token plaintext trong DB backup/log/browser |
| Browser IndexedDB | Nháp/giải thích sửa, review draft chưa sync, base version/hash, operation intent và payload local chưa được xác nhận | Không coi bản local là nộp thành công; không đưa token Drive vào IndexedDB |

Hash là dữ liệu kiểm tra được cho phép theo D13, không là replica; hash vẫn nhạy cảm, không công khai/đưa vào telemetry. Không dùng digest làm oracle tra nội dung. Tên tài khoản/lớp là metadata quản lý đã có trong yêu cầu; free text mới không tự được xem là metadata.

Backend xử lý bytes trong memory theo request/stream, hủy tham chiếu sau khi hoàn tất. Không ghi `/tmp`, crash dump, swap do app, dead-letter payload, APM body, error stack có body hoặc CDN/image optimizer persistent cache. Upload lớn phải giới hạn/stream không spool đĩa. API nội dung/export/proxy ảnh trả `Cache-Control: private, no-store`; tắt Next.js fetch/data/full-route caching cho các route này. Service worker không cache nội dung qua logout. Log allowlist method/route template/status/UUID/error enum; không query string, headers, cookies hay error message từ upstream. Backup DB chứa metadata/rubric/token ciphertext, không content. Browser tách IndexedDB theo user + teacher + resource, xóa dữ liệu phiên khi logout theo lựa chọn thiết bị; cảnh báo trước khi xóa unsynced draft.

Giới hạn triển khai đề xuất, có thể cấu hình sau benchmark: Markdown envelope ≤1 MiB, ảnh PNG/JPEG/WebP ≤5 MiB, PDF/TXT ≤10 MiB, metadata structure nesting ≤16, annotations ≤500, mỗi message ≤32 KiB. Đây không phải giới hạn đã chốt từ website nguồn. Không dùng giới hạn 2 MB/30.000 ký tự nguồn làm yêu cầu mới. Khi quá giới hạn trả lỗi trước reserve/write; giữ local.

## 3. Mô hình và schema SQL

[metadata-reference.sql](metadata-reference.sql) chạy trong DB rỗng PostgreSQL 16+, không là migration. UUID dùng `gen_random_uuid`; thời gian `timestamptz` UTC, hiển thị Asia/Ho_Chi_Minh. Không có cột score/comment body. `definition jsonb` chỉ có ở rubric mẫu.

| Quan hệ | Khóa/constraint quan trọng |
|---|---|
| teachers → classes/Drive | Các bảng nội dung metadata mang `teacher_id`; composite FK xuyên class/assignment/recipient/file/stream/submission cấm gắn sang owner khác |
| class ↔ student | PK `(class_id,student_id)` giữ nguyên qua remove/readmit; một enrollment pending mỗi cặp; pending không có quyền |
| assignment → recipients | Recipient được tạo khi Giao bài cho active membership; lúc duyệt/nhận lại, upsert các bài đang mở; không tạo cho bài đóng |
| recipient → drafts/submissions | Một draft stream, nhiều bản nộp; unique `(recipient,submission_no)` và operation UUID; chỉ tăng ordinal khi commit thành công |
| submission → draft/publications | Một review stream; nhiều revision publication bất biến; composite FK buộc current publication thuộc đúng submission |
| publication ↔ comments → messages | UUID comment ổn định, digest từng publication; frozen digest khi có reply; message unique operation và số thứ tự trong thread |
| library item → head/shares | Draft head riêng với current visible object; save đổi current, không đổi item ID; FK share cùng teacher; featured bắt buộc có share |
| operation → candidate objects | Nhiều slot cho assign/assets; drive ID duy nhất; idempotency unique `(actor,key)`; partial index một mutation chưa xong mỗi target |

`assignment.state=draft|published` tách `accepting`: draft → publish/open → closed ↔ open; publish reference chỉ closed, có nội dung, sau đó permanently closed. Không có auto-close theo deadline. `due_at=NULL` nghĩa vô hạn: không được từ vô hạn thành hữu hạn; gia hạn hữu hạn → lớn hơn hoặc NULL. Nhãn muộn tính từ `submitted_at > current due_at`, không lưu boolean dễ lỗi thời. Deadline history được append cùng transaction đổi hạn, dùng operation loại extend_deadline/target assignment cho notification dedup; đây là mutation metadata-only commit trong một DB transaction, không qua trạng thái Drive writing.

Rubric revision được insert mới, không sửa definition cũ; retire ảnh hưởng lựa chọn cho bài mới, không snapshot cũ. Snapshot trong file Drive gồm tên, IDs, criteria, weights/levels, max/scale, version và thuật toán rounding; chấm không đọc definition mới nhất trong DB. Nháp bài giao chọn rubric revision đã tồn tại; publish kiểm tra chưa retired và đóng băng snapshot.

Membership approval/publish/reopen khóa class trước assignment theo UUID: tránh HS được duyệt giữa lúc publish bị bỏ sót. Khi mở lại bài (chưa public reference), backfill active members chưa có recipient theo F22; recipient lịch sử không xóa. Khi remove không xóa history. Khi readmit giữ cùng membership, upsert recipients mở, không tạo lại submission. Không hỗ trợ delete lớp có lịch sử; archive là luồng mục tiêu.

FK/check/trigger đảm bảo cấu trúc, không thay auth. SQL có predicates mẫu đọc/nộp và CAS draft head. Các guard còn phải triển khai trong service: target polymorphic của operations resolve đúng resource; stream không gắn nhiều resource; actor/decider là owner; file slot/MIME/lifecycle đúng mục đích; current pointer chỉ tới object verified; ordinal/history/notification cùng transaction; frozen comment đầy đủ; mọi chuyển trạng thái và quyền. SQL không tự tuyên bố RLS hoàn chỉnh. App runtime không là DB owner, không nhận SQL từ client; service giữ authority. Khi scaffold, revoke raw DML ở surface public, đóng gói transaction module, thêm RLS defense-in-depth nếu có nhiều DB clients. Không dựa vào RLS để xác minh nội dung Drive.

Index có trong SQL: membership theo student/state, recipient theo student, submission ordinal DESC, publication revision DESC, operations pending/due, notification unread và share theo class. Xóa/retention operation: giữ tombstone key/digest/result cho mọi thao tác chính thức ít nhất vòng đời resource; không xóa key rồi cho replay thành bản nộp mới. Autosave terminal/orphans có thể GC sau 7 ngày, giữ key tombstone 30 ngày; client hết hạn key nhận `410 OP_EXPIRED`, phải đọc head và xin key mới. Thời hạn GC là lựa chọn vận hành đề xuất, chưa SLA.

## 4. Xác thực Keycloak và cấp tài khoản

OIDC Authorization Code + PKCE S256; BFF lưu phiên opaque trong cookie HttpOnly/Secure/SameSite=Lax; validate issuer, audience, signature/JWKS, exp, nonce/state, redirect URI cố định; chống CSRF trên mutation. Không dùng Google làm login Vườn Văn. Không dùng password grant hoặc giữ password trong DB ứng dụng. User lookup bằng issuer/sub, không bằng email/username từ browser. Keycloak role claim phải tương ứng role DB; DB kiểm tra status/auth_epoch ở mỗi request nên token cũ không vượt được suspend/reset.

Realm: tắt self-register, login-by-email và verify-email/forgot-password-email cho học sinh; user profile email optional. Cấp credential `temporary=true` với required action `UPDATE_PASSWORD`; chặn mọi endpoint nghiệp vụ cho đến khi required action xong. Keycloak thực hiện forced change trước cấp phiên ứng dụng. Cần test theme/flow không bất ngờ bắt nhập email. Cấu hình temporary và user profile được mô tả ở [Keycloak server administration](https://www.keycloak.org/docs/latest/server_admin/index.html); endpoint cấp/reset tại [Admin REST API](https://www.keycloak.org/docs-api/latest/rest-api/index.html).

Admin bootstrap bằng quy trình vận hành một lần, secret qua secret manager/console, MFA cho admin, không seed password vào repo. Tạo teacher/reset student là endpoint tách, yêu cầu phiên admin re-auth gần đây. Xác minh người xin reset bằng tài khoản/đối chiếu roster do admin phụ trách ngoài app, không biến username đơn thuần thành bằng chứng sở hữu. Không bổ sung email recovery chưa được chọn.

Giáo viên tạo **student mới** qua service hạn chế, không có credential Keycloak admin trong browser. Chuẩn hóa username lowercase theo regex, preflight CSV, rồi dựa vào unique constraint Keycloak + DB cho race. Provision là saga riêng qua `identity_operations` (actor/key/target user UUID/intended class/Keycloak user ID/state, không password): reserve identity UUID/username/status provisioning, subject sentinel `provisioning:<UUID>` không thể đăng nhập, và audit → tạo Keycloak user với external app UUID attribute → đặt temporary credential → commit issuer/sub + role + membership (chỉ user vừa tạo). Nếu Keycloak thành công DB lỗi, đối chiếu UUID trước retry; account chưa linked không vào app. Không tìm bằng username rồi nhận quyền sở hữu một user không có provisioning UUID khớp. Username đã tồn tại trả lỗi/hướng dẫn xin vào lớp; không set password/không tự enroll, kể cả import race.

Password mới chỉ trong memory, trả một lần cho người có quyền qua no-store response; CSV credential nếu có chỉ dựng trên browser theo hành động xuất, không có bản server. Sau crash không khôi phục được password; teacher không tự reset user đã tạo xong, chuyển admin. Không retry reset với mật khẩu mới nếu unknown; reserve reset ID, chặn tài khoản trong app, admin thực hiện lại có chủ đích rồi thu hồi sessions, tăng auth epoch. Audit chỉ actor/target/action/outcome. Không đưa password vào fingerprint/audit. App không tự gọi API credential ngoài luồng cấp mới/reset được phép.

Suspend teacher: transaction status+số epoch+audit trước, revoke app sessions, gọi Keycloak disable/logout theo task metadata. Khi Keycloak lỗi vẫn chặn ở app; reconciling IAM sau. HS vẫn đọc file được phép bằng connector server (không cần teacher login), không xóa/revoke Drive token. Resume IAM/app phối hợp, không mở lại assignment/archive/membership. D24 là trust boundary: role admin không có quyền content, người vận hành biết temporary password vẫn có thể đăng nhập như user; không hứa chống được điều đó.

## 5. Google OAuth, Picker và thư mục

OAuth riêng chỉ teacher active: web-server code flow, CSRF state gắn session + teacher + nonce, `access_type=offline`, scopes `openid` + `drive.file` (email không làm định danh). Validate Google ID token issuer/aud/exp/nonce, lưu Google `sub`; reconnect phải khớp sub đã lưu sau `data_started_at`. Không so email dễ đổi. Callback khác account bị reject trước thay token/folder hoặc đọc/write. Flow refresh và offline access dựa trên [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), identity theo [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

Refresh token envelope encryption (AES-256-GCM với nonce riêng/AAD teacher+Google sub, DEK được KMS bọc); ciphertext và key ID trong DB, KEK bên ngoài DB. Chỉ connector được unwrap, không role admin API. Rotate khóa có version. Refresh single-flight theo connection, giữ token cũ nếu response không trả refresh token mới; `invalid_grant` → reconnect_required. Không revoke token khi chỉ khóa teacher vì D17. Không ghi token ở Markdown/log.

Picker web yêu cầu access token phía browser theo [Picker overview](https://developers.google.com/workspace/drive/picker/guides/overview). Ngoại lệ có chủ đích: chỉ teacher đang setup nhận access token ngắn hạn vào memory để Picker chạy; refresh token luôn server. Không hứa toàn bộ access token chỉ ở server khi dùng Picker web. Token hạn chế `drive.file`, origin/CSP chính xác, không persist; không expose token cho student. Nếu security yêu cầu zero Google token ở browser phải đổi UX Picker ở vòng thiết kế khác.

Picker hiển thị folders và `setSelectFolderEnabled(true)`; capability này có trong [Picker reference](https://developers.google.com/workspace/drive/picker/reference/picker.docsview.setselectfolderenabled). Server không tin ID browser: `files.get` kiểm tra MIME folder, không trashed, ownership giáo viên, canAddChildren; bản đầu dùng My Drive thuộc account, không chọn shared drive/shortcut/folder của người khác. Tạo app folder “Vườn Văn” ID pre-generated, ghi connection ready khi đọc lại được. Không reuse folder cùng tên chưa thuộc app. Data-start latch được đặt ngay khi reserve tạo nội dung đầu tiên, không đợi commit, để file unknown không rơi sang account khác.

`drive.file` áp dụng file app tạo/được user mở/chọn với app theo [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth). Chọn parent **không có nghĩa** app được đọc mọi descendant có sẵn. Thiết kế chỉ quản lý file tự tạo, không import cây thư mục bất kỳ, không tự nâng sang full Drive. Folder parent được chọn và tạo child phải test thật với project OAuth đúng app ID. Setup chưa đủ quyền báo cụ thể, không đánh dấu ready.

Thư mục: `<parent>/Vườn Văn/<classUUID>/<assignmentUUID>/<studentUUID>/`; dùng UUID thay tên/username trong path. Library ở `<app>/library/<itemUUID>/`. File bytes `text/markdown`/PDF/TXT/image blob, không Google Docs conversion. Tên ví dụ `draft-g<version>-<opUUID>.md`, `submission-<UUID>.md`, `review-draft-<opUUID>.md`, `review-pub-<UUID>.md`, `message-<UUID>.md`. Mọi file appProperties chỉ có schema/kind/resource UUID/operation UUID; không content. Folders không là auth; không tạo public permission hoặc share Drive cho HS.

Mọi download đi qua typed resource API, không endpoint `GET arbitrary-drive-id`. API resolve UUID → owner/ref → auth → Drive → verify → auth-check trước trả bytes. Asset proxy phải kiểm tra asset thuộc manifest của resource đang được đọc, không chỉ cùng teacher. Một ảnh của đề chưa giao hoặc reference riêng không được đọc nhờ biết ID. Proxy ảnh no-store; Markdown dùng stable reference `/api/assets/<UUID>`; renderer xin URL xem có session/TTL nếu cần rồi gọi API có kiểm tra quyền, không nhúng bearer/token/Drive public URL. Markdown download giữ logical reference và cảnh báo cần app để xem ảnh riêng; không hứa `.md` độc lập chứa ảnh. Library PDF/TXT bytes + metadata Markdown manifest nếu cần mô tả; PDF không ép thành md.

## 6. Ma trận quyền backend

Mặc định deny. Owner dưới đây là teacher active đúng `teacher_id`; admin không có bypass đọc/export/asset hoặc impersonation endpoint. User suspended luôn từ chối request của chính họ. Student không được truyền student/teacher ID để thay actor.

| Hành động | Admin | Owner teacher | Student active member + recipient | Student removed |
|---|---|---|---|---|
| Quản lý teacher/status, reset student | Có | Không reset | Không | Không |
| Rubric mẫu | CRUD revision | Đọc/chọn active | Đọc rubric của bài được giao | Snapshot bài đã nộp |
| Tạo lớp/cấp student mới/duyệt | Không bằng role content | Có, kể cả chưa Drive | Xin vào bằng code, chưa duyệt không đọc | Xin/nhận lại theo teacher |
| Đề published | Không | Có | Có, cả closed/archive | Chỉ đề có bài mình đã nộp |
| Reference private | Không | Có | Không | Không |
| Reference đã public | Không | Có | Có nếu recipient F42 | Chỉ khi có bài đã nộp + reference public |
| Nháp student | Không | **Không UI/API F26** | Chỉ mình; đọc/tải khi closed/archive | Không; F19 chỉ giữ submitted history |
| Sửa/sync/submit student | Không | Không | Chỉ own draft; class active, teacher active, assignment open, Drive ready | Không |
| Bản nộp | Không | Cả lịch sử own class | Chỉ của mình, kể cả archive | Chỉ của mình |
| Review draft/old publications | Không | Có | Không | Không |
| Current publication mỗi submission | Không | Có | Của mình | Của mình |
| Chấm/trả/re-publish | Không | Có, kể cả assignment closed; chặn archive | Không | Không |
| Đọc thread đã trả | Không | Có | Của mình | Của mình |
| Gửi reply | Không | Có | Của mình, membership active; không cần assignment open | Không |
| Library đọc/tải/favorite | Không | Own item | Item active, có share tới membership active | Không, kể cả favorite còn ID |
| Library ghi/share/featured/delete | Không | Own item; chỉ share lớp mình | Không | Không |
| CSV/Markdown/ảnh | Không | Theo quyền từng resource | Theo quyền từng resource | Chỉ lịch sử được giữ |

Archive: mọi nội dung lớp chỉ đọc; không assignment create/assign/edit, student write, grading hay message. Library riêng teacher có thể chia sẻ nhiều lớp: edit tài liệu chung là thay đổi global F33, nhưng không sửa share/featured của lớp archived; tài liệu đã share vẫn đọc được nếu còn quyền. Đây là diễn giải cần ghi rõ, không dùng archive làm snapshot thư viện. Teacher suspension: teacher không login; HS chỉ đọc các resource hợp lệ nếu Drive đọc được, không reply/favorite/write; lớp teacher khác không ảnh hưởng. Favorite/unread là metadata nhưng không cho tạo tương tác mới vào không gian bị khóa; mark-read của notification riêng user vẫn được phép.

New student không có recipient closed nên không đọc đề/reference dù active member. Public ở đây là visibility trong assignment, không công khai Internet. Removed có submission vẫn giữ recipient và chỉ đọc subset F19. Rejoin phục hồi history không copy và chỉ write bài mở. Download một publication superseded bằng URL biết trước bị deny với student. Notification click kiểm quyền lại; không có quyền thì hiển thị “Nội dung không còn khả dụng”, không render title/snippet trước auth. List/count/search/export dùng cùng predicate, không chỉ detail API.

CSV tổng hợp lấy latest submission ordinal mỗi recipient, current publication của đúng submission; chưa có current → “Chờ chấm”, không lấy điểm cũ. Lịch sử có thể xuất theo từng bản nộp nếu role có quyền; không xuất old publication/draft cho student. Đọc Drive tạm, không ghi output lên server; dùng CSV escaping + chống formula injection. Drive lỗi trả unavailable/ô “Chưa tải được” có giải thích, không biến lỗi thành điểm 0/chưa chấm. Garden metadata có thể hiển thị Hoa/Quả từ current pointer, kèm badge unavailable/conflict; không tuyên bố đã đọc được điểm. Không tính closed unsubmitted vào Mầm; active memberships và class active mới vào tổng hợp F35.

## 7. Lease một writer và autosave

Đề xuất lease TTL 60 s, renew mỗi 20 s, debounce autosave 2 s/max 10 s sau thay đổi. Server clock quyết định; browser timer chỉ UX. Stream ID riêng cho assignment draft/student draft/review draft/library draft. Actor UUID không đủ phân biệt tab: mỗi tab tạo `client_session_id` ngẫu nhiên, không copy qua session clone.

Acquire: transaction khóa policy rows rồi stream `FOR UPDATE`; xác minh quyền ghi của loại stream; nếu không có holder hoặc expired, tăng epoch và cấp session + until. Nếu holder khác còn hạn trả `423 LEASE_HELD`, mở read-only. Renew cần đúng actor/session/epoch **và chưa hết hạn**, recheck policy; không revive lease đã expired. Release cần đúng tuple, clear holder, tăng epoch. Takeover do người dùng bấm rõ ràng: recheck quyền, lock stream, tăng epoch, thay session, audit, trả head/version mới. Cùng transaction reject các autosave chưa commit của stream và submit chưa commit mang epoch cũ của recipient tương ứng, giải phóng pending mutex; late Drive create chỉ là orphan, không cản writer mới. Acquire sau expiry cũng fence/reject intents epoch cũ trước cấp epoch mới; release không biến nội dung chưa sync thành thành công. Không cho teacher takeover student draft.

Tab cũ dừng sync khi nhận mismatch; giữ local chưa sync. Không cần tab cũ ACK mới takeover; thông báo “Thiết bị trước có thể còn thay đổi chưa đồng bộ” vì server không biết hết local dirty state. BroadcastChannel/SSE là tiện ích, không correctness boundary.

Autosave request chứa `{operationKey, streamId, sessionId, leaseEpoch, baseVersion, documentEnvelope}`. Bước:

1. Lưu envelope local trước request. API validate Markdown/schema/quyền, tính digest bytes cuối cùng.
2. Transaction reserve operation + expected version/epoch, candidate IDs và hashes. Lock stream; baseVersion phải là head mới nhất, lease còn hạn; một operation pending mỗi target. Commit intent trước Drive.
3. Tạo file candidate mới bằng ID đã reserve; file cũ không bị ghi. Read-back bytes/hash/metadata, mark verified. Không giữ transaction DB mở qua network.
4. Transaction khóa policy + stream + operation, recheck quyền, lease chưa expired, epoch/session và baseVersion. CAS đổi head, tăng version, operation committed, candidate referenced. Commit mới ACK `syncedVersion`.
5. CAS fail/expired/takeover: operation rejected, file orphan (GC metadata). Trả `409 STALE_WRITER/BASE_VERSION`, local vẫn giữ. Không tự merge hay đổi base rồi đẩy local cũ lên head mới.

Old worker sau takeover chỉ tạo file candidate của operation cũ; finalize CAS thất bại, không thể thay head. DB worker claim cũng có epoch; takeover worker cũ không ghi state mới. Nếu lease expires khi Drive chậm, upload có thể thành orphan; người dùng reacquire, tải head rồi chọn merge/giữ bản local để retry mới. Backend không dựa vào disable button hoặc một lần kiểm trước await. [PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html) là primitive cho transaction ngắn; lock order thống nhất ở mục 11.

Copy-on-write tăng số file/API; GC nháp cũ khi không còn ref ở operation/current head/submission, giữ grace 7 ngày. GC chỉ trash file app tạo đã orphan và quá hạn, có task UUID, không scan/trash theo tên folder. Không GC submission/publication/message lịch sử. Khi chưa xác minh orphan an toàn thì giữ lại trên Drive; không đánh đổi correctness để tiết kiệm quota. Autosave chỉ xảy ra sau thay đổi, không upload theo heartbeat.

## 8. State machine operation và nộp bài

State transition: `reserved → writing → drive_verified → committed`; network/crash `writing → unknown`; thiếu bytes chưa thấy file `unknown → needs_client`; lỗi xác định `reserved/writing → needs_client` hoặc `rejected`; candidate không còn được phép `→ rejected → cleanup`. `unknown` không được báo failed chắc chắn. `needs_client` không tự upload vì server không giữ payload. Mọi terminal transition phải monotonic; `committed` trả cùng result khi retry. Operations không có body/result JSON.

Idempotency: client UUID cho **mỗi ý định**; `request_digest` bind actor+kind+canonical target+hash canonical user-input bytes+base+lease epoch. `expected_sha256` của file là hash final envelope sau khi thêm server-owned IDs/acceptedAt được pin ở T1. Hai digest có scope khác nhau; retry cùng input dựng lại đúng envelope từ intent đã lưu, không sinh timestamp/ID mới. Cùng key khác fingerprint → `409 KEY_REUSED`; cùng key committed trả result UUID cũ. New click “Nộp bản mới” sau thành công có key mới. Double-click chia sẻ một key; nếu tab lỗi tạo key khác trong khi operation pending thì `409 OP_IN_PROGRESS`, hướng tới status cũ. Không dedup vĩnh viễn bằng content hash vì người dùng có thể chủ ý nộp cùng nội dung hai lần. Status API auth lại theo target, không public operation ID.

Drive `files.generateIds` rồi commit ID vào candidate row trước `files.create` multipart. ID có thể dùng cho blob Markdown/PDF/TXT và folder; retry create thành công trước đó trả 409, không tạo file khác theo [Drive create-file](https://developers.google.com/workspace/drive/api/guides/create-file) và [upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads). Không sử dụng behavior này cho Google Docs conversion. 409 phải GET cùng ID, so appProperties/resource/parent/MIME/size/hash, không tự coi là thành công. Không retry bằng tên mới. Nếu generateIds thành công nhưng DB chưa reserve thì ID vô hại chưa có file.

Submit chỉ nhận explicit user action, không từ cron/autosave. Request snapshot gồm Markdown + explanation + source head/version/epoch; xác minh hợp lệ, có quyền hiện tại, lease writer và expected head. Có thể nộp local chưa sync bằng bytes gửi trong snapshot; không bắt autosave success trước, không nhận “submit latest” không chỉ rõ hash. Reserve target recipient (khác autosave target stream), khóa stream/recipient để snapshot base có thứ tự. Cho phép pending autosave cùng stream nhưng autosave không thay bytes submit đã pin; final submit cần epoch còn phù hợp, head movement do chính session autosave không đổi snapshot được user bấm.

Finalization: xác minh candidate bytes, source submission không tồn tại/modified, recheck teacher/class/membership/accepting và epoch (submit không cần lease TTL còn hạn nếu không takeover; epoch vẫn phải đúng). Khóa recipient, lấy `next_submission_no`, insert submission, tăng counter, commit operation/result cùng transaction. `submitted_at` dùng `accepted_at` server của intent đã qua validation; content không thay sau khi intent accepted. Deadline tính nhãn theo thời điểm này và deadline hiện tại, không theo thời gian Drive xong. Intent chưa có bytes trên Drive chưa được xem là nộp, kể cả đã qua hạn. Hạn mềm không làm mất quyền nộp.

Nếu close/archive/remove/suspend/takeover đã thắng trước finalize thì reject `POLICY/STALE`; không nộp khi reopen/unlock về sau bằng worker. Local cho retry có chủ đích mới khi quyền cho phép. File đã upload bị orphan. Nếu commit submit đã thắng trước barrier thì giữ submission bình thường. Request mạng cũ không có cách bị “thu hồi bytes” trên Drive ngay lập tức nhưng không thành dữ liệu visible sau barrier. Đây là linearization tại DB commit, không phải Drive write time.

Reconciliation được phép **đối chiếu và hoàn tất intent đã được bấm** nếu candidate đã tồn tại nguyên vẹn và policy/epoch vẫn hợp lệ. Không tạo submission từ draft không có submit operation; không upload lại nội dung cho submit bằng worker. Nếu Drive GET 404 sau timeout, không kết luận file sẽ không bao giờ tới (old request có thể còn đang chạy); giữ unknown, backoff GET, báo “Chưa xác nhận”. User “Thử lại” dùng cùng key và bytes fingerprint, create cùng ID; “Hủy thao tác đang chờ” chuyển rejected, late file chỉ orphan. Kể cả worker/client chạy lặp, unique op và lock recipient chỉ tạo một submission. Phân biệt “đối chiếu lần nộp đang chờ” và “Nộp phiên bản mới” trong UI.

Crash sau Drive success, trước DB commit: ID/hash/intent đã durable; worker GET và verify rồi finalize đúng op. DB mất kết nối khiến outcome commit unknown: GET operation từ DB khi phục hồi, không suy đoán rollback, không tạo key mới. Crash trước upload: chỉ metadata, worker không dựng lại payload; `needs_client`, browser retry đúng key. Local bị xóa và Drive chưa có file → không phục hồi, không giả định nội dung nằm trong queue.

## 9. Giao bài, chấm, công bố và hội thoại

### Giao bài

Nháp bundle Markdown chứa title/prompt/material/reference/rubric selection/scale. Publish reserve assign operation; pin bytes/rubric revision từ DB, tạo prompt/reference (optional)/rubric snapshot trong các slot riêng với IDs/hashes reserve cùng transaction. Chỉ khi mọi file verified mới transaction chuyển published+accepting, upsert recipients active membership và notification assigned. Thiếu một file không lộ prompt hoặc recipient sớm. Prompt/rubric/reference object không thay sau giao; publish reference chỉ thay visibility khi closed và nội dung không rỗng, không rewrite file. Grade không yêu cầu reference.

### Chấm và công bố

Trước mở review và mỗi lần autosave review đọc submission bytes kiểm SHA-256, rubric snapshot và Drive status; finalization cũng kiểm trạng thái source integrity chưa bị freeze. Không chỉ kiểm hash một lần khi mở trang. Autosave review cũng đối chiếu frozen/pending comments với current dưới lock; reply tới sau autosave vẫn được chặn lại ở publish. Review draft nullable scores, gắn submission UUID/hash và rubric hash. Re-publish chỉnh từ bản hiện hành sang draft mới; học sinh tiếp tục thấy current cũ. Đủ điểm mọi criteria từ snapshot, giá trị thuộc allowed levels/ranges; tính tổng bằng decimal và thuật toán scale/round đã ghi trong snapshot (đề xuất round-half-up tổng 2 số), không tin tổng client. Không cần overall. Rule scan chỉ gợi ý transient, teacher chọn đưa vào draft, không sửa gốc/trừ điểm.

Publish request pin draft version/hash + base current publication ID + submission hash + writer session/lease epoch. Các snapshot actions Giao bài/Lưu thay đổi thư viện cũng pin session/epoch: admission đòi lease sống, finalize cần epoch vẫn đúng (cùng quy tắc submit, TTL có thể đã qua nhưng không takeover/release). Tạo file `.review-pub-<UUID>.md` mới, verify file và re-read submission hash trước finalize. Transaction khóa policy → stream/submission → comments → operation; kiểm expected current, source integrity và frozen comments. Insert publication revision `max+1`, mappings comment hashes; đổi current pointer; notifications returned cùng transaction. Re-publish không sửa publication trước. Nếu không đọc được nguồn thì không publish giả. Crash/retry dùng cùng candidate IDs và cùng operation, không thêm revision hoặc notification trùng.

Nếu submission thay ngoài app sau lần GET cuối nhưng trước commit, không có atomic lock với Drive chủ sở hữu: có cửa sổ phát hiện trễ. Không hứa ngăn mọi external mutation tức thời. Mọi lần đọc/kết quả/export tiếp theo recheck source; nếu khác → freeze bản đó, không hiển thị annotations/điểm như kết quả hợp lệ trên nội dung khác. Worker kiểm tra định kỳ bổ sung nhưng không phải consistency guarantee.

### Reply và race với nháp giáo viên

Comment UUID tồn tại qua các publication cùng submission. `publication_comments` chứa digest body+anchor của đúng revision; `review_comments.frozen_digest` chỉ pin khi first reply commit. Khi reserve reply, khóa submission và comment, xác minh comment vẫn có ở **current** publication; đánh dấu pending_reply_operation, pin digest vào request fingerprint. Một reply pending mỗi comment để giữ message_no. Hiển thị local “Đang gửi”, chưa thông báo đã gửi.

Publisher cũng khóa submission/comments. Candidate publish phải giữ mọi comment có message hoặc pending reply với **cùng digest**, không được xóa/đổi body hoặc anchor. Nếu teacher đang sửa/xóa comment A và student reserve reply A thắng trước, publish trả `409 COMMENT_LOCKED`, giữ local draft, yêu cầu khôi phục comment A rồi đính chính bằng message mới. Không sửa candidate âm thầm. Nếu publish thay A thắng trước reserve reply thì student nhận `409 PUBLICATION_CHANGED`, tải current trước khi gửi; không gắn câu trả lời vào text mới mà student chưa đọc.

Tin gửi mỗi tin một `.md` immutable, không append/update một thread file. Sau verify transaction insert message + set frozen_digest + clear pending + operation commit + notification. Message body/author reference/timestamp nằm trong Drive envelope; DB chỉ metadata. Nếu upload fail chắc chắn, hủy pending pin dưới lock; unknown giữ pin đến reconcile/hủy. Hủy trước commit làm late file orphan; committed message không sửa/xóa (F38). Hệ thống khóa cả overall comment nếu có reply bằng comment UUID loại overall; overall rỗng không tạo thread. Student chỉ thấy thread của comment còn trong current publication; publisher bắt buộc giữ comment có replies nên không làm mất thread khi re-publish. Chỉ teacher được đọc publication cũ; messages không tạo endpoint để lách quyền đọc nội dung publication cũ.

## 10. Library mutations

Một item ID ổn định, metadata text trong Markdown manifest. Với Markdown, envelope chứa nội dung và metadata. PDF/TXT: object bytes + manifest `.md` riêng (slot document/prompt trong operation; current_object trỏ manifest có asset UUID nội bộ). Backend validate manifest chỉ tham chiếu đúng managed blob của item. Loại file kiểm MIME/magic, không dựa extension, không chấp nhận link import hoặc shortcut. Student có thể bấm link an toàn trong Markdown theo D12, nhưng không có phương thức thêm external link item F40.

Draft save dùng stream/lease, **không** đổi visible current. “Lưu thay đổi” reserve library_save operation và base item.version; ghi candidate bundle, verify toàn bộ, transaction đổi current object + item version/state active. Share/favorites/featured theo item ID giữ nguyên; student đọc current mới sau commit. Nếu Drive/DB fail vẫn current cũ hoặc unknown, không lộ bản draft. Change share/featured dưới owner/class locks, kiểm class active; cùng save có thể giữ nguyên share list hoặc request cập nhật metadata riêng, không queue text.

Delete F16: transaction item `deleting`, tăng version, clear featured của item, chặn read/list/favorite/download mới ngay; giữ shares/favorites tombstone để không bị mất ngoài ý muốn nếu troubleshooting. Reserve delete operation + snapshot danh sách **mọi file app quản lý thuộc item** (current, draft generation, blobs/assets) trong `library_delete_files`, không trash file shared bởi item khác. Ngừng mọi pending save của item bằng reject; save worker đến muộn không revive item, candidate thêm cleanup. Sau đó trash từng ID bằng `files.update(trashed=true)`, GET xác minh; state per-file, retry chỉ ID chưa xác minh. Khi tất cả verified trashed → deleted + op committed. Không báo “Đã xóa hoàn toàn trên Drive” khi còn partial failure. Không dùng permanent delete.

Nếu 403/quota/timeout trên một file: item vẫn ẩn, UI teacher “Đã gỡ khỏi thư viện; chưa chuyển hết file vào thùng rác Drive”, cho retry same operation. 404 là inaccessible/missing, không phải bằng chứng trash thành công; giữ task cần đối chiếu, không falsely finish. Đã mất vĩnh viễn thì admin vận hành có thể đánh dấu cleanup không xác minh được, không tự khôi phục content hoặc hiển thị success toàn phần. Không rollback item active sau vài file đã trash. Favorite không cấp quyền, featured không hiển thị mục deleting. Xóa file dùng chung giữa items bị cấm trong bản đầu: asset ownership riêng item để deletion closure cụ thể.

## 11. Transaction boundaries và xử lý lỗi

Không transaction phân tán Drive–Postgres, không giữ row lock qua network. Transaction T1 validate/reserve intent/file IDs → Drive create/read-back → T2 revalidate/finalize pointers/events. Worker chỉ giữ metadata claim (`worker_epoch/until`), mọi finalization dùng compare epoch; lease worker hết hạn không trao quyền sửa nội dung. Reconciliation có quyền connector nội bộ giới hạn trên op đã reserve, không role admin đọc nội dung; bytes được đọc tạm để verify, không lưu payload.

Lock order chung: teacher user → class → assignment → membership → recipient → stream → submission → comments UUID ascending → item → operation. Mỗi mutation khóa đủ policy rows có thể đổi: suspend/archive/remove/close dùng cùng row nên barrier có thứ tự. Approve/backfill/publish locks class; nhiều class share lock ascending. Không khóa operation trước policy rồi đảo chiều. Retry deadlock/serialization chỉ transaction metadata, không tạo ID/file mới; [PostgreSQL isolation](https://www.postgresql.org/docs/18/transaction-iso.html) mô tả serialization failures cần retry transaction.

| Lỗi/điểm crash | Durable state và xử lý | Người dùng thấy |
|---|---|---|
| Offline trước reserve | Chỉ local; chưa có operation chính thức | Chưa sync/chưa nộp; tải `.md` |
| DB T1 fail | Không gửi Drive write; retry khi DB phục hồi | Chưa ghi nhận thao tác |
| Drive timeout/5xx/connection reset | unknown; GET preallocated ID; không ID mới, không worker re-upload submit | Chưa xác nhận; status/retry cùng key |
| 403 rateLimitExceeded / 429 | Retry bounded exponential+jitter, Retry-After nếu có; async metadata GET vẫn được | Tạm giới hạn; giữ local |
| 403 storageQuotaExceeded | needs_client; dừng upload; giải phóng quota bởi teacher, user retry | Drive hết dung lượng, chưa hoàn tất |
| 401 → refresh thất bại/invalid_grant | reconnect_required; bảo toàn expected account; không đổi credentials bằng student | Cần teacher kết nối lại |
| 403 insufficientFilePermissions/appNotAuthorized | unavailable/forbidden; không auto retry write vô hạn | Không có quyền Drive |
| GET 404/trashed file đã committed | missing (404 có thể do mất quyền); chặn dependent edit/publish | Không tìm thấy hoặc không còn quyền; không hứa đã bị xóa chắc chắn |
| GET 404 candidate unknown | Chưa chứng minh không có late create; giữ unknown/needs_client có pin | Chưa xác nhận; cùng operation |
| Drive success, DB T2 fail/crash | Candidate đã reserve; reconcile verify + T2 theo policy hiện tại | Chưa xác nhận cho đến DB committed |
| DB commit success, ACK mất | status cùng key → result cũ | Đã nộp/trả một lần |
| Reconcile sau close/archive/suspend/remove | Reject nếu chưa commit; orphan; không tự revive khi quyền phục hồi | Thao tác không được hoàn tất; local còn |
| Hash mismatch | conflict, freeze affected version; không thay expected hash | Nội dung bị thay đổi; chặn chấm/xuất điểm hợp lệ |
| Delete library success một phần | deleting + per-file cleanup metadata; hidden, retry phần còn lại | Gỡ khỏi app, Drive cleanup chưa xong |

Phân loại 403 theo reason, không coi mọi 403 là revoked. [Google error guide](https://developers.google.com/workspace/drive/api/guides/handle-errors) nêu 404 có thể do file không tồn tại **hoặc thiếu quyền**, và đề nghị exponential backoff cho quota/rate limit phù hợp. Không đưa raw error body vào DB/log. Đề xuất mỗi request tối đa 30 s, backoff 1/2/4/8 s có jitter, GET reconcile giãn tới 5 phút; không có timeout nào chứng minh old Drive request không còn chạy. 503/403/404 không trả nội dung giả, không thay score bằng 0. Retry upload chính thức chỉ từ user/cùng key; autosave có thể tự retry khi lease còn hợp lệ.

## 12. Toàn vẹn, missing và xử lý ngoài Drive

Hash SHA-256 **bytes cuối cùng upload** UTF-8, LF; normalize trước pin, không normalize lại bytes khi verify. `expected_sha256` chỉ đặt lúc reserve rồi bất biến. Drive `version` tăng cả khi thay đổi metadata, nên chỉ là hint, không đủ kết luận nội dung đổi; `sha256Checksum` có điều kiện có mặt cho blob theo [files resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files). Luôn có fallback GET media tự hash, kiểm MIME/size/trashed. Không dùng md5 hay modifiedTime làm bằng chứng duy nhất. Rename/move không đổi hash thì không freeze content, nhưng folder/ownership sai cần báo connection/path anomaly.

Khi đọc submission, source review, publication, message, library: verify bytes trước render và authorize dependency closure. Submission mismatch → conflict/freeze grading version, không tự bind annotations vào bytes khác. File deleted/trashed → missing; permission/network failure → unavailable, không xóa lịch sử metadata. Hash đúng trở lại có thể unfreeze sau verify đầy đủ, audit; thao tác restore bytes thực hiện bởi teacher ngoài app từ bản tải xuống/Drive revision còn tồn tại, app không hứa có bản đó. Không ghi đè expected hash để “chấp nhận phiên bản mới”; bài mới phải là submission mới theo hành động student.

Ảnh đề/reference cũng hash và quyền riêng, mất ảnh hiển thị placeholder unavailable chứ không coi ảnh trống. Review publication mismatch không lộ nội dung bị sửa ngoài ứng dụng như kết quả hợp lệ; giữ pointer và báo unavailable/conflict, không tự quay về old publication cho student. Tin nhắn mismatch giữ ID/thread nhưng không hiển thị text không xác minh.

UX cần xác nhận thêm nếu muốn: cách teacher chọn nguồn khôi phục file và có cần hỗ trợ tải **bytes bị thay ngoài app** để điều tra. Mặc định thiết kế chỉ hiển thị thông tin lỗi/metadata, không có nút “chấp nhận bản ngoài Drive”, không giải phóng freeze bằng admin role. Đây không chặn schema/giao thức đã thiết kế.

## 13. Contract editor/review

Contract chi tiết và envelope ví dụ ở [EDITOR-REVIEW-CONTRACT.md](EDITOR-REVIEW-CONTRACT.md). API không tin editor tree/HTML; validate Markdown AST cho cả visual/source/paste/import, student không images/raw HTML/MDX/unsafe URLs, teacher chỉ managed image refs. Annotation nằm ở review envelope, không sửa Markdown student. Trích dẫn/anchor offsets/body chỉ trên Drive/local, DB giữ digest/IDs.

Đã đọc đầy đủ artifact agent-1 `docs/technical/EDITOR-VALIDATION.md` trong clone `spike/editor-validation` cùng mã projection/review ngày 20/11/2026. Contract thống nhất stable asset path và `vv-render-text-v1` UTF-16 theo spike; envelope production bổ sung server-owned identity/rubric hash/operation, không tự dùng schema spike làm schema chính thức. Xem bảng đối chiếu trong contract; kết quả mock/browser của agent-1 không là kiểm chứng backend/Drive của thiết kế này.

## 14. Kiểm chứng và traceability

[validation/README.md](validation/README.md) ghi lệnh, kết quả thực tế và giới hạn. SQL thực thi trong PostgreSQL tạm; SQL scenarios kiểm constraints/predicates/CAS; Python model kiểm interleavings/crash/retry/state visibility. Các kiểm tra này không chứng minh OAuth, mạng Drive hoặc backend chưa tồn tại chạy end-to-end.

| Quyết định | Phần thiết kế bao phủ |
|---|---|
| D01–D03 | §3–4 tenant, role, provisioning |
| D04–D09 | §2, §8–9 Drive-only, explicit submit, review md |
| D10–D12 | §5, §13 contract Markdown/ảnh |
| D13–D16 | §7–8, §12 hash, local sync, single writer |
| D17–D18 | §4–6 suspend và same-account latch |
| D19–D24 | §3–4, §6 shared identity, approval, reset và trust |
| F01–F06 | §9 nháp/công bố/version/comment race |
| F07–F13 | §3, §8–9 rubric, assignment, deadline, close/reference |
| F14–F17 | §10 library types/share/delete, bỏ AI |
| F18–F22 | §3, §6–8 archive/remove/readmit/recipient backfill |
| F23–F29 | §2, §6, §9, contract: exports, local clock, notifications, no teacher drafts, explanation, optional reference, rubric exception |
| F30–F34 | §9–10 complete scores, immutable publication, scan, explicit library save, no demo |
| F35–F42 | §3, §6, §9–10 latest aggregate, closed seed, publication visibility, immutable messages, featured, no external library, extension/F42 |

Đánh đổi chính: copy-on-write tốn Drive quota/API; bảng điểm không có score cache nên phụ thuộc Drive và cần tải theo lô có giới hạn; server không thể phục hồi local payload đã mất; app không khóa được Drive owner sửa file; status metadata không bảo đảm content hiện đang available. Điểm phải kiểm chứng trước triển khai: Picker+drive.file trên OAuth test account, upload pre-ID/read-back/retry, Keycloak forced-change không email/provisioning race, KMS/token lifecycle, editor canonical text/ảnh và backend concurrency/injection tests. Không dùng credentials cá nhân hoặc production để kiểm chứng phiên này.
