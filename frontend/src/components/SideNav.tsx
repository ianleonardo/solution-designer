import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { KNOWLEDGE_KINDS } from "../knowledge";
import { permissionsOf, type Permissions } from "../permissions";

type NavLeaf = { to: string; label: string; icon: string };
type NavGroup = { id: string; label: string; icon: string; prefix: string; children: { to: string; label: string }[] };
type NavEntry = NavLeaf | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

/** The menu for a role: an area the role has no access to is left out. */
export function navItems(access: Permissions | string): NavEntry[] {
  const allowed = typeof access === "string" ? permissionsOf({ role_name: access }) : access;
  const items: NavEntry[] = [{ to: "/", label: "Dashboard", icon: "dashboard" }];
  if (allowed.projects !== "none") items.push({ to: "/projects", label: "Project Documents", icon: "folder_open" });
  if (allowed.knowledge !== "none") {
    items.push({
      id: "knowledge",
      label: "Knowledge Base",
      icon: "hub",
      prefix: "/knowledge",
      children: KNOWLEDGE_KINDS.map((kind) => ({ to: `/knowledge/${kind.slug}`, label: kind.label })),
    });
  }
  if (allowed.settings !== "none") {
    items.push({
      id: "settings",
      label: "Settings",
      icon: "settings",
      prefix: "/settings",
      children: [
        { to: "/settings/llm", label: "LLM" },
        { to: "/settings/layouts", label: "Document Layouts" },
        { to: "/settings/users", label: "Users" },
        { to: "/settings/roles", label: "User Roles" },
        { to: "/settings/audit", label: "Audit Log" },
      ],
    });
  }
  return items;
}

function navButtonClass(active: boolean) {
  return `flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors ${
    active ? "bg-cobalt text-on-cobalt" : "text-muted hover:bg-inset hover:text-ink"
  }`;
}

function NavItem({
  to,
  end,
  onNavigate,
  children,
}: {
  to: string;
  end?: boolean;
  onNavigate?: () => void;
  children: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const active = end ? location.pathname === to : location.pathname === to || location.pathname.startsWith(`${to}/`);
  return (
    <button
      type="button"
      className={navButtonClass(active)}
      aria-current={active ? "page" : undefined}
      onClick={() => {
        navigate(to);
        onNavigate?.();
      }}
    >
      {children}
    </button>
  );
}

function Group({
  group,
  expanded,
  onToggle,
  onNavigate,
}: {
  group: NavGroup;
  expanded: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const inside = location.pathname.startsWith(group.prefix);
  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors ${inside ? "text-ink" : "text-muted hover:bg-inset hover:text-ink"}`}
        onClick={onToggle}
      >
        <span className="material-symbols-outlined">{group.icon}</span>
        <span className="flex-1">{group.label}</span>
        <span className="material-symbols-outlined text-base">{expanded ? "expand_less" : "expand_more"}</span>
      </button>
      {expanded && (
        <div className="mt-0.5 ml-5 space-y-0.5 border-l border-hairline pl-2">
          {group.children.map((child) => (
            <NavItem key={child.to} to={child.to} end onNavigate={onNavigate}>
              <span>{child.label}</span>
            </NavItem>
          ))}
        </div>
      )}
    </div>
  );
}

function groupIdForPath(pathname: string, role: Permissions | string): string | null {
  for (const entry of navItems(role)) {
    if (isGroup(entry) && pathname.startsWith(entry.prefix)) return entry.id;
  }
  return null;
}

export function SideNav({
  role,
  permissions,
  onNavigate,
}: {
  /** Old fixed role name; `permissions` wins when given. */
  role?: string;
  permissions?: Permissions;
  onNavigate?: () => void;
}) {
  const access: Permissions = permissions ?? permissionsOf(role ? { role_name: role } : null);
  const location = useLocation();
  const routeGroup = groupIdForPath(location.pathname, access);
  const [openId, setOpenId] = useState<string | null>(routeGroup);

  useEffect(() => {
    if (routeGroup) setOpenId(routeGroup);
  }, [routeGroup]);

  return (
    <nav className="flex flex-col gap-0.5 p-3" aria-label="Primary">
      {navItems(access).map((entry) =>
        isGroup(entry) ? (
          <Group
            key={entry.id}
            group={entry}
            expanded={openId === entry.id}
            onNavigate={onNavigate}
            onToggle={() => setOpenId((current) => (current === entry.id ? null : entry.id))}
          />
        ) : (
          <NavItem key={entry.to} to={entry.to} end={entry.to === "/"} onNavigate={onNavigate}>
            <span className="material-symbols-outlined">{entry.icon}</span>
            <span>{entry.label}</span>
          </NavItem>
        ),
      )}
    </nav>
  );
}
