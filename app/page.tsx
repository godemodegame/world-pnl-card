function Planet({ small = false }: { small?: boolean }) {
  return (
    <span
      className={small ? "planet planet--small" : "planet planet--large"}
      aria-hidden="true"
    >
      <img className="planet-art" src="/world-planet-cutout.png" alt="" />
    </span>
  );
}

export default function Home() {
  return (
    <main className="page-shell">
      <article className="result-card result-card--negative" aria-label="World negative market result card">
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
              <strong>No</strong>
              <span className="check check--negative" aria-label="Resolved negatively">×</span>
            </div>
            <p className="muted">Market resolved</p>
          </div>

          <div className="divider" />

          <div className="pnl-block">
            <p className="eyebrow">Your PNL</p>
            <p className="pnl-value">-127.45 <span>USDC</span></p>
            <p className="roi"><span>ROI</span> -28.34%</p>
          </div>
        </section>

        <section className="visual-column" aria-hidden="true">
          <Planet />
        </section>

        <div className="status-pill" aria-label="Outcome: lost">
          <span className="status-dot" />
          <span>Lost</span>
        </div>
      </article>
    </main>
  );
}
