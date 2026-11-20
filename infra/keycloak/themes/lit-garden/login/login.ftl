<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Đăng nhập · Vườn Văn</title>
  <link rel="stylesheet" href="${url.resourcesPath}/garden.css">
</head>
<body>
<main class="login">
  <div class="art"><img src="${url.resourcesPath}/img/book.webp" alt="Khu vườn nhỏ trên trang sách">
    <p>Một khu vườn nhỏ<br>nhiều trang viết đang chờ.</p>
  </div>
  <div class="login-content">
    <p class="wordmark">Vườn Văn</p>
    <h1>Vào khu vườn của mình</h1>
    <#if message?? && message.type == 'error'><p role="alert">Tên đăng nhập hoặc mật khẩu chưa đúng.</p></#if>
    <form action="${url.loginAction}" method="post">
      <label for="username">Tên đăng nhập</label>
      <input id="username" name="username" autocomplete="username" required>
      <label for="password">Mật khẩu</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Đăng nhập</button>
    </form>
    <p class="muted">Tài khoản do giáo viên hoặc quản trị viên cấp.</p>
  </div>
</main>
</body>
</html>
