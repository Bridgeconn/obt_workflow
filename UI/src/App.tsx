import { useEffect, useState } from "react";
import useAuthStore from "@/store/useAuthStore";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  Navigate,
  useParams,
} from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import LoginPage from "@/pages/Login";
import SignupPage from "@/pages/Signup";
import Navbar from "@/components/Navbar/Navbar";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectDetailsPage from "./pages/ProjectsDetail";
import ProfilePage from "./pages/Profile";
import UsersTable from "./pages/Users";

function AppContent() {
  const { checkAuthStatus } = useAuthStore();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const hideNavbarPaths = ["/login", "/signup"];
  useEffect(() => {
    const checkAuth = async () => {
      const isAuthenticated = await checkAuthStatus();

      setIsAuthenticated(isAuthenticated);
      setLoading(false);
    };

    checkAuth();
  }, [location.pathname]);

  if (loading) {
    return <div>Loading...</div>;
  }
  let user;
  if (isAuthenticated) {
    user = useAuthStore.getState().user;
  }

  const showNavbar = isAuthenticated;

  return (
    <>
      {showNavbar && !hideNavbarPaths.includes(location.pathname) && <Navbar />}
      <Routes>
        <Route
          path="/login"
          element={
            isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />
          }
        />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          path="/profile"
          element={
            isAuthenticated ? <ProfilePage /> : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/users"
          element={
            isAuthenticated ? (
              user?.role === "Admin" ? (
                <UsersTable />
              ) : (
                <Navigate to="/" replace />
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/"
          element={
            isAuthenticated ? <ProjectsPage /> : <Navigate to="/login" replace />
          }
        />
        <Route
         path = "/projects/:projectId"
         element={
           isAuthenticated ? <ProjectRouteWrapper /> : <Navigate to="/login" replace />
         }
         />
      </Routes>
    </>
  );
}

const ProjectRouteWrapper: React.FC = () => {
  const { projectId  } = useParams<{ projectId: string }>();

  if (!projectId) {
    return <Navigate to="/projects" replace />;
  }

  return <ProjectDetailsPage projectId={parseInt(projectId)} />;
};

function App() {
  return (
    <Router>
      <Toaster />
      <AppContent />
    </Router>
  );
}

export default App;
