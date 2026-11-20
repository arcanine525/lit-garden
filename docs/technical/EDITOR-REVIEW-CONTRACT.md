# Contract editor, review và Markdown trên Drive

Thiết kế v1 ngày 20/11/2026, đồng hành [DATA-AUTH-DRIVE-DESIGN](DATA-AUTH-DRIVE-DESIGN.md). Chưa là API đã triển khai. Không phụ thuộc vào một editor package cụ thể.

## 1. API ứng dụng

| Endpoint đề xuất | Request đáng chú ý | Response/guard |
|---|---|---|
| `GET /drafts/:streamId` | Session actor từ server | Authorized Markdown envelope, headVersion/hash, lease holder summary; teacher không đọc student stream |
| `POST /drafts/:streamId/lease` | sessionId, action acquire/takeover; CSRF | epoch, expiresAt, headVersion; 423 nếu holder khác |
| `PATCH /drafts/:streamId/lease` | sessionId, epoch | Renew chỉ khi chưa expired, policy còn hợp lệ |
| `DELETE /drafts/:streamId/lease` | sessionId, epoch | Release có fencing; old release không hủy lease mới |
| `POST /drafts/:streamId/saves` | key, epoch, sessionId, baseVersion, envelope | 200 committed/version; 202 unknown/status; 409 stale; local chưa clear khi 202 |
| `POST /recipients/:id/submissions` | explicit key, epoch/sessionId, source headVersion, envelope snapshot | 201 sau DB+Drive; 202 chưa xác nhận; duplicate committed trả result cũ |
| `POST /assignments/:id/publish` | key, draftVersion, envelopeHash, sessionId/epoch | Atomic visible recipients sau verify toàn bộ slots |
| `POST /submissions/:id/review-publications` | key, draftVersion, currentPublicationId, submissionHash, sessionId/epoch | Đủ điểm, source hash đúng, comment pin hợp lệ |
| `POST /comments/:id/messages` | key, currentPublicationId, commentDigest, message envelope | Cùng key/digest trả intent cũ; key mới gặp pending khác trả 409 OP_IN_PROGRESS; không ghi đè pin |
| `POST /library/:id/publish` | key, draftVersion, itemVersion, sessionId/epoch | Explicit Lưu thay đổi; giữ shares/favorites |
| `DELETE /library/:id` | key, itemVersion | 202 deleting/partial; chỉ 200 deleted khi file cleanup verified |
| `GET /operations/:id` | Không nhận actor/owner trong query | State enum, result UUID, error enum; auth lại target |
| `GET /submissions/:id/publication` | Student chỉ current | Không cho student tùy chọn old revision |
| `GET /assets/:id?resource=:uuid` | Resource typed trong route thực tế | Manifest closure + auth, không chỉ teacher match |

Responses dùng DTO allowlist; không trả Drive tokens hoặc raw Drive errors. `request_digest` tính server từ canonical user-input bytes + tuple immutable, không tin hash client; `expected_sha256` tính trên final file bytes sau khi thêm IDs/acceptedAt đã pin trong T1. Payload local phải giữ nguyên khi dùng lại key. Input của editor không có server-owned fields; server dựng final envelope xác định từ input và intent đã lưu, không tạo timestamp/ID khác khi retry. Cùng serialization version, canonical JSON key order, UTF-8 và LF. Khi canonicalization đổi user input, trả canonical input/hash cho browser lưu local; không silently đổi payload của key cũ.

`submitted_at/created_at` trong file chính thức được pin từ `accepted_at` operation; IDs file/message/publication được pin ở reserve, không dựng mới trong mỗi retry. Trường server-owned khác bị client giả mạo → 422, không âm thầm tin dữ liệu. Save ACK chỉ có giá trị nếu version/hash khớp buffer snapshot đã gửi; không clear các phím gõ đến sau snapshot. 202 không được đổi toast thành “Đã nộp”.

## 2. Envelope Markdown v1

Một file `.md` gồm front matter YAML **giới hạn**: scalar strings/integers/arrays và một JSON object dưới scalar `garden` (cú pháp JSON là subset YAML); sau `---` là body Markdown. Parser an toàn, không custom YAML tags, aliases, duplicate keys hoặc unsafe deserialize. JSON bên trong cùng `.md` là dữ liệu cấu trúc, **không** là `.json` sidecar (D09). Không cho editor sửa front matter hệ thống; chỉ edit body và các field nội dung được phép. Nội dung cấu trúc không render như HTML.

Ví dụ submission sau reserve (fixture tổng hợp, không dữ liệu người dùng):

```markdown
---
garden: {"schema":"garden.submission/1","id":"10000000-0000-0000-0000-000000000001","assignmentId":"10000000-0000-0000-0000-000000000002","recipientId":"10000000-0000-0000-0000-000000000003","acceptedAt":"2026-11-20T03:00:00Z","explanation":"Em làm rõ ý kết."}
---
# Khu vườn

Em chăm cây mỗi ngày.
```

Draft cùng loại envelope `garden.student-draft/1` gồm recipientId, explanation và body; không submission ordinal trong bytes vì ordinal được cấp lúc finalize (tránh gaps/pending). Server bảo đảm IDs/acceptedAt bằng intent reserve. Download `.md` bao gồm explanation, không tách cột DB.

Assignment draft bundle: `garden.assignment-draft/1` có title, prompt/material/reference content dưới các field nội dung trong front matter hoặc sections với IDs cố định, selected rubric ID/revision và scale. Publish chia file prompt/material body, reference body optional, rubric snapshot body+structured criteria. File rubric `garden.rubric-snapshot/1` chứa criteria `{id,label,max,levels:[{id,score,description}]}`, max/scale/rounding. Không tham chiếu definition DB hiện tại khi mở/chấm bài cũ.

Ví dụ review publication trong cùng `.md`:

```markdown
---
garden: {"schema":"garden.review-publication/1","id":"20000000-0000-0000-0000-000000000001","submissionId":"10000000-0000-0000-0000-000000000001","submissionSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","rubricSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","textProjection":"vv-render-text-v1","scores":[{"criterionId":"c1","levelId":"l2","value":"1.00"}],"comments":[{"id":"30000000-0000-0000-0000-000000000001","kind":"range","body":"Ý này rõ.","anchor":{"start":0,"end":3,"exact":"Em ","prefix":"","suffix":"chăm","projectionSha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"color":"yellow"}],"overallCommentId":null}
---
```

Review draft schema tương tự, scores được null/thiếu; publication phải đủ mọi criterion, không trùng ID, không nhận unknown criterion/level. Điểm decimal string, validation max/range theo snapshot. `overallCommentId` khi có trỏ comment kind overall; nhận xét chung không bắt buộc, không cho cùng comment ID hai body. Body file review có thể là bản Markdown có thể đọc của rubric/overall/comments nhưng là **projection do server sinh**, không nguồn thứ hai để editor tùy ý sửa. Source of truth trong structured garden; nếu body được sinh, validator kiểm nó khớp projection trước commit. Có thể để body rỗng và render từ garden như ví dụ, không bắt lặp content.

`garden.message/1`: `{id,submissionId,commentId,authorId,acceptedAt,inReplyToMessageId?}` ở front matter, body là message Markdown. Mỗi message file riêng bất biến; không sidecar JSON/thread mutable. Teacher/student chỉ gửi body và reply target; server pin identity/timestamp. Library manifest `garden.library/1` có title/category/author/sourceLabel/excerpt và blob/asset UUIDs; sourceLabel là text mô tả, không external-link item. Tài liệu Markdown chứa body; PDF/TXT manifest tham chiếu managed blob bằng UUID.

Assets manifest phải liệt kê UUID/hash/MIME mục nào dùng, nằm trong envelope Drive; DB drive_objects chỉ index ref/hash. Không lấy link Drive trong Markdown để cấp quyền tự động. Title/excerpt/explanation/anchor quote/body đều chịu ranh giới content, không được trích sang notification hay operation.

## 3. Canonical text và annotation

Hai hash riêng:

- `submissionSha256`: SHA-256 **toàn bộ bytes envelope** đã nộp, DB giữ để verify file và source identity.
- `projectionSha256`: SHA-256 UTF-8 chuỗi text projection `vv-render-text-v1`, chỉ trong review `.md`, không lấy DOM.innerText thay thế.

Thống nhất `vv-render-text-v1` với agent-1: parser CommonMark+GFM remark-parse 11/remark-gfm 4 theo spike; đầu vào projection là **body bài viết**, không front matter. Duyệt AST depth-first theo thứ tự children: text leaf thêm value (CRLF/CR→LF, không NFC/trim); node break thêm LF; sau children của paragraph/heading/tableRow thêm LF; sau tableCell thêm TAB (kể cả ô cuối). Không tự thêm separator cho list/blockquote, không gộp separator; image alt/src, link destination và definition không góp text. Offsets là **UTF-16 code units** `[start,end)`, phù hợp JS, kiểm không cắt surrogate pair; không tự dùng Python code point index. Bản đầu không mở rộng sang code/inlineCode/task-list/strikethrough chưa kiểm chứng trong spike.

Đã đọc implementation `projectMarkdown` và fixture browser của agent-1; vẫn phải giữ fixture input/output chính xác trong ứng dụng khi scaffold; adapter phải cung cấp `serializeProjection(ast)` duy nhất và mapping reversible từ editor text nodes sang offsets, không dựa DOM layout. Trong bản đầu nếu chưa chứng minh mapping trên mọi node đang bật thì vô hiệu annotation trên node chưa supported; không bịa vị trí bằng substring đầu tiên. Cùng version projection phải có fixture input/output bytes để hash ổn định. Thay đổi thuật toán → `vv-render-text-v2`, không remap file cũ tự động.

Anchor `{projectionSha256,start,end,exact,prefix,suffix}` kết hợp submission ID/hash, không dùng quote duy nhất vì đoạn có thể lặp. Restore yêu cầu source hash và projection hash đúng, `projection.slice(start,end)===exact`, boundaries đúng. Prefix/suffix giúp chẩn đoán, không fallback tự chuyển anchor. Sai → unresolved annotation + freeze thao tác publish liên quan, không tô nhầm. Annotation từ submission v1 không được chuyển sang v2. Overlaps nhiều màu/comments có thứ tự render ổn định theo comment UUID; không thay student source để tô màu.

Fingerprint comment để khóa reply là SHA-256 canonical JSON của `{id,kind,body,anchor,color}` với key sort và UTF-8 ổn định, không gồm publication ID. Quy tắc cố ý khóa cả anchor/color cùng text sau reply, tránh thay ngữ cảnh câu trả lời. Publisher có thể đổi điểm tiêu chí khác nhưng không đổi/xóa comment frozen. Không để dedup theo text khiến hai comment trùng câu bị gộp.

## 4. Markdown và ảnh riêng tư

Server parse AST trong visual và source/import: allow headings, bold/italic, lists, tables, quotes, safe links. Cấm raw HTML/MDX/JSX, arbitrary attribute/style, data URI, event handlers, javascript/file URLs. Student cấm image AST kể cả reference-style, HTML `<img>`, pasted Markdown và hidden source; teacher chỉ image `/api/assets/UUID` có managed resource ownership. Không tải URL arbitrary phía server (tránh biến proxy thành fetch bên ngoài), không làm SSRF khi render links.

Editor plugin lấy image bytes qua authorized app API, tạo object URL trong memory và revoke khi unmount; không serialize object/blob URL vào Markdown chính thức. Download Markdown giữ refs logical; tùy chọn export ảnh ZIP chưa thuộc scope F23 nên không hứa sẵn. Student không thể xin thumbnail của ảnh chỉ teacher có quyền bằng UUID đoán được.

## 5. Contract địa phương và đối chiếu agent-1

Browser IndexedDB key `{userId,teacherId,streamId}` giữ `{localRevision,baseServerVersion,baseHash,pendingEnvelope,operationKey,leaseEpoch,sessionId,syncState}`. Clock/focus timer chỉ local, không đẩy vào submit/review metadata hay thống kê chấm. Khi có local chưa sync và server head khác, mở so sánh/khôi phục local có chủ đích; không silent last-write-wins. Reconnect luôn đọc operation status rồi head trước sync. Lease không đi cùng nội dung tải `.md`.

Ở lần bàn giao ban đầu ngày 20/11/2026, agent2 chỉ đọc `EDITOR-VALIDATION.md`, `src/markdown.js`, `src/review.js` và kết quả 16 logic/6 browser do agent1 báo cáo. Phiên sửa sau review đã chạy lại spike với reference adapter và kiểm lỗi import: 20 logic/9 browser PASS, evidence lưu tại clone agent1. Đây vẫn là kiểm chứng local/mock, chưa phải tích hợp production giữa hai nhánh.

| Điểm | Thống nhất và phần cần adapter |
|---|---|
| Asset path | Chọn `/api/assets/<UUID>` đúng stable reference spike; URL view TTL chỉ runtime, không trong Markdown. Lease ảnh khác edit lease, có thể đề xuất TTL 60 s và luôn auth lại GET. |
| Projection | Dùng chính `vv-render-text-v1` theo thuật toán spike, loại image alt; bỏ proposal `garden-text/1` khác separator để không nhập nhằng offsets. Prefix/suffix tối đa 32 UTF-16 code units, giữ Unicode NFD/emoji. |
| Hash scope | Spike hash raw Markdown body; production hash toàn file envelope bytes theo DB, projection chỉ body. Adapter tách body và không thay baseline theo hash mới. |
| Review schema | Spike `vv-review-proposal-v1` → production `garden.review-publication/1`; đổi contentHash → submissionSha256, annotations → comments, thêm rubricSha256 và IDs/context pin server. Migration chỉ importer explicit khi đủ source hash; không xem spike là file production đã phát hành. |
| Front matter | Cả hai dùng cấu trúc trong `.md`, không sidecar JSON; production grammar `garden` JSON object trong YAML restricted là serialization mới cần fixture parse/round-trip, chưa được spike chứng minh. |
| Nội dung support | Giữ subset đã test, không mở code/task-list/HTML/MDX/resize ảnh. Source textarea ngoài editor có gate là lựa chọn spike, chưa chứng minh diffSourcePlugin gốc. |
| Race và visibility | Giữ immutable pubs/current-only student; bổ sung DB lock + pending reply pin trước upload, fencing và operation reconciliation, vượt phạm vi ledger in-memory của spike. |
| Điểm cần test khi tích hợp | Private Drive thật, OAuth, adapter envelope, hash bytes, source integrity mỗi save/publish, đa process/thiết bị, Keycloak và ACL đầy đủ. |

Ví dụ projection chốt: body `Em **chăm** cây.\n` → `Em chăm cây.\n`; bảng mỗi cell có TAB cuối và mỗi row có LF; không trim LF cuối projection. Fixture offsets/Unicode độc lập ở `validation/protocol_model.py` kiểm quy ước UTF-16, chưa chứng minh selection DOM ngoài spike agent-1.

## Bổ sung sau review R1–R5

Agent1 đã sửa reference link/image bằng adapter sang inline trước khi import/paste; validator, adapter và mock API đều resolve definition đầu tiên. Lỗi import nội bộ phải giữ source và chặn lưu, không dùng getMarkdown fallback làm bằng chứng round-trip. Corpus `utf16-anchor-cases.json` trong validation có cùng bytes với fixture tests của agent1; cả JS tạo/restore anchor và Python slice phải từ chối boundary cắt surrogate.

Đối với student autosave/submit, close/archive/remove/suspend phải reject intent mất quyền ngay trong transaction thu hồi quyền. Reopen/restore không hồi sinh intent; takeover/acquire sau expiry cũng phải giải phóng pending operation epoch cũ ngay, không chờ worker đọc Drive. Reply retry kiểm key trước current publication; pin không được ghi đè bởi key khác, không được clear bởi cancel trễ của operation cũ. Chi tiết transaction tại mục 11 của thiết kế.
