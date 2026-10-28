# Benchmark

`profilefinder-benchmark-30.csv` — 30 company/role pairs used to measure ProfileFinder on the live site:

- rows 1–12: leadership roles (one holder each), the same as the 2026-10-28 live check;
- rows 13–30: specific roles many people hold (Mechanical Engineer, Data Scientist, Recruiter …), including the bugatti.com case that used to return nothing.

How to run it: log in on the live site, open **Bulk**, upload the file, start it, then download the Excel file. It uses about 300 search credits (≈ $0.30) and takes about 4–5 minutes.

How to read it: per-search diagnostics (queries, credits, the candidate funnel and the decision — never snippets) are in the `search_diagnostics` table. Targets:

- leadership rows: the right person in at least 11 of 12, and nobody wrong marked "Verified";
- specific roles: at least one credible profile at the company in at least 90% of rows, at most ~14 credits per search.
