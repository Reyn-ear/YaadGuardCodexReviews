import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import appCss from '../styles.css?url'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`
const queryClient = new QueryClient()

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Yaad Guard',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  notFoundComponent: NotFoundPage,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}

function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[760px] items-center px-4 py-20 sm:py-28">
      <section className="w-full rounded-[2rem] border border-[var(--line)] bg-[linear-gradient(180deg,var(--surface-strong),var(--surface))] px-6 py-10 text-center shadow-[var(--shadow)] backdrop-blur-[22px] sm:px-10 sm:py-14">
        <p className="mb-4 text-xs font-extrabold tracking-[0.22em] text-[var(--ink-faint)] uppercase">
          Route Not Found
        </p>
        <h1 className="text-4xl font-bold tracking-[-0.04em] text-[var(--ink)] sm:text-5xl">
          That page does not exist.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[var(--ink-soft)]">
          The requested route could not be matched. Return to the map experience.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center rounded-full bg-[linear-gradient(135deg,var(--accent),#7ee7c8)] px-5 py-3 text-sm font-semibold text-slate-950 no-underline shadow-[0_16px_36px_var(--accent-glow)] hover:-translate-y-0.5"
          >
            Open Map
          </Link>
        </div>
      </section>
    </main>
  )
}
