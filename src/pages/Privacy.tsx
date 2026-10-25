import { DEMO_MODE } from '@/lib/config';

export function PrivacyPage() {
  return (
    <article className="max-w-[68ch] text-[16px] leading-relaxed [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.5rem] sm:leading-tight">Privacy</h1>
      <p className="text-muted">A short, plain-language note on what ProfileFinder stores and why.</p>

      {DEMO_MODE && (
        <p className="rounded-md bg-demo-soft px-4 py-3 text-demo">
          You are using the demo. Everything stays in this browser's local storage; nothing is sent to a server.
        </p>
      )}

      <h2>Where results come from</h2>
      <p>
        ProfileFinder looks up public web search results (through a search API) for queries such as “site:linkedin.com/in Company Position”.
        It never logs in to, visits or scrapes LinkedIn. An AI model (Claude, by Anthropic) reads those public search results to rank the
        most likely matches.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Your account: email address and a securely hashed password (handled by Supabase Auth).</li>
        <li>Your searches: the company website and position you entered, the date, and the status.</li>
        <li>
          Results: only what appears in public search results — a person's name, their public headline and their public LinkedIn profile URL
          — plus our confidence score and a one-sentence reason. We never store email addresses, phone numbers or other private data about
          the people found.
        </li>
        <li>A shared cache of recent results (kept up to 7 days) so repeated searches don't call the search API again.</li>
      </ul>

      <h2>Your control</h2>
      <ul>
        <li>Delete any single search, or your whole history, from the History page.</li>
        <li>Delete your account from the Account page. This removes your account and all your searches, results and bulk jobs.</li>
      </ul>

      <h2>Service providers</h2>
      <p>
        Data is stored with Supabase (database and login), the app runs on Netlify, searches go through a web search API (Serper.dev), and
        ranking uses the Anthropic API. The company and position you search for are sent to those services to produce results.
      </p>

      <h2>People who appear in results</h2>
      <p>
        If you found yourself in ProfileFinder results and want them removed from our cache, contact the site owner. Results are only ever
        drawn from information that is already public in web search.
      </p>
    </article>
  );
}
