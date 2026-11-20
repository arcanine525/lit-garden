<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Đổi mật khẩu · Vườn Văn</title>
  <link rel="stylesheet" href="${url.resourcesPath}/garden.css">
</head>
<body>
<main class="password-gate">
  <p class="wordmark">Vườn Văn</p>
  <h1>Đổi mật khẩu</h1>
  <section>
    <h2>Đặt mật khẩu mới</h2>
    <p class="notice">Em cần đổi mật khẩu tạm để tiếp tục.</p>
    <#if message?? && message.type == 'error'><p role="alert">Hai mật khẩu phải khớp và đáp ứng yêu cầu của hệ thống.</p></#if>
    <form action="${url.loginAction}" method="post">
      <label for="password-new">Mật khẩu mới</label>
      <input id="password-new" name="password-new" type="password" autocomplete="new-password" required>
      <label for="password-confirm">Nhập lại mật khẩu mới</label>
      <input id="password-confirm" name="password-confirm" type="password" autocomplete="new-password" required>
      <button type="submit">Đổi mật khẩu</button>
    </form>
  </section>
</main>
</body>
</html>
