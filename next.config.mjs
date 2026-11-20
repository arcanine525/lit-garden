export default {
  async headers() {
    return [{ source: '/drive', headers: [{
      key: 'Content-Security-Policy',
      value: "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline' https://apis.google.com https://ssl.gstatic.com https://www.gstatic.com; frame-src https://docs.google.com https://drive.google.com https://apis.google.com; style-src 'self' 'unsafe-inline'"
    }] }];
  }
};
