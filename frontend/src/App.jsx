import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';

// Lazy-load pages to reduce initial bundle size
const PublicVideoPage = lazy(() => import('./pages/PublicVideoPage'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const VideoList = lazy(() => import('./pages/VideoList'));
const VideoEdit = lazy(() => import('./pages/VideoEdit'));
const RedirectViewer = lazy(() => import('./pages/RedirectViewer'));
const CaptionUpload = lazy(() => import('./pages/CaptionUpload'));
const VersionHistory = lazy(() => import('./pages/VersionHistory'));
const StreamPage = lazy(() => import('./pages/StreamPage'));
const StreamDiagnostic = lazy(() => import('./pages/StreamDiagnostic'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const BulkUpload = lazy(() => import('./pages/BulkUpload'));
const QRCodeStorage = lazy(() => import('./pages/QRCodeStorage'));
const VideosTrash = lazy(() => import('./pages/VideosTrash'));
const CSVExport = lazy(() => import('./pages/CSVExport'));
const HTMLEmbedExport = lazy(() => import('./pages/HTMLEmbedExport'));
const VideoDescriptions = lazy(() => import('./pages/VideoDescriptions'));
const MyStorageManager = lazy(() => import('./pages/CloudflareResourceManager'));
const ShortUrlRedirect = lazy(() => import('./pages/ShortUrlRedirect'));

function App() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/admin/login" replace />} />
          <Route path="video/:videoId" element={<PublicVideoPage />} />
          <Route path="stream/:videoId" element={<StreamPage />} />
          <Route path="diagnostic" element={<StreamDiagnostic />} />
          <Route path="diagnostic/:videoId" element={<StreamDiagnostic />} />
          <Route path="admin/login" element={<AdminLogin />} />

          <Route path="admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
          <Route path="admin/bulk-upload" element={<ProtectedRoute><BulkUpload /></ProtectedRoute>} />
          <Route path="admin/videos/inactive" element={<ProtectedRoute><VideoList /></ProtectedRoute>} />
          <Route path="admin/videos" element={<ProtectedRoute><VideoList /></ProtectedRoute>} />
          <Route path="admin/videos/:id/edit" element={<ProtectedRoute><VideoEdit /></ProtectedRoute>} />
          <Route path="admin/qr-codes" element={<ProtectedRoute><QRCodeStorage /></ProtectedRoute>} />
          <Route path="admin/trash" element={<ProtectedRoute><VideosTrash /></ProtectedRoute>} />
          <Route path="admin/csv-export" element={<ProtectedRoute><CSVExport /></ProtectedRoute>} />
          <Route path="admin/html-embed-export" element={<ProtectedRoute><HTMLEmbedExport /></ProtectedRoute>} />
          <Route path="admin/cloudflare" element={<ProtectedRoute><MyStorageManager /></ProtectedRoute>} />
          <Route path="admin/redirects" element={<ProtectedRoute><RedirectViewer /></ProtectedRoute>} />
          <Route path="admin/video-descriptions" element={<ProtectedRoute><VideoDescriptions /></ProtectedRoute>} />
          <Route path="admin/users" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
          <Route path="admin/captions/:videoId" element={<ProtectedRoute><CaptionUpload /></ProtectedRoute>} />
          <Route path="admin/versions/:videoId" element={<ProtectedRoute><VersionHistory /></ProtectedRoute>} />

          {/* Catch-all route for short URLs - must be last */}
          <Route path=":slug" element={<ShortUrlRedirect />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default App;

