import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { KNOWLEDGE_KINDS } from "../knowledge";

type NavLeaf = { to: string; label: string; icon: string };
type NavGroup = { label: string; icon: string; prefix: string; children: { to: string; label: string }[] };
type NavEntry = NavLeaf | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

export function navItems(role: string): NavEntry[] {
  const items: NavEntry[] = [
    { to: "/", label: "Dashboard", icon: "dashboard" },
    { to: "/projects", label: "Project Documents", icon: "folder_open" },
    {
      label: "Knowledge Base",
      icon: "hub",
      prefix: "/knowledge",
      children: KNOWLEDGE_KINDS.map((kind) => ({ to: `/knowledge/${kind.slug}`, label: kind.label })),
    },
  ];
  if (role === "Admin") {
    items.push({
      label: "Settings",
      icon: "settings",
      prefix: "/settings",
      children: [
        { to: "/settings/llm", label: "LLM" },
        { to: "/settings/layouts", label: "Document Layouts" },
        { to: "/settings/users", label: "Users" },
        { to: "/settings/audit", label: "Audit Log" },
      ],
    });
  }
  return items;
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-1.5 transition-colors ${isActive ? "bg-cobalt text-on-cobalt" : "text-muted hover:bg-inset hover:text-ink"}`;

function Group({ group, onNavigate }: { group: NavGroup; onNavigate?: () => void }) {
  const location = useLocation();
  const inside = location.pathname.startsWith(group.prefix);
  const [open, setOpen] = useState(inside);
  const expanded = open || inside;
  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors ${inside ? "text-ink" : "text-muted hover:bg-inset hover:text-ink"}`}
        onClick={() => setOpen(!expanded)}
      >
        <span className="material-symbols-outlined">{group.icon}</span>
        <span className="flex-1">{group.label}</span>
        <span className="material-symbols-outlined text-base">{expanded ? "expand_less" : "expand_more"}</span>
      </button>
      {expanded && (
        <div className="mt-0.5 ml-5 space-y-0.5 border-l border-hairline pl-2">
          {group.children.map((child) => (
            <NavLink key={child.to} to={child.to} onClick={onNavigate} className={linkClass}>
              <span>{child.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function SideNav({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5 p-3" aria-label="Primary">
      {navItems(role).map((entry) =>
        isGroup(entry) ? (
          <Group key={entry.prefix} group={entry} onNavigate={onNavigate} />
        ) : (
          <NavLink key={entry.to} to={entry.to} end={entry.to === "/"} onClick={onNavigate} className={linkClass}>
            <span className="material-symbols-outlined">{entry.icon}</span>
            <span>{entry.label}</span>
          </NavLink>
        ),
      )}
    </nav>
  );
}
