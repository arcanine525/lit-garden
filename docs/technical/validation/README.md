# Kiểm chứng thiết kế agent-2

Ngày 20/11/2026 Asia/Ho_Chi_Minh. Baseline `976470f`, nhánh `design/metadata-drive-protocol`. Đây là kiểm chứng thiết kế/tham chiếu, **không phải kiểm thử end-to-end một ứng dụng đã xây dựng**.

## Kết quả đã chạy

| Kiểm tra | Kết quả thực tế | Phạm vi chứng minh |
|---|---|---|
| Nạp toàn bộ `metadata-reference.sql` vào DB rỗng | PASS, PostgreSQL **16.15**, aarch64 Alpine | SQL DDL, FK/check/index/trigger/function/view hợp lệ |
| `schema-scenarios.sql` | **60/60 kiểm tra PASS**, toàn bộ fixture ROLLBACK | Constraints, predicates auth tham chiếu, immutable fields, draft CAS thực thi trong PostgreSQL |
| `protocol_model.py` | **30/30 test PASS**, Python **3.12.0** | State machine và interleaving có điều khiển, Drive giả giữ bytes, metadata model giữ hash/IDs |
| Đối chiếu editor | Đã đối chiếu artifact và corpus UTF-16 của hai nhánh | Contract UTF-16/asset path/production envelope đã đối chiếu, kết quả chạy lại spike agent1 trong phiên sửa được lưu trong evidence của nhánh agent1 |
| Kiểm tra whitespace/link nội bộ/JSON ví dụ | PASS | Chất lượng artifact tài liệu, không thay kiểm tra nghiệp vụ backend |

Container `lit-garden-agent2-schema-check`: image `postgres:16-alpine`, network `none`, không mount volume, không expose port; không dùng `spiral-db` hoặc dữ liệu ứng dụng khác. Đã dừng/xóa container tạm sau kiểm chứng. Mọi tài khoản/ID/hash trong SQL là fixture tổng hợp, không phải credentials cá nhân. Snapshot kiểm chứng và hashes của file được ghi trong [verification.json](verification.json).

## Chạy lại

Từ root repo, cần Docker đang chạy và Python 3.12+. Tên container phải chưa tồn tại; nếu đã có thì dùng tên khác cho toàn bộ lệnh. Đây là database tạm, không chạy DDL thiết kế vào production.

```sh
docker run --rm -d --name lit-garden-agent2-schema-check --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine
docker exec lit-garden-agent2-schema-check pg_isready -U postgres
# Nếu server chưa sẵn sàng, chạy lại pg_isready rồi tiếp tục.
docker exec -i lit-garden-agent2-schema-check psql -U postgres -v ON_ERROR_STOP=1 \
  < docs/technical/metadata-reference.sql
docker exec -i lit-garden-agent2-schema-check psql -U postgres -q -v ON_ERROR_STOP=1 \
  < docs/technical/validation/schema-scenarios.sql
python3 docs/technical/validation/protocol_model.py
docker stop lit-garden-agent2-schema-check
```

DDL không idempotent theo chủ đích, chỉ nạp một lần vào DB rỗng. SQL scenarios chỉ cần schema, không chứa dữ liệu thật và tự rollback. Lần chạy cuối trong phiên dùng database tạm `garden_design_verified`; kết quả schema giống lệnh mặc định trên database rỗng `postgres`. Manifest lưu lại lệnh thực tế.

## Scenario và mức bằng chứng

| Scenario | Bằng chứng đã chạy | Còn phải kiểm tra lúc triển khai |
|---|---|---|
| Admin/giáo viên khác/học sinh khác cố đọc bài, đề, review | SQL predicate + composite FK | HTTP session, list/count/export không bypass auth |
| Shared student ở hai teacher, khóa teacher1 | SQL: teacher2 vẫn write; identity duy nhất | Keycloak disable/logout + session revoke thật |
| Pending/chưa recipient, public reference và người vào muộn F42 | SQL: không recipient bị deny, recipient đọc khi public | Approve/publish/backfill transaction nhiều process |
| Archive/remove/readmit/assignment closed | SQL predicates; model barrier hai thứ tự | Toàn bộ endpoint gồm ảnh/download/notifications |
| Teacher không được xem draft student F26 | SQL typed draft predicate | Route không có raw Drive ID bypass |
| Current-only student, teacher publication history | SQL `readable_review_object` và model | Drive export route/asset manifests của review |
| Crash trước upload | Model: metadata-only, needs_client, không server upload | Process kill, DB connection error, local payload thật |
| Crash sau Drive success trước metadata commit | Model: GET ID/hash rồi finalize đúng op | Network timeout, HTTP 409, same-ID retry với Drive thật |
| DB rollback/ACK mất/duplicate submit | Model + SQL unique key/ordinal | PostgreSQL transaction/worker claim trong backend thật |
| Stale writer: file cũ tới sau head mới | Model + PostgreSQL CAS reject epoch/session/base cũ | Hai browser/tabs + HTTP request thật bị delay |
| Lease expired/takeover/finalize hai thứ tự | SQL CAS + model permutations | Renewal clock/transaction locks/app policy rows |
| Close/archive/remove/suspend thắng trước finalize | Model tám thứ tự barrier/finalize, không tự revive | DB khóa chung với mutation admin/class/membership |
| Reply thắng teacher publish hoặc ngược lại | Model: pending pin/frozen hash/current publication | Multi-process locking, pending cancel và Drive retry |
| Thiếu score, overall optional, draft chưa publish | Model state visibility | Validate exact criterion IDs/decimal/rounding từ rubric snapshot thật |
| Message/publication bất biến, notification dedup | SQL triggers/unique + model | Chặn update/delete routes, kiểm comment fingerprint |
| Library delete partial, 403/404/timeout | Model + SQL deleting hides item | Trash/read-back từng file thật, late candidate cleanup |
| Bản nộp bị sửa ngoài app | Model hash reject; SQL chặn đổi baseline/source | GET media bytes, external editor race, affected-version freeze |
| UTF-16, Unicode NFD, đoạn trích lặp | Model fixture offsets, không cắt surrogate | DOM selection/projection adapter production, browser khác Chrome |

Model là một đặc tả thực thi nhỏ, không copy code backend (repo chưa có backend). Các lời gọi phương thức đại diện transaction đã serialize; permutations minh họa cả hai thứ tự tuyến tính, **không** chứng minh locking hoặc scheduler thực tế. Mô hình không giả vờ tạo distributed transaction Drive–DB. SQL auth functions là predicates tham chiếu, không RLS hoàn chỉnh hay endpoint được bảo vệ sẵn.

## Chưa kiểm chứng live

- OAuth `drive.file` + Picker chọn parent và khả năng tạo/đọc/trash child với project thật; Google account/sub reconnect, refresh token, consent/testing mode.
- `files.generateIds`, multipart upload, real 409/403/quota/404 ambiguity, read-after-write và API latency/throttling.
- Keycloak không email, required action/forced password change, provisioning saga/reset credentials, bootstrap/revoke sessions.
- KMS encryption/rotation và kiểm tra log/cache/request-body trong backend chưa được viết.
- Review/envelope serialization production, private image adapter, CSV streaming, IndexedDB offline, lỗi/giới hạn dung lượng, E2E nhiều thiết bị/process.

Không tìm token cá nhân, không kết nối production, không nhận các kiểm tra mock của agent-1 là kiểm chứng Drive thật. Các giới hạn này cần kiểm chứng tích hợp khi scaffold, không ngăn review schema/protocol hiện tại.

## Hồi quy sau review R2–R5

[protocol-tests.txt](protocol-tests.txt) ghi lần chạy 30 test sau sửa. Model đã kiểm:

- Close/archive/remove/suspend → phục hồi trước reconcile vẫn giữ intent cũ rejected, có hoặc chưa có bytes Drive; intent mới có chủ đích vẫn hoạt động. Phục hồi một điều kiện không vượt điều kiện khác còn khóa.
- Takeover/acquire sau expiry tự reject cả autosave và submit cũ, giải phóng mutex; test stale-write không còn gọi cancel thủ công. Release cũng vô hiệu intent cũ.
- Hai reply khác key cùng comment không ghi đè pin. Retry intent đã committed không pin lại; unknown giữ pin, cancel trễ không xóa pin mới và không làm sống lại intent đã hủy.
- [Corpus UTF-16](utf16-anchor-cases.json) có cùng bytes với `prototypes/editor/tests/utf16-anchor-cases.json` ở agent1; các boundary hợp lệ và cắt surrogate cho cùng kết quả.

Các thao tác model tương ứng transaction đã serialize. Backend chưa được xây nên vẫn cần kiểm locking và crash thật theo contract. DDL/scenario SQL không đổi trong bản sửa; 60 kiểm tra đã được chạy lại ở phiên review trên cùng schema, không nhận model 30 test là bằng chứng DB transaction mới.
