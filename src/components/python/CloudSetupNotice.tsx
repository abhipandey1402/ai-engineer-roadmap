export function CloudSetupNotice({ reason }: { reason: string }) {
  return (
    <aside className="runtime-setup" aria-live="polite">
      <h2>Set up cloud runtimes</h2>
      <p>{reason}</p>
      <p>Link the project, pull its environment, then add the required server values:</p>
      <pre><code>{`vercel link
vercel env pull
vercel env add SANDBOX_ENABLED
vercel env add PLAYGROUND_SESSION_SECRET
vercel env add PLAYGROUND_ACCESS_TOKEN`}</code></pre>
      <p className="runtime-setup-note">Values stay in Vercel. This page never displays them.</p>
    </aside>
  )
}
