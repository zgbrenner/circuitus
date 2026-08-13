import { Search } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';

const NAV_ITEMS = [
  'Practice Guides',
  'Templates',
  'Exhibits',
  'Authorities',
  'Dockets',
  'Citations',
  'Depositions',
  'Matters',
  'Models',
  'Compliance',
  'Audio',
];

interface TopBarProps {
  onLogout: () => void;
  activeNav: string;
  onNavChange: (nav: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchSubmit: () => void;
}

export default function TopBar({
  onLogout,
  activeNav,
  onNavChange,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
}: TopBarProps) {
  const user = getCurrentUser();

  return (
    <header className="bg-navy text-paper flex-shrink-0 relative">
      {/* Top masthead row */}
      <div className="flex items-center h-[52px] px-5 gap-5">
        {/* Wordmark — the C is set in the display serif italic against a tiny brass slab */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <span
            className="w-7 h-7 flex items-center justify-center font-display italic text-brass-bright text-xl leading-none"
            style={{
              borderTop: '1px solid #B8932B',
              borderBottom: '1px solid #B8932B',
              paddingTop: 1,
            }}
            aria-hidden
          >
            C
          </span>
          <div className="leading-none">
            <p className="font-display text-[20px] font-semibold tracking-tight text-paper">
              Circuitus
            </p>
            <p className="font-sans text-[8.5px] tracking-masthead uppercase text-brass-bright/90 mt-1">
              For Counsel · Est. 2026
            </p>
          </div>
        </div>

        {/* Decorative vertical hairline */}
        <span className="hidden md:block w-px h-7 bg-paper/15 flex-shrink-0" aria-hidden />

        {/* Search — feels like the case-search bar at the top of a research database */}
        <div className="flex-1 max-w-xl">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-paper/35"
              aria-hidden
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit()}
              placeholder="Search Practice Library…"
              aria-label="Search Practice Library"
              className="w-full bg-paper/[0.06] border border-paper/15 pl-9 pr-3 py-1.5 text-[12px] text-paper placeholder-paper/35 font-sans focus:outline-none focus:border-brass-bright/60 focus:bg-paper/[0.10] transition-colors"
              style={{ borderRadius: 1 }}
            />
          </div>
        </div>

        <span className="hidden md:block w-px h-7 bg-paper/15 flex-shrink-0" aria-hidden />

        {/* Nav — small caps, brass underline on active. Wraps to second row on narrow. */}
        <nav className="hidden lg:flex items-center gap-1 flex-shrink-0">
          {NAV_ITEMS.map((item) => (
            <button
              key={item}
              onClick={() => onNavChange(item)}
              aria-current={activeNav === item ? 'page' : undefined}
              className="relative group px-2.5 py-1.5"
            >
              <span
                className={`font-sans text-[10px] uppercase font-medium tracking-marque transition-colors ${
                  activeNav === item
                    ? 'text-brass-bright'
                    : 'text-paper/55 group-hover:text-paper/85'
                }`}
              >
                {item}
              </span>
              <span
                className={`absolute left-2.5 right-2.5 -bottom-px h-px transition-all ${
                  activeNav === item ? 'bg-brass-bright' : 'bg-transparent'
                }`}
                aria-hidden
              />
            </button>
          ))}
        </nav>

        {/* Compact nav for narrow viewports */}
        <select
          value={activeNav}
          onChange={(e) => onNavChange(e.target.value)}
          className="lg:hidden bg-paper/[0.06] border border-paper/15 text-paper text-[10px] font-sans uppercase tracking-marque px-2 py-1 focus:outline-none focus:border-brass-bright/60"
          aria-label="Section"
          style={{ borderRadius: 1 }}
        >
          {NAV_ITEMS.map((item) => (
            <option key={item} value={item} className="bg-navy text-paper">
              {item}
            </option>
          ))}
        </select>

        {/* User — initials in a brass-bordered seal */}
        <div className="flex items-center gap-3 flex-shrink-0 pl-4 ml-1 border-l border-paper/15">
          <div
            className="w-7 h-7 flex items-center justify-center text-brass-bright text-[10px] font-sans font-semibold uppercase tracking-[0.08em]"
            style={{
              border: '1px solid rgba(184, 147, 43, 0.5)',
              background: 'rgba(184, 147, 43, 0.08)',
              borderRadius: 1,
            }}
          >
            {user?.email?.charAt(0) || 'U'}
          </div>
          <button
            onClick={onLogout}
            className="hidden sm:inline font-sans text-[9.5px] uppercase tracking-marque text-paper/45 hover:text-paper transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Double rule — thick brass over thin ink, the masthead signature */}
      <div className="rule-double" aria-hidden />
    </header>
  );
}
