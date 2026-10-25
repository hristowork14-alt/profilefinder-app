import { DEMO_MODE } from '@/lib/config';

/** A thin strip so nobody mistakes the demo's fictional people for real search results. */
export function DemoBanner() {
  if (!DEMO_MODE) return null;
  return (
    <div className="bg-demo-soft px-4 py-2 text-center text-sm text-demo">
      <strong className="font-semibold">Demo mode.</strong> Fictional companies and people, generated in your browser. No accounts, keys or
      data leave this page.
    </div>
  );
}
