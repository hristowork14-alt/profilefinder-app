export default function App() {
  return (
    <div className="site">
      <header className="header">
        <a className="brand" href="/" aria-label="ProfileFinder home">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="14" cy="14" r="8" />
            <path d="m20 20 7 7" />
          </svg>
          ProfileFinder
        </a>
        <span className="edition">A place to start</span>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <p className="eyebrow">People. Roles. Connections.</p>
          <h1 id="page-title">
            The right people.
            <br />A clearer path.
          </h1>
          <p className="description">ProfileFinder is designed to help you find public LinkedIn profiles by company and job title.</p>
          <aside className="status" aria-labelledby="status-title">
            <span className="status-mark" aria-hidden="true" />
            <div>
              <h2 id="status-title">Search is not available yet</h2>
              <p>This is a minimal replacement page. Profile search, accounts, bulk uploads, and history still need to be restored.</p>
            </div>
          </aside>
        </section>
        <div className="illustration" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="profile-shape">
            <div className="avatar" />
            <div className="line line-long" />
            <div className="line line-short" />
            <span className="profile-label">A new connection</span>
          </div>
          <span className="illustration-caption">Discover the people behind the company.</span>
        </div>
      </main>

      <footer>
        <span>ProfileFinder</span>
        <span>Minimal edition · Search unavailable</span>
      </footer>
    </div>
  );
}
