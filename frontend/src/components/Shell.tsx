import { useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { THEME_LABELS, themeIcon, useTheme } from "../theme";
import { ChatWidget } from "./ChatWidget";
import { SideNav } from "./SideNav";

export function Shell() {
  const { user, logout } = useAuth();
  const { next, toggle } = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <div className="h-screen flex flex-col bg-canvas text-ink">
      <header className="h-14 shrink-0 border-b border-hairline bg-panel flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button type="button" className="btn lg:hidden" aria-label="Open navigation" onClick={() => setNavOpen(true)}>
            <span className="material-symbols-outlined">menu</span>
          </button>
          <Link to="/" className="flex items-center gap-2">
            <span className="h-8 w-8 rounded bg-cobalt text-on-cobalt flex items-center justify-center">
              <span className="material-symbols-outlined">hub</span>
            </span>
            <span className="font-headline text-xl font-semibold leading-8 whitespace-nowrap sm:text-[32px]" data-testid="wordmark">
              SolutionCrafter
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn" aria-label="Toggle theme" title={`Switch to ${THEME_LABELS[next]}`} onClick={toggle}>
            <span className="material-symbols-outlined">{themeIcon(next)}</span>
          </button>
          <span className="font-label text-[10px] uppercase text-muted whitespace-nowrap">
            {user.login_id} - {user.role_name}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <aside className={`${navOpen ? "fixed inset-y-14 left-0 z-30 flex w-64" : "hidden"} lg:flex lg:static w-60 shrink-0 border-r border-hairline bg-panel`}>
          <div className="flex-1">
            <SideNav role={user.role_name} onNavigate={() => setNavOpen(false)} />
          </div>
        </aside>
        {navOpen && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setNavOpen(false)} />}
        <main className="flex-1 min-w-0 overflow-auto">
          <Outlet />
        </main>
      </div>
      <ChatWidget open={chatOpen} onOpen={setChatOpen} />
    </div>
  );
}
