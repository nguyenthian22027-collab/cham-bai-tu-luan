import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { Role } from './types';
import Layout from './components/Layout';
import Login from './pages/Login';
import PendingApproval from './pages/PendingApproval';
import Classes from './pages/Classes';
import Students from './pages/Students';
import Users from './pages/Users';
import ZaloConnection from './pages/ZaloConnection';
import Assignments from './pages/Assignments';
import AssignmentCreate from './pages/AssignmentCreate';
import AssignmentMonitor from './pages/AssignmentMonitor';
import AssignmentGrading from './pages/AssignmentGrading';
import StudentAccounts from './pages/StudentAccounts';
import StudentLogin from './pages/StudentLogin';
import StudentPortal from './pages/StudentPortal';
import StudentWorkRoom from './pages/StudentWorkRoom';
import PublicEssayResultPage from './pages/PublicEssayResult';

function FullScreenLoader() {
  return (
    <div className="center-screen">
      <div style={{ textAlign: 'center', color: 'var(--primary)' }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
        <div style={{ marginTop: 12, fontWeight: 600 }}>Đang tải...</div>
      </div>
    </div>
  );
}

function Protected({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isApproved) return <PendingApproval />;
  if (user.role === Role.STUDENT) return <Navigate to="/student" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/assignments" replace />;
  return <Layout>{children}</Layout>;
}

function StudentProtected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/student-login" replace />;
  if (!user.isApproved || user.role !== Role.STUDENT) return <Navigate to="/student-login" replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isApproved) return <PendingApproval />;
  if (user.role === Role.STUDENT) return <Navigate to="/student" replace />;
  return <Navigate to="/assignments" replace />;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) return <HomeRedirect />;
  return <Login />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/student-login" element={<StudentLogin />} />
      <Route path="/result/:token" element={<PublicEssayResultPage />} />

      <Route path="/student" element={<StudentProtected><StudentPortal /></StudentProtected>} />
      <Route path="/student/assignment/:assignmentId" element={<StudentProtected><StudentWorkRoom /></StudentProtected>} />

      <Route path="/classes" element={<Protected><Classes /></Protected>} />
      <Route path="/students" element={<Protected roles={[Role.ADMIN, Role.TEACHER]}><Students /></Protected>} />
      <Route path="/student-accounts" element={<Protected roles={[Role.ADMIN, Role.TEACHER]}><StudentAccounts /></Protected>} />
      <Route path="/assignments" element={<Protected roles={[Role.ADMIN, Role.TEACHER, Role.TA]}><Assignments /></Protected>} />
      <Route path="/assignments/create" element={<Protected roles={[Role.ADMIN, Role.TEACHER]}><AssignmentCreate /></Protected>} />
      <Route path="/assignments/:assignmentId/monitor" element={<Protected roles={[Role.ADMIN, Role.TEACHER, Role.TA]}><AssignmentMonitor /></Protected>} />
      <Route path="/assignments/:assignmentId/grading" element={<Protected roles={[Role.ADMIN, Role.TEACHER, Role.TA]}><AssignmentGrading /></Protected>} />
      <Route path="/users" element={<Protected roles={[Role.ADMIN]}><Users /></Protected>} />
      <Route path="/zalo-connection" element={<Protected roles={[Role.ADMIN]}><ZaloConnection /></Protected>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
