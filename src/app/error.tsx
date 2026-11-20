'use client';

export default function AppError({ reset }: { reset: () => void }) {
  return <main className="app-standalone">
    <section className="app-panel" role="alert">
      <h1>Chưa tải được trang</h1>
      <button className="app-primary" onClick={reset}>Thử lại</button>
    </section>
  </main>;
}
