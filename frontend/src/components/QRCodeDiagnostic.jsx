import { useState } from 'react';
import { AlertCircle, CheckCircle, XCircle, Loader, RefreshCw, X } from 'lucide-react';
import api from '../services/api';
import { verifySession } from '../utils/auth';
import { getBackendBaseUrl, getApiBaseUrl } from '../utils/apiConfig';

function QRCodeDiagnostic({ onClose }) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);

  const runDiagnostics = async () => {
    setRunning(true);
    setResults(null);
    
    const diagnosticResults = {
      timestamp: new Date().toISOString(),
      checks: []
    };

    try {
      // Check 1: Backend API connectivity
      try {
        const apiBaseUrl = getApiBaseUrl();
        const healthCheck = await fetch(`${apiBaseUrl}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });
        diagnosticResults.checks.push({
          name: 'Backend API Connectivity',
          status: healthCheck.ok ? 'success' : 'error',
          message: healthCheck.ok 
            ? 'Backend server is reachable' 
            : `Backend returned status ${healthCheck.status}`,
          details: {
            status: healthCheck.status,
            statusText: healthCheck.statusText
          }
        });
      } catch (err) {
        diagnosticResults.checks.push({
          name: 'Backend API Connectivity',
          status: 'error',
          message: 'Cannot reach backend server',
          details: {
            error: err.message,
            suggestion: 'Check if backend server is running'
          }
        });
      }

      // Check 2: QR Codes endpoint
      try {
        const response = await api.get('/videos/qr-codes');
        diagnosticResults.checks.push({
          name: 'QR Codes Endpoint',
          status: 'success',
          message: `Successfully fetched ${response.data?.length || 0} QR codes`,
          details: {
            count: response.data?.length || 0,
            endpoint: '/api/videos/qr-codes'
          }
        });
      } catch (err) {
        diagnosticResults.checks.push({
          name: 'QR Codes Endpoint',
          status: 'error',
          message: err.response?.data?.error || err.message || 'Failed to fetch QR codes',
          details: {
            status: err.response?.status,
            error: err.message,
            suggestion: 'Check authentication and backend configuration'
          }
        });
      }

      // Check 3: Filter values endpoint
      try {
        const response = await api.get('/videos/filters');
        const hasVersions = response.data?.versions && response.data.versions.length > 0;
        diagnosticResults.checks.push({
          name: 'Filter Values Endpoint',
          status: 'success',
          message: 'Filter values loaded successfully',
          details: {
            subjects: response.data?.subjects?.length || 0,
            grades: response.data?.grades?.length || 0,
            units: response.data?.units?.length || 0,
            lessons: response.data?.lessons?.length || 0,
            modules: response.data?.modules?.length || 0,
            versions: response.data?.versions?.length || 0,
            hasVersions: hasVersions
          }
        });
      } catch (err) {
        diagnosticResults.checks.push({
          name: 'Filter Values Endpoint',
          status: 'error',
          message: err.response?.data?.error || err.message || 'Failed to fetch filter values',
          details: {
            status: err.response?.status,
            error: err.message
          }
        });
      }

      // Check 4: Authentication
      try {
        const isAuthenticated = await verifySession();
        diagnosticResults.checks.push({
          name: 'Authentication',
          status: isAuthenticated ? 'success' : 'error',
          message: isAuthenticated ? 'Authenticated session found' : 'No authenticated session',
          details: {
            hasSession: isAuthenticated
          }
        });
      } catch (err) {
        diagnosticResults.checks.push({
          name: 'Authentication',
          status: 'error',
          message: 'Error checking authentication',
          details: {
            error: err.message
          }
        });
      }

    } catch (err) {
      diagnosticResults.checks.push({
        name: 'Diagnostic Error',
        status: 'error',
        message: err.message || 'Unknown error occurred',
        details: {
          error: err.toString()
        }
      });
    }

    setResults(diagnosticResults);
    setRunning(false);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-yellow-600" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b-2 border-slate-200 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-xl">
              <AlertCircle className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900">QR Code Diagnostics</h2>
              <p className="text-sm text-slate-600">Check QR code system health and connectivity</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <X className="w-6 h-6 text-slate-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {!results && !running && (
            <div className="text-center py-12">
              <p className="text-slate-600 mb-6">Run diagnostics to check QR code system status</p>
              <button
                onClick={runDiagnostics}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold flex items-center gap-2 mx-auto"
              >
                <RefreshCw className="w-5 h-5" />
                Run Diagnostics
              </button>
            </div>
          )}

          {running && (
            <div className="text-center py-12">
              <Loader className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
              <p className="text-slate-600">Running diagnostics...</p>
            </div>
          )}

          {results && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-slate-500">
                  Completed at {new Date(results.timestamp).toLocaleString()}
                </p>
                <button
                  onClick={runDiagnostics}
                  disabled={running}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />
                  Run Again
                </button>
              </div>

              {results.checks.map((check, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-xl border-2 ${getStatusColor(check.status)}`}
                >
                  <div className="flex items-start gap-3">
                    {getStatusIcon(check.status)}
                    <div className="flex-1">
                      <h3 className="font-bold text-slate-900 mb-1">{check.name}</h3>
                      <p className="text-sm text-slate-700 mb-2">{check.message}</p>
                      {check.details && (
                        <div className="mt-2 p-3 bg-white rounded-lg border border-slate-200">
                          <pre className="text-xs text-slate-600 whitespace-pre-wrap">
                            {JSON.stringify(check.details, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-slate-50 border-t-2 border-slate-200 p-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-slate-600 text-white rounded-xl hover:bg-slate-700 transition-colors font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default QRCodeDiagnostic;

