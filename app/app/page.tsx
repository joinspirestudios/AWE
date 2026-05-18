export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        <h1 className="text-6xl font-bold tracking-tight">Create</h1>
        <p className="mt-6 text-lg text-neutral-600">
          AI-powered carousel generator. Scaffold only — no editor yet.
        </p>
        <div className="mt-8">
          <a
            href="/test/funnel"
            className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Test: funnel →
          </a>
        </div>
      </div>
    </main>
  )
}
