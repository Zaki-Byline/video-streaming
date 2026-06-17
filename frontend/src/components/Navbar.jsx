import { Link, useLocation } from 'react-router-dom';
import { logout } from '../utils/auth';

function Navbar() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');
  const isLogin = location.pathname === '/admin/login';
  const isStreaming = location.pathname.startsWith('/stream');

  // Don't show navbar on login page, streaming page, or embed mode
  if (isLogin || isStreaming || new URLSearchParams(location.search).get('embed') === 'true') {
    return null;
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-blue-200 shadow-sm">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo/Brand - Left corner */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center space-x-2">
              <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="text-xl font-bold text-gray-800">Video Delivery</span>
            </Link>
          </div>

          {/* Navigation Links - Only for public pages */}
          {!isAdmin && (
            <div className="hidden md:flex items-center space-x-1">
              <Link
                to="/"
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  location.pathname === '/'
                    ? 'bg-blue-100 text-blue-800'
                    : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                Home
              </Link>
            </div>
          )}

          {/* Right Side Actions */}
          <div className="flex items-center space-x-4">
            {isAdmin ? (
              <button
                onClick={() => logout()}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-700 rounded-md transition-colors"
              >
                Logout
              </button>
            ) : (
              <Link
                to="/admin/login"
                className="px-4 py-2 bg-blue-200 text-blue-800 rounded-md text-sm font-medium hover:bg-blue-300 transition-colors"
              >
                Admin Login
              </Link>
            )}

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2 rounded-md text-gray-700 hover:bg-blue-50 hover:text-blue-700"
              onClick={() => {
                const menu = document.getElementById('mobile-menu');
                menu?.classList.toggle('hidden');
              }}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu - Only for public pages */}
      {!isAdmin && (
        <div id="mobile-menu" className="hidden md:hidden border-t border-blue-200">
          <div className="px-2 pt-2 pb-3 space-y-1">
            <Link
              to="/"
              className={`block px-3 py-2 rounded-md text-base font-medium ${
                location.pathname === '/'
                  ? 'bg-blue-100 text-blue-800'
                  : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
              }`}
            >
              Home
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

export default Navbar;

