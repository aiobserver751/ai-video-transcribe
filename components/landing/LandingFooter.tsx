
export default function LandingFooter() {
  return (
    <footer className="border-t border-gray-200">
      <div className="container flex flex-col gap-6 py-8 md:py-12 px-4 md:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:gap-8 lg:gap-12">
          <div className="flex-1 space-y-4">
            <div className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6 text-indigo-600"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
              <span className="text-xl font-bold">TranscribeYT</span>
            </div>
            <p className="text-sm text-gray-500">
              Convert YouTube videos to text quickly and accurately.
              Perfect for content creators, researchers, and students.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 md:gap-8 lg:gap-12">
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Product</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#features" className="text-gray-500 hover:text-gray-900">Features</a>
                </li>
                <li>
                  <a href="#pricing" className="text-gray-500 hover:text-gray-900">Pricing</a>
                </li>
                <li>
                  <a href="#faq" className="text-gray-500 hover:text-gray-900">FAQ</a>
                </li>
              </ul>
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Company</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#about" className="text-gray-500 hover:text-gray-900">About</a>
                </li>
                <li>
                  <a href="#blog" className="text-gray-500 hover:text-gray-900">Blog</a>
                </li>
                <li>
                  <a href="#careers" className="text-gray-500 hover:text-gray-900">Careers</a>
                </li>
              </ul>
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Legal</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#terms" className="text-gray-500 hover:text-gray-900">Terms</a>
                </li>
                <li>
                  <a href="#privacy" className="text-gray-500 hover:text-gray-900">Privacy</a>
                </li>
                <li>
                  <a href="#cookies" className="text-gray-500 hover:text-gray-900">Cookies</a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="text-sm text-gray-500">© 2025 TranscribeYT. All rights reserved.</div>
      </div>
    </footer>
  );
}
