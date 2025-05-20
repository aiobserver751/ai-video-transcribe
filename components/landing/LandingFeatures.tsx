export default function LandingFeatures() {
  return (
    <section className="w-full py-12 md:py-24 lg:py-32 bg-gray-50" id="features">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <div className="space-y-2">
            <div className="inline-block rounded-lg bg-gray-100 px-3 py-1 text-sm">Features</div>
            <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl">
                Start Mining Content Insights Today
            </h2>
            <p className="max-w-[900px] text-gray-500 md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
            Transcribe videos, extract captions, and get basic summaries—all. Discover how content analysis can transform your strategy.
            </p>
          </div>
        </div>
        <div className="mx-auto grid max-w-5xl items-center gap-6 py-12 lg:grid-cols-3 lg:gap-12">
          <div className="grid gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
              >
                <path d="m12 19-7-7 7-7" />
                <path d="M19 12H5" />
              </svg>
            </div>
            <h3 className="text-lg font-bold">Simple Submission</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Just paste a YouTube URL and choose your quality preference. Our system handles the rest.
            </p>
          </div>
          <div className="grid gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
              >
                <path d="M6 9H4.5a2.5 2.5 0 0 0 0 5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 1 0 5H18" />
                <path d="M8 9h8" />
                <path d="M8 15h8" />
              </svg>
            </div>
            <h3 className="text-lg font-bold">Fast Processing</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Our advanced system processes your transcription quickly and notifies you when it&apos;s ready.
            </p>
          </div>
          <div className="grid gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" x2="12" y1="15" y2="3" />
              </svg>
            </div>
            <h3 className="text-lg font-bold">Easy Downloads</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Download completed transcriptions as text files for your projects, research, or content creation.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
