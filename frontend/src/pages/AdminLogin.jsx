import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Logo from '../components/ui/Logo';
import api from '../services/api';
import { verifySession } from '../utils/auth';

/**
 * Admin Login Page
 * 
 * Features:
 * - Split screen design (branding left, form right)
 * - Modern floating label inputs
 * - Loading and success states
 * - Responsive design
 */
function AdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect to dashboard if an httpOnly session cookie is still valid
  useEffect(() => {
    verifySession()
      .then((isValid) => {
        if (isValid) {
          const from = location.state?.from?.pathname || '/admin';
          navigate(from, { replace: true });
        }
      })
      .catch(() => {
        // No valid session
      });
  }, [navigate, location]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setSuccess(false);

    // Trim whitespace from inputs
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    // Strict validation - require both fields and minimum lengths
    if (!trimmedUsername || !trimmedPassword) {
      setError("Please fill in all fields.");
      setLoading(false);
      return;
    }

    // Additional validation - ensure fields are not just whitespace
    if (trimmedUsername.length < 1 || trimmedPassword.length < 1) {
      setError("Username and password cannot be empty.");
      setLoading(false);
      return;
    }

    // Minimum password length check
    if (trimmedPassword.length < 3) {
      setError("Password must be at least 3 characters long.");
      setLoading(false);
      return;
    }

    try {
      // Make API call with trimmed credentials
      const response = await api.post('/auth/login', {
        username: trimmedUsername,
        password: trimmedPassword,
        rememberMe
      });

      if (!response.data?.user) {
        throw new Error('Invalid response from server');
      }

      setSuccess(true);
      
      // Navigate to intended page or default to admin dashboard
      const from = location.state?.from?.pathname || '/admin';
      setTimeout(() => {
        navigate(from, { replace: true });
      }, 800);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
      setLoading(false);
      setSuccess(false);
    }
  };

  return (
    <div className="h-screen w-full flex bg-white overflow-hidden antialiased text-slate-900">
      
      {/* Left Panel - Branding & Visuals (Hidden on mobile) */}
      <div className="hidden lg:flex w-[55%] h-full relative flex-col p-12 bg-slate-900 overflow-hidden">
        {/* Background Image with Overlay */}
        <div className="absolute inset-0 z-0">
          <img 
            src="https://images.unsplash.com/photo-1533750516457-a7f992034fec?q=80&w=2301&auto=format&fit=crop" 
            alt="Video streaming background" 
            className="w-full h-full object-cover opacity-40 mix-blend-overlay"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-brand-900/90 to-slate-900/90" />
        </div>

        {/* Logo at top left */}
        <div className="relative z-10">
          <Logo variant="light" />
        </div>

        {/* Brand Content - Centered */}
        <div className="relative z-10 max-w-xl mt-auto mb-auto">
           <h1 className="text-5xl font-bold text-white mb-6 leading-tight">
             Stream your content with <span className="text-brand-400">confidence</span>.
           </h1>
           <p className="text-xl text-slate-300 mb-12 font-light">
             Join thousands of educators and organizations using Video Delivery to manage and distribute their video content efficiently.
           </p>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="w-full lg:w-[45%] h-full flex items-center justify-center p-6 sm:p-12 lg:p-24 bg-white relative overflow-y-auto">
        <div className="w-full max-w-md space-y-8 animate-fade-in">
          
          {/* Mobile Logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <Logo />
          </div>

          <div className="text-center lg:text-left">
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Welcome back</h2>
            <p className="mt-2 text-slate-600">Please enter your credentials to access the admin panel.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 mt-8">
            <div className="space-y-4">
              <Input
                label="Username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                error={error && !username ? 'Username is required' : undefined}
                autoComplete="username"
                required
              />
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={error && !password ? 'Password is required' : undefined}
                autoComplete="current-password"
                required
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Keep me signed in on this device
            </label>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-100 text-red-600 text-sm">
                {error}
              </div>
            )}

            <Button 
              type="submit" 
              fullWidth 
              isLoading={loading}
              disabled={loading || success || !username.trim() || !password.trim()}
              className={success ? "!bg-green-600 !hover:bg-green-700 !text-white" : "!bg-blue-600 !hover:bg-blue-700 !text-white !shadow-md"}
            >
              {success ? (
                <span className="flex items-center gap-2">
                  <CheckCircle2 size={18} /> Signed in successfully
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Sign in to Admin Panel <ArrowRight size={18} />
                </span>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AdminLogin;
