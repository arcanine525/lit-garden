# Kiểm chứng editor Markdown — Agent 1

Ngày: 20/11/2026 (Asia/Ho_Chi_Minh). Nhánh: `spike/editor-validation`, baseline `976470faefc0ba00145d6a4fe1afb1bad315692f`. Phạm vi là spike cô lập, chưa scaffold ứng dụng Vườn Văn. D01–D24 và F01–F42 là đầu vào; F mới hơn được ưu tiên. Không sửa website tham chiếu, không gọi Drive thật, không tìm/đọc token Google cá nhân.

**Kết luận: khuyến nghị tiếp tục với MDXEditor 4.5.0 kèm adapter Markdown, plugin hard-break và renderer chấm riêng.** Bản mặc định không đạt ca hard-break: giữ chữ nhưng đổi ngắt dòng cứng thành mềm. Plugin export sử dụng API công khai đã sửa được lỗi này; 10 fixture sau adapter giữ ngữ nghĩa và văn bản qua hai vòng DOM. Chưa có bằng chứng buộc phải đổi thư viện. Đây là khuyến nghị kỹ thuật sau spike, không chốt schema nghiệp vụ hay chứng nhận production.

**Ảnh Drive chỉ được kiểm chứng tích hợp bằng mock.** Luồng review lưu/đọc một chuỗi Markdown cục bộ; lifecycle nháp/công bố/hội thoại được thử bằng module bộ nhớ. Chưa có OAuth, Drive API thật, Keycloak, PostgreSQL, đồng bộ nhiều thiết bị hoặc transaction công bố.

## 1. Chạy lại và phiên bản

[Prototype và hướng dẫn thao tác](../../prototypes/editor/README.md). Từ root repo:

```sh
npm --prefix prototypes/editor ci --cache /private/tmp/lit-garden-editor-npm-cache
npm --prefix prototypes/editor run dev
# http://127.0.0.1:4311

npm --prefix prototypes/editor test
npm --prefix prototypes/editor run test:browser
npm --prefix prototypes/editor run build
```

| Thành phần | Phiên bản thực tế được khóa |
|---|---|
| `@mdxeditor/editor` | 4.5.0 (npm registry trả về phiên bản này lúc khảo sát) |
| Lexical | 0.48.0; dependency trực tiếp để dùng type guard công khai trong plugin |
| React / React DOM | 19.2.0 |
| remark-parse / remark-gfm / unified | 11.0.0 / 4.0.1 / 11.0.5 |
| YAML | 2.9.1 |
| Vite / Playwright | 7.3.8 / 1.58.2 |
| Runtime / browser | Node 24.18.0, npm 11.16.0; Chrome 157.0.8103.79, macOS |

`package-lock.json` giữ dependency tree. Cài ban đầu phát hiện advisory trong Vite/YAML/esbuild; đã cập nhật bản sửa và audit lại. Build chỉ chứng minh bundle biên dịch được; API mock nằm trong Vite dev middleware, không đi cùng build tĩnh. Có cảnh báo bundle editor >500 kB và directive `use client` của Radix bị bundler bỏ qua; chưa đo hiệu năng hoặc tích hợp Next.js/SSR.

## 2. Bằng chứng và cách đọc kết quả

- [Round-trip mặc định](../../prototypes/editor/evidence/round-trip-default.json): lần đầu trước plugin hard-break, 9/10 fixture giữ AST ngữ nghĩa; ca ngắt dòng cứng thất bại. Hai lỗi browser khác lúc đầu là selector test nhầm `radio` thành `button` và selector nhiều contenteditable trong bảng, đã sửa test; không quy là lỗi editor.
- [Round-trip sau adapter](../../prototypes/editor/evidence/round-trip.json): từng input, lần xuất 1/2, cờ đổi cú pháp, so AST ngữ nghĩa, so văn bản và phiên bản Chrome.
- [Ảnh annotation sau reload](../../prototypes/editor/evidence/annotation-reloaded.png): vùng chọn qua hai leaf, có chữ đậm, hiện lại đúng highlight/comment.
- [Review Markdown mẫu](../../prototypes/editor/evidence/sample.review.md): metadata YAML, rubric, overall, anchor và phần người đọc; một file duy nhất.
- [Logic tests](../../prototypes/editor/tests/core.test.js) và [browser tests](../../prototypes/editor/tests/editor.spec.js) là kịch bản tái lập. Kết quả cuối: **16/16 logic, 6/6 browser, build thành công, audit 0 vulnerability**. [Manifest kiểm chứng](../../prototypes/editor/evidence/verification.json) liên kết số liệu với môi trường/lệnh; log thực thi nằm cùng thư mục.

So sánh AST bỏ vị trí nguồn, cách viết marker, độ rộng cột bảng, blank-line/spread của list và định nghĩa link sau khi đã resolve. Giữ cấu trúc heading/list/format, thứ tự/bắt đầu danh sách số, alignment bảng, URL/title, text và node hard-break. So chuỗi văn bản riêng giúp phát hiện mất chữ, nhưng **không dùng text bằng nhau để kết luận ngữ nghĩa bằng nhau**: lỗi hard-break chính là phản ví dụ.

## 3. Ma trận Markdown hai chiều

Các ca dưới đây chạy MDXEditor thật trong DOM, `setMarkdown → rich tree → getMarkdown`, rồi đưa kết quả trở lại editor lần nữa. Test UI riêng xác nhận sửa source bằng textarea, áp dụng sang rich text, gõ tiếng Việt, bấm đậm và dán Markdown đã kiểm tra.

| Case | Quan sát mặc định | Kết quả cấu hình spike |
|---|---|---|
| Tiếng Việt, Đ/ắ/ộ/ự, emoji nhiều code point, Unicode NFD | Giữ nguyên chữ/code unit | PASS, hai vòng; không ép NFC |
| Heading H1–H6 | Giữ cấp heading | PASS |
| Bold, italic, kết hợp/lồng nhau | Giữ cấu trúc và chữ | PASS |
| Bullet, list lồng, ordered bắt đầu ở 3 | `-` thành `*`, số bắt đầu không mất | PASS; thay marker hợp lệ |
| Quote nhiều đoạn, quote lồng | Giữ cấu trúc | PASS |
| GFM table, alignment trái/phải, `\|`, bold trong ô | Căn lại spacing bảng | PASS; thay spacing hợp lệ |
| Inline/reference link, title và URL có Unicode percent encoding | Giữ label, URL, title | PASS |
| Soft LF, hai cách hard-break, đoạn mới | **FAIL:** hard-break thành soft LF | **PASS sau plugin**; xuất hard-break bằng `\` + LF |
| Trích đoạn lặp trong/cạnh bold | Không mất/đảo lần xuất hiện | PASS |
| Setext heading, `_`/`__`, newline cuối file | Thành ATX, `*`/`**`, bỏ LF cuối | PASS; chuẩn hóa cú pháp, không mất nội dung |

[hard-break-plugin.js](../../prototypes/editor/src/hard-break-plugin.js) đăng ký `addExportVisitor$` có priority 10: Lexical `LineBreakNode` → mdast `break`. Kiểm tra mã package cài thực tế cho thấy mặc định dùng mdast `text` với LF; soft newline nhập vào TextNode nên vẫn giữ mềm. Không patch `node_modules`. Khi nâng editor phải chạy lại các fixture; đây không phải cam kết tương thích mọi CommonMark.

Giới hạn subset có chủ đích của harness: không HTML, MDX, task-list, strikethrough hoặc code. HTML/MDX bị từ chối trước parse vào editor; source không bật JSX/directive/frontmatter plugin. Những cú pháp nằm ngoài yêu cầu này chưa có quyết định mở rộng sản phẩm. Bộ lọc MDX bảo thủ cũng có thể chặn dấu ngoặc nhọn giống expression trong văn bản; cần thiết kế thông báo/escape trước khi đưa vào sản phẩm.

## 4. Ranh giới quyền soạn và ảnh riêng tư

### Đã làm và thử trong spike

- Source là textarea bên ngoài với nút áp dụng có kiểm tra AST trước `setMarkdown`; rich → source lấy `getMarkdown`. Đây **không phải** thử đầy đủ CodeMirror/diffSourcePlugin gốc. Chọn cách này để không parse/render source chưa hợp lệ trước kiểm tra quyền. Nội dung source chưa hợp lệ vẫn ở textarea để người dùng sửa.
- Chỉ bật `imagePlugin` cho giáo viên, tắt resize/dimensions để tránh xuất HTML `<img>`. Toolbar chỉ bold/italic; chặn shortcut gạch chân. Paste/drop qua capture kiểm tra file/HTML/Markdown; ảnh HTML không được nhập từ clipboard. File PNG giáo viên đi qua `imageUploadHandler` thật của MDXEditor tới backend mock.
- Backend `/api/documents` chạy lại validator, không tin role hoặc validation từ browser. Học sinh không thể gửi ảnh bằng inline/reference Markdown hoặc HTML. Teacher image inline/reference chỉ được dùng ID asset có trong scope fixture. Không đổi quyền Drive thành public.
- Markdown chỉ chứa reference ổn định, ví dụ `![Hoa riêng tư](/api/assets/flower)`. External URL/data URL/view lease/query token đều bị từ chối làm image reference. Link thông thường vẫn được phép theo D12/F40; link `javascript:`/`data:` bị từ chối.
- `imagePreviewHandler` đổi reference thành URL xem ngắn hạn qua API. URL xem gắn với phiên cookie HttpOnly, kiểm tra quyền mỗi GET; copy sang phiên khác bị từ chối. Hết hạn trả 410; xin lease mới được. Remount/nút tải lại ảnh làm mới URL; Markdown không đổi.
- Mất quyền, thiếu file, mất kết nối được giả lập 403/404/503; UI hiện trạng thái và placeholder. Phản hồi ảnh/API có `Cache-Control: private, no-store`, `nosniff`, `no-referrer`. Không trả refresh/access token ra browser hoặc Markdown.

| Case ảnh / quyền | Kết quả và mức chứng minh |
|---|---|
| Teacher chèn ảnh mock → render có `naturalWidth > 0` → xuất MD | PASS browser + HTTP mock |
| Teacher paste PNG qua plugin → API upload → reference ổn định | PASS browser, clipboard event tổng hợp; chưa thử clipboard OS thật |
| Student ảnh source / HTML paste / PNG paste-drop | PASS browser; sự kiện paste/drop tổng hợp bị chặn |
| Student POST nội dung ảnh inline/reference hoặc upload | PASS HTTP mock; không lệ thuộc toolbar |
| Teacher ảnh reference tới ID không tồn tại | Server kiểm tra asset, trả missing; không fetch URL tùy ý |
| Người chưa đăng nhập / admin / outsider xin ảnh | PASS 401/403 mock |
| Student được giao bài xem ảnh đề | PASS mock; học sinh không cần Google account |
| Copy URL sang phiên đăng nhập khác | PASS 403 mock; phiên chưa đăng nhập 401 |
| Lease 1.5 giây hết hạn / cấp lại | PASS 410 rồi 200 mock |
| Quyền bị thu hồi sau khi đã cấp lease | PASS GET lease hiện hành trả 403 mock |
| File mất / connection mất / UI thử lại | PASS 404/503 + placeholder mock |
| OAuth, private Drive bytes, refresh token rotation, `drive.file` + Picker | **CHƯA KIỂM CHỨNG LIVE** |

### Contract ảnh đề xuất cho agent 2 — chưa thống nhất

1. Nội dung lưu reference `/api/assets/{assetId}` (ID nội bộ; ví dụ spike chưa phải schema). DB ánh xạ asset → Drive file ID, owner/tenant, tài liệu chứa asset và phạm vi lớp/bài; Markdown không lưu lease hoặc credentials. ID khó đoán không thay thế ACL.
2. Upload nhận session hiện hành, ngữ cảnh tài liệu và quyền giáo viên; kiểm tra giáo viên không khóa, lớp không lưu trữ, loại tài liệu còn cho sửa. Học sinh không được upload/chèn ảnh. Backend upload Drive trong assets của đúng owner; trả reference sau khi thành công. Cần giải quyết ảnh mồ côi khi upload xong nhưng lưu tài liệu thất bại.
3. `POST /api/assets/{id}/lease → {url, expiresAt}`; `GET url` yêu cầu cùng session và đọc quyền hiện hành theo **tài liệu chứa ảnh**, không chỉ membership lớp. Không cho dùng asset ID bài/lớp/giáo viên khác. Endpoint thật phải kiểm tra assignment grant, library sharing, tham chiếu công khai, quyền đọc của học sinh đã rời lớp, role admin bị cấm; những chiều ACL này chưa được mô phỏng đầy đủ.
4. Server dùng token của owner để đọc bytes bằng Drive `files.get` với `alt=media`; stream/giữ trong request, không disk/CDN/content cache lâu dài. Refresh token mã hóa server-side. Không tạo permission `anyone`. Không redirect browser tới URL Google cần quyền owner. Việc đọc còn phụ thuộc Drive `canDownload` và OAuth scope thực tế.
5. Lease TTL production cần chốt (1.5s chỉ để test); hết hạn/mất session thì xin lại qua ref. Hết quyền/Drive 403 hoặc file missing/trashed thì placeholder, không lặp retry vô hạn. Prototype chỉ có nút/remount để retry, chưa có refresh theo focus/timer hay retry backoff tự động.
6. Ảnh đã tải có thể tiếp tục hiện trên màn hình dù quyền vừa bị thu hồi; TTL/no-store chỉ chặn **request tiếp theo**, không xóa byte đã nhận. Cần dọn component/object URL/cache lúc logout/đổi scope; không hứa thu hồi bản đã tải. Không đưa lease vào log/analytics; ưu tiên cookie HttpOnly, same-origin và CSRF policy cho endpoint ghi.
7. Prototype chỉ check PNG signature, tối đa body 2 MB; **không phải validation file production**. Trước production cần decode/re-encode raster, giới hạn pixel/dung lượng, xử lý EXIF/MIME, hủy upload, retry và kiểm tra owner của file. SVG upload không được hỗ trợ trong spike; SVG placeholder là asset UI tĩnh của ứng dụng.

Tài liệu MDXEditor xác nhận ảnh có kích thước có thể xuất thành HTML và có `imageUploadHandler`/`imagePreviewHandler`; do đó tắt resize và thêm adapter là điều kiện của cấu hình này, không chỉ thay toolbar. [Images](https://mdxeditor.dev/editor/docs/images), [imagePlugin API](https://mdxeditor.dev/editor/api/functions/imagePlugin).

## 5. Review Markdown và anchor

### Contract đã thực thi trong harness, vẫn là đề xuất

`vv-review-proposal-v1` là frontmatter YAML trong **cùng file Markdown** với phần đọc được. Không dùng JSON sidecar; không chèn markup annotation vào bài nộp. YAML là nguồn dữ liệu có thẩm quyền của harness; body được sinh ra để người đọc, sửa body riêng không sửa metadata. Cần có UI giải thích/kiểm tra body drift nếu định hỗ trợ sửa review bên ngoài.

| Trường | Ý nghĩa |
|---|---|
| `schema`, `id`, `kind` | Version format, định danh review, `draft` hoặc `publication` |
| `submissionId`, `version`, `contentHash` | Khóa đúng bài nộp, version và SHA-256 nguyên bản |
| `scores[]` | Criterion ID, value hoặc null cho nháp, max |
| `overall` | Nhận xét chung, được rỗng |
| `annotations[]` | ID ổn định, màu, comment, anchor |
| `anchor.projection` | `vv-render-text-v1`, tên thuật toán text projection |
| `start`, `end` | Khoảng `[start,end)` theo UTF-16 của text projection |
| `exact`, `prefix`, `suffix` | Trích đoạn và tối đa 32 code unit ngữ cảnh mỗi phía |
| `textHash` | SHA-256 của toàn text projection, bổ sung kiểm tra anchor |

Projection lấy text leaf theo thứ tự tài liệu, giữ Unicode nguyên trạng, đổi CRLF trong text leaf sang LF; hard-break là LF; kết thúc paragraph/heading/row là LF; kết thúc table cell là TAB; không tính link destination, image alt/src hoặc definition. Renderer tạo span có `data-start/end` từ chính projection này, selection DOM chuyển về cùng hệ tọa độ. Text node cắt theo các khoảng annotation để render `<mark>`; comment là React text, không thực thi HTML. Renderer spike chỉ phục vụ harness, chưa thay renderer sản phẩm.

`contentHash` trong spike là SHA-256 UTF-8 của toàn chuỗi Markdown bài gốc. Production phải hash **bytes file chính thức đã nộp**, kiểm tra UTF-8 hợp lệ trước decode và giữ hash quản lý độc lập với file. Không lấy hash mới từ file bị thay đổi làm baseline. ID/version lấy từ metadata tin cậy của API, không chỉ nội dung file review do client gửi.

Luồng restore:

1. Parse frontmatter có schema, kiểm tra loại/score/range/ID trùng; YAML duplicate keys và alias bị từ chối.
2. So submission ID/version; sai → `wrong-version`.
3. Bài gốc mất → `missing`; hash khác metadata submission/review → `content-conflict`, không tô/chấm.
4. Tạo lại projection đúng phiên bản; kiểm tra textHash, vị trí, exact, prefix/suffix; sai → `anchor-conflict`. Không dùng tìm trích đoạn đầu tiên hoặc fuzzy reattachment.
5. Chỉ khi tất cả hợp lệ mới render highlight và comment. Tọa độ lặp không bị tự chuyển sang đoạn khác.

| Ca phục hồi | Kết quả |
|---|---|
| Ghi `.review.md` → parse lại scores/overall/comment/anchor | PASS logic; nội dung bài gốc không đổi |
| Chỉ giữ review Markdown cục bộ, reload bài gốc riêng | PASS browser, highlight/comment khôi phục |
| “Hoa nở.” lặp; chọn lần 2 trong bold | PASS logic + browser |
| Vùng chọn đi qua hai text leaf/plain + bold | PASS logic + browser |
| Emoji 👩🏽‍🏫, tiếng Việt NFD `ắ` | PASS logic + browser, không đổi code unit |
| Chọn chữ trong ô bảng | PASS browser |
| Normalize marker trước submit; tạo anchor trên bản chính thức | PASS logic; vị trí text vẫn tương đương |
| File đã nộp chỉ đổi `__` thành `**` ngoài hệ thống | PASS: **khóa** `content-conflict` dù AST/text tương đương |
| Thêm/sửa nội dung bài gốc sau review | PASS logic + browser: bỏ highlight, báo xung đột |
| Khác submission/version hoặc bài gốc bị xóa | PASS logic, không gắn annotation |
| Tọa độ/context/hash/projection sai hoặc YAML lỗi | PASS logic, không reattach âm thầm |

Normalization được phép trong **soạn nháp trước khi chốt file nộp**. Không normalize lại file bất biến để bỏ qua D13. Hash phát hiện thay đổi, không phục hồi bài gốc đã mất; các phiên bản khác phải vẫn sử dụng được khi tích hợp thật. Nếu renderer/projection thay đổi phải giữ thuật toán cũ hoặc migration rõ ràng, không tái diễn giải offset cũ bằng version mới.

## 6. Nháp, công bố, hội thoại và phạm vi kiểm chứng

Module `ReviewLedger` chỉ là probe trong bộ nhớ, một ledger cho một submission/version/hash. Đã thử:

- Nháp thiếu điểm được lưu; publication thiếu điểm, điểm ngoài range bị chặn (F30). Prototype chưa đối chiếu tập criterion/max với rubric snapshot thật hoặc tính tổng quy đổi.
- Sửa nháp không đổi kết quả học sinh đang thấy. Publish tạo bản sao mới, không đổi bản cũ; ID publication trùng bị chặn (F01/F02/F31).
- Teacher đọc nháp + lịch sử; student chỉ `current`; admin bị từ chối. Không có route download review thật để chứng minh bảo mật vận hành (F37).
- Nhận xét đã có reply không sửa/xóa; mọi thao tác sửa/xóa tin gửi bị từ chối. Publish kiểm tra lại nếu reply đến **sau lần lưu nháp**, trước công bố (F06/F38). Không có sửa nhận xét bằng cách đổi ID để né khóa.

Chưa thực thi Drive autosave cho nháp chấm, immutable file thật cho các lần công bố, hội thoại Markdown, ACL tải file, cập nhật current pointer có idempotency, race nhiều process, thông báo, class archive/teacher suspension, hoặc per-version result aggregation. Những phần này thuộc thiết kế/tích hợp agent 2 và triển khai ứng dụng, không được suy ra đã hoàn thành từ test bộ nhớ. UI review của spike dùng duy nhất một publication fixture cục bộ; không phải màn hình lịch sử kết quả sản phẩm.

### Đề xuất giao cho agent 2 — cần đối chiếu schema/giao thức của agent 2

- Giữ file nháp riêng với từng publication riêng; database chỉ lưu metadata/current pointer/hash/ID, không scores/comment/quote/text. Các nội dung anchor, rubric snapshot, review và hội thoại ở Drive theo D04/F29/F31.
- Bổ sung trong envelope thật: teacher/tenant, assignment, submission/version, rubric snapshot ID/hash, draft revision/lease, publication ordinal/operation ID, timestamps; phía server kiểm tra context, không tin ID từ client. Tên/trường trong spike không tự trở thành schema chính thức.
- Criterion ID ổn định phải map đúng rubric snapshot cố định. Publish yêu cầu đủ chính xác các tiêu chí, giới hạn max/scale từ nguồn tin cậy; nhận xét chung vẫn không bắt buộc.
- Annotation/comment ID tồn tại xuyên các lần công bố; thread gắn submission/version/comment và publication nguồn. Reply được append; tin đã gửi bất biến. So bản nháp với nhận xét được công bố có reply trước khi lưu **và trước khi publish** dưới cùng cơ chế điều phối với ghi reply. Thao tác đính chính tạo tin mới.
- Cấp URL/download theo role **trước khi đọc nội dung Drive**: student chỉ current publication của bản nộp họ được xem, không trả hidden history rồi nhờ UI lọc. Teacher mới xem lịch sử. Không expose raw Drive ID/route đọc tùy ý để bypass.
- So contentHash lại ở mở chấm, lưu nháp và publish; missing/conflict khóa đúng bản nộp, không chuyển annotation sang version mới. Cần điều phối/kiểm tra thay đổi giữa các bước vì Drive và DB không có transaction chung.
- Công bố phải giải quyết file-created / DB-pointer-failed / retry bằng operation ID và reconciliation metadata; spike chưa chứng minh tính nguyên tử hay idempotency của Drive. Hash không đủ chống race nếu chỉ kiểm tra khi mở màn hình.
- Cần chốt body frontmatter, hash scope, projection version và chiến lược migration trước production. Dùng sample review làm input thảo luận, không tự thay quyết định F01–F42.

## 7. Những gì còn phải thử ở môi trường thật

1. OAuth consent/`drive.file` + Picker chọn thư mục cha, tạo assets trong đúng Drive, reconnect cùng Google account; upload/read file riêng tư qua token server, không public-sharing. Kiểm tra revoke, quota, trashed/missing, MIME và refresh token lifecycle thật.
2. Keycloak/session/ACL đầy đủ theo assignment/library/reference/removed membership, cùng tài khoản học sinh ở nhiều teacher; không lấy role dropdown mock làm chứng nhận phân quyền.
3. API/Drive round-trip thực tế: ghi/nạp review Markdown, file immutability, raw byte hash và điều phối publish/reply nhiều request/process, crash/retry.
4. Trình duyệt Firefox/WebKit/mobile, bộ gõ tiếng Việt IME thật, clipboard hệ điều hành, accessibility và bàn phím editor, tài liệu dài/ảnh lớn, offline/IndexedDB. Hiện browser smoke chỉ Chrome desktop, sự kiện clipboard được tổng hợp.
5. UI sản phẩm, font Lora/Be Vietnam Pro thật, responsive/baseline mới cho editor; chưa đo pixel-diff >90% hoặc hiệu năng. Không áp chứng cứ screenshot spike lên chứng nhận UI sản phẩm.

## 8. Nguồn chính thức đã tra cứu

Đã đọc tài liệu hiện tại và kiểm tra package thực tế cài trong prototype; tài liệu online có thể thay đổi độc lập phiên bản được khóa.

- [Getting started](https://mdxeditor.dev/editor/docs/getting-started): mount editor và plugin.
- [MDXEditorProps](https://mdxeditor.dev/editor/api/interfaces/MDXEditorProps): `get/setMarkdown`, callback normalization, `suppressHtmlProcessing`; editor không phải renderer đọc bài.
- [Diff/source](https://mdxeditor.dev/editor/docs/diff-source): source/diff plugin gốc; spike dùng source textarea có gate riêng, không chứng nhận toàn bộ plugin này.
- [Extending editor](https://mdxeditor.dev/editor/docs/extending-the-editor), [addExportVisitor](https://mdxeditor.dev/editor/api/variables/addExportVisitor$): cơ chế import/export extension công khai dùng cho sửa hard-break.
- [Drive download](https://developers.google.com/workspace/drive/api/guides/manage-downloads): `files.get` + `alt=media` cho bytes blob và kiểm tra `canDownload`. Đây là thiết kế adapter, chưa phải kết quả live.
- [Drive OAuth scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth): cơ sở kiểm chứng `drive.file`, không thay ACL ứng dụng.
