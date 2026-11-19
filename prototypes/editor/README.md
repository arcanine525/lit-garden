# Editor validation spike — Vườn Văn

Prototype bỏ đi sau khi chuyển phần đã kiểm chứng vào ứng dụng. Câu hỏi: MDXEditor có giữ Markdown hai chiều, chèn ảnh qua adapter riêng tư và cho renderer phục hồi annotation từ một review Markdown mà không sửa bài gốc không?

Đây là harness kỹ thuật, không phải giao diện sản phẩm hoặc hệ thống xác thực. Không dùng dữ liệu học sinh thật. API giả lập Drive/tài khoản bằng bộ nhớ; không đọc Google credentials. Bản build tĩnh không chứa API mock (API chỉ chạy khi `dev`).

Từ root repo:

```sh
npm --prefix prototypes/editor ci --cache /private/tmp/lit-garden-editor-npm-cache
npm --prefix prototypes/editor run dev
```

Mở <http://127.0.0.1:4311>. Chọn vai giáo viên/học sinh, chuyển mã Markdown, thử ảnh mock. Tại bài gốc bên dưới, chọn một đoạn → ghi review → reload; chỉ chuỗi review Markdown được giữ trong `localStorage` key `PROTOTYPE-review.md`. Có thể sửa/nạp hoặc tải chính chuỗi này thành `.review.md`. Xóa key bằng DevTools để đặt lại. Không có JSON sidecar.

Kiểm chứng:

```sh
npm --prefix prototypes/editor test
npm --prefix prototypes/editor run test:browser
npm --prefix prototypes/editor run build
```

Môi trường đã chạy: Node 24.18.0, npm 11.16.0, Chrome 157.0.8103.79 trên macOS. Playwright cấu hình `channel: chrome`, cần Chrome được cài. Chạy test browser tự mở/tắt server; tránh dùng cùng server đang thao tác thủ công vì các fixture API dùng chung bộ nhớ.

[Kết luận, ma trận và contract đề xuất](../../docs/technical/EDITOR-VALIDATION.md). [Evidence](evidence/) chứa Markdown mẫu, JSON round-trip và ảnh sau reload; không commit cache, build, trace hoặc dependencies.
