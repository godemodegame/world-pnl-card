function Planet({ small = false }: { small?: boolean }) {
  return (
    <span
      className={small ? "planet planet--small" : "planet planet--large"}
      aria-hidden="true"
    >
      <img className="planet-art" src="/world-planet-hq.png" alt="" />
    </span>
  );
}

export default function Home() {
  return (
    <main className="page-shell">
      <article className="result-card" aria-label="World market result card">
        <div className="grid-field" aria-hidden="true" />
        <div className="corner-glow" aria-hidden="true" />

        <section className="content-column">
          <header className="brand" aria-label="World">
            <Planet small />
            <span className="brand-name">world</span>
          </header>

          <div className="result-block">
            <p className="eyebrow">Result</p>
            <div className="result-line">
              <strong>Yes</strong>
              <span className="check" aria-label="Resolved successfully">
                <img className="check-icon" src="/checkmark-badge.png" alt="" />
              </span>
            </div>
            <p className="muted">Market resolved</p>
          </div>

          <div className="divider" />

          <div className="pnl-block">
            <p className="eyebrow">Your PNL</p>
            <p className="pnl-value">+127.45 <span>USDC</span></p>
            <p className="roi"><span>ROI</span> +28.34%</p>
          </div>
        </section>

        <section className="visual-column" aria-hidden="true">
          <Planet />
        </section>

        <div className="status-pill" aria-label="Outcome: won">
          <span className="status-dot" />
          <span>Won</span>
        </div>
      </article>
    </main>
  );
}
