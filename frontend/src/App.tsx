import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Shell } from "./components/Shell";
import { DashboardPage } from "./pages/DashboardPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LoginPage } from "./pages/LoginPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { LayoutEditorPage } from "./pages/settings/LayoutEditorPage";
import { LayoutsPage } from "./pages/settings/LayoutsPage";
import { LlmPage } from "./pages/settings/LlmPage";
import { UsersPage } from "./pages/settings/UsersPage";
import { WorkspacePage } from "./pages/WorkspacePage";

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-6 text-muted">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireAdmin() {
  const { user } = useAuth();
  if (user?.role_name !== "Admin") return <Navigate to="/" replace />;
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<WorkspacePage />} />
          <Route path="/projects/:projectId/documents/:documentId" element={<WorkspacePage />} />
          <Route element={<RequireAdmin />}>
            <Route path="/knowledge" element={<Navigate to="/knowledge/capabilities" replace />} />
            <Route path="/knowledge/:kind" element={<KnowledgePage />} />
            <Route path="/settings" element={<Navigate to="/settings/llm" replace />} />
            <Route path="/settings/llm" element={<LlmPage />} />
            <Route path="/settings/layouts" element={<LayoutsPage />} />
            <Route path="/settings/layouts/:layoutId" element={<LayoutEditorPage />} />
            <Route path="/settings/users" element={<UsersPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
