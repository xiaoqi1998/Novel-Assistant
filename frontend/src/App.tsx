import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ProjectList from './pages/ProjectList';
import ProjectWizardNew from './pages/ProjectWizardNew';
import Inspiration from './pages/Inspiration';
import HelpPage from './pages/HelpPage';
import ProjectDetail from './pages/ProjectDetail';
import WorldSetting from './pages/WorldSetting';
import Outline from './pages/Outline';
import Characters from './pages/Characters';
import Careers from './pages/Careers';
import Relationships from './pages/Relationships';
import RelationshipGraph from './pages/RelationshipGraph';
import Organizations from './pages/Organizations';
import Chapters from './pages/Chapters';
import ChapterReader from './pages/ChapterReader';
import ChapterAnalysis from './pages/ChapterAnalysis';
import Foreshadows from './pages/Foreshadows';
import WritingStyles from './pages/WritingStyles';
import PromptWorkshop from './pages/PromptWorkshop';
import Settings from './pages/Settings';
import SystemSettings from './pages/SystemSettings';
import AccountCenter from './pages/AccountCenter';
import MCPPlugins from './pages/MCPPlugins';
import UserManagement from './pages/UserManagement';
import PromptTemplates from './pages/PromptTemplates';
import BookImport from './pages/BookImport';
import SkillChat from './pages/SkillChat';
import SkillManage from './pages/SkillManage';
import FullReview from './pages/FullReview';
// import Polish from './pages/Polish';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import ProtectedRoute from './components/ProtectedRoute';
import RootLayout from './components/RootLayout';
import './App.css';

function App() {
  return (
    <>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* 顶级页面统一通过 RootLayout 提供侧边栏 + 顶栏 + 底部版本条 */}
          <Route element={<ProtectedRoute><RootLayout /></ProtectedRoute>}>
            <Route path="/" element={<ProjectList />} />
            <Route path="/projects" element={<ProjectList />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/account" element={<AccountCenter />} />
            <Route path="/system-settings" element={<SystemSettings />} />
            <Route path="/mcp-plugins" element={<MCPPlugins />} />
            <Route path="/prompt-templates" element={<PromptTemplates />} />
            <Route path="/book-import" element={<BookImport />} />
          </Route>

          <Route path="/wizard" element={<ProtectedRoute><ProjectWizardNew /></ProtectedRoute>} />
          <Route path="/inspiration" element={<ProtectedRoute><Inspiration /></ProtectedRoute>} />
          <Route path="/user-management" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
          <Route path="/chapters/:chapterId/reader" element={<ProtectedRoute><ChapterReader /></ProtectedRoute>} />
          <Route path="/project/:projectId" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>}>
            <Route index element={<Navigate to="world-setting" replace />} />
            <Route path="world-setting" element={<WorldSetting />} />
            <Route path="careers" element={<Careers />} />
            <Route path="outline" element={<Outline />} />
            <Route path="characters" element={<Characters />} />
            <Route path="relationships" element={<Relationships />} />
            <Route path="relationships-graph" element={<RelationshipGraph />} />
            <Route path="organizations" element={<Organizations />} />
            <Route path="chapters" element={<Chapters />} />
            <Route path="chapter-analysis" element={<ChapterAnalysis />} />
            <Route path="foreshadows" element={<Foreshadows />} />
            <Route path="writing-styles" element={<WritingStyles />} />
            <Route path="prompt-workshop" element={<PromptWorkshop />} />
            <Route path="skill-chat" element={<SkillChat />} />
            <Route path="skill-manage" element={<SkillManage />} />
            <Route path="full-review" element={<FullReview />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </>
  );
}

export default App;
