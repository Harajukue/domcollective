// ====================================
// CONFIGURATION
// ====================================
const SUPABASE_URL = 'https://lnoixeskupzydjjpbvyu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxub2l4ZXNrdXB6eWRqanBidnl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwMTI3MDksImV4cCI6MjA3NzU4ODcwOX0.a4yw5e_ojAmcdpWWlc8zXXehnjATOfRnVxC22f8tang';
const GOOGLE_CALENDAR_ID = 'd392dc35dbd1a2f8807f396fcc095f16fe662aaabce1ac6df94e2100aae3378c@group.calendar.google.com';
const GOOGLE_CALENDAR_API_KEY = 'AIzaSyCU8sdOOUT5LP145Doy7R7MGlJmgtOs3Ls';
const STRIPE_PUBLISHABLE_KEY = 'pk_live_51SpimJFIZo8yBe9o6xXz3YSVMRYjtAiJq3qEZqn9ytOZcnU7ElBElTkZDIfvYxT7dW2Cj4WuBZAUtX6hHecpcGS100qEwPfjZm';

// Clean up stale PKCE verifier BEFORE creating client
// A leftover verifier with no matching code causes getSession() to hang
try {
    const _authData = localStorage.getItem('dom-collective-auth');
    const _hasSession = _authData && _authData.includes('"access_token"');
    const _urlHasCode = new URLSearchParams(window.location.search).has('code');
    if (!_hasSession && !_urlHasCode) {
        const _vk = 'dom-collective-auth-code-verifier';
        if (localStorage.getItem(_vk)) {
            console.warn('Clearing stale PKCE verifier');
            localStorage.removeItem(_vk);
        }
    }
} catch (e) {}

// Initialize Supabase client (using IIFE to avoid redeclaration)
var supabase = (function() {
    if (!window.supabase) {
        console.error('Supabase library not loaded!');
        return null;
    }
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            storageKey: 'dom-collective-auth',
            storage: window.localStorage,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: 'pkce'
        }
    });
})();

// Initialize Stripe
var stripe = (function() {
    if (!window.Stripe) {
        console.error('Stripe library not loaded!');
        return null;
    }
    return window.Stripe(STRIPE_PUBLISHABLE_KEY);
})();
// ====================================
// MAIN APPLICATION CLASS
// ====================================
class CreativeCollective {
    constructor() {
        this.currentUser = null;
        this.members = [];
        this.needs = [];
        this.events = [];
        this.messages = [];
        this.paintings = [];
        this.isLoginMode = true;
        this.onboardingStep = 1;
        this.contactRecipient = null;
        this._isSubmittingNeed = false;
        this._lastSubmitTime = 0;
        this.currentGallery = [];
        this.currentGalleryIndex = 0;
        this.checkInStatuses = [];
        this.currentCheckInFilter = 'all';
        this._authProcessing = false;
        this.subscriptionTiers = [];
        this.userSubscription = null;

        // Display name mapping: internal DB values → user-facing labels
        this.tierDisplayNames = {
            'visitor': 'Creator',
            'member': 'Contributor',
            'contributor': 'Catalist',
            'admin': 'Catalist'
        };

        console.log('CreativeCollective constructor completed');
    }

    getTierDisplayName(internalTier) {
        return this.tierDisplayNames[internalTier] || internalTier.charAt(0).toUpperCase() + internalTier.slice(1);
    }

    // ====================================
    // INITIALIZATION
    // ====================================
 async init() {
    console.log('Initializing DÅM Collective...');
    
    try {
        console.log('Binding events...');
        this.bindEvents();
        console.log('✓ Events bound');
        
        // Show loading immediately
        this.showLoadingStats();
        
        // Check for Stripe success/cancel in URL
        const urlParams = new URLSearchParams(window.location.search);
        const stripeSuccess = urlParams.get('success');
        const stripeTier = urlParams.get('tier');
        const stripeCanceled = urlParams.get('canceled');
        const gallerySuccess = urlParams.get('gallery_success');
        const paintingId = urlParams.get('painting_id');
        const galleryCanceled = urlParams.get('gallery_canceled');

        console.log('Checking for existing session...');
        await this.checkSession();
        console.log('✓ Session checked');

            // Load data is now handled in checkSession
            // Don't duplicate loading here

            // Handle Stripe redirect
            if (stripeSuccess === 'true' && stripeTier) {
                await this.handlePaymentSuccess(stripeTier);
                window.history.replaceState({}, document.title, window.location.pathname);
            } else if (stripeCanceled === 'true') {
                this.showAlert('Payment canceled', 'info');
                window.history.replaceState({}, document.title, window.location.pathname);
            } else if (gallerySuccess === 'true' && paintingId) {
                await this.handlePaintingPurchaseSuccess(paintingId);
                window.history.replaceState({}, document.title, window.location.pathname);
            } else if (galleryCanceled === 'true') {
                this.showAlert('Purchase canceled', 'info');
                window.history.replaceState({}, document.title, window.location.pathname);
            }

            console.log('✓ Data loading initiated');
            
            console.log('=== App initialized successfully ===');
        } catch (error) {
            console.error('=== INITIALIZATION FAILED ===');
            console.error('Error:', error);
            console.error('Stack:', error.stack);
            this.showAlert('Failed to initialize app. Please refresh the page.', 'error');
        }
    }

    // ====================================
    // AUTHENTICATION
    // ====================================
async checkSession() {
    console.log('🔄 Getting session from Supabase...');

    // Debug: Check URL for OAuth callback params
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');
    const hasError = urlParams.has('error');
    console.log('🔍 URL params - code:', !!authCode, 'error:', hasError);

    // Debug: Check localStorage
    try {
        const storedAuth = localStorage.getItem('dom-collective-auth');
        console.log('💾 LocalStorage auth:', storedAuth ? 'EXISTS (length: ' + storedAuth.length + ')' : 'EMPTY');
    } catch (e) {
        console.error('❌ Cannot access localStorage:', e.message);
    }

    try {
        // If there's an OAuth code in the URL, exchange it for a session
        // But ONLY if we don't already have a valid session in localStorage
        if (authCode) {
            const storedAuth = localStorage.getItem('dom-collective-auth');
            const hasStoredSession = storedAuth && storedAuth.includes('"access_token"');

            console.log('🔑 Auth code in URL - checking if exchange needed...');
            console.log('📦 Has stored session:', hasStoredSession);

            // Only exchange if we don't have a valid session already
            if (!hasStoredSession) {
                console.log('🔄 No stored session - exchanging code...');
                try {
                    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode);

                    if (exchangeError) {
                        console.error('❌ Code exchange failed:', exchangeError.message);
                    } else {
                        console.log('✅ Code exchanged! Session:', data.session?.user?.email);
                    }
                } catch (exchangeErr) {
                    console.error('❌ Exchange error:', exchangeErr.message || exchangeErr);
                }
            } else {
                console.log('✅ Already have session - skipping exchange');
            }

            // Always clean up URL after attempting exchange
            console.log('🧹 Cleaning up URL...');
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        // Timeout guard: if getSession hangs, fall through to public data
        console.log('📡 Calling getSession...');
        let session = null;
        let error = null;
        try {
            const result = await Promise.race([
                supabase.auth.getSession(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('getSession timeout')), 5000))
            ]);
            session = result.data?.session || null;
            error = result.error || null;
        } catch (timeoutErr) {
            console.error('❌ getSession timed out or failed:', timeoutErr.message);
            // Clear any stuck auth state
            try { localStorage.removeItem('dom-collective-auth'); } catch (e) {}
            try { localStorage.removeItem('dom-collective-auth-code-verifier'); } catch (e) {}
        }

            console.log('📊 Session result:', session ? '✅ Has session: ' + session.user.email : '❌ No session', error ? '⚠️ Error: ' + error.message : 'No error');

            if (error) {
                console.error('❌ Session error:', error);
                this.updateAuthButton();
                await this.loadDataWithoutAuth();
                return;
            }

            if (session && session.user) {
                console.log('✅ Session exists, calling handleAuthSuccess...');
                await this.handleAuthSuccess(session);
                console.log('✅ handleAuthSuccess completed');
            } else {
                console.log('ℹ️ No active session, loading public data');
                this.updateAuthButton();
                await this.loadDataWithoutAuth();
            }
        } catch (err) {
            console.error('❌ Session check failed:', err);
            console.error('❌ Error stack:', err.stack);
            this.updateAuthButton();
            await this.loadDataWithoutAuth();
        }

        // Listen for auth state changes
        console.log('👂 Setting up auth state change listener...');
        supabase.auth.onAuthStateChange(async (event, session) => {
            console.log('🔔 Auth state changed:', event, session?.user?.email || 'No user');

            if (this._authProcessing) {
                console.log('⏭️ Already processing auth, skipping...');
                return;
            }

            if (event === 'SIGNED_IN' && session) {
                console.log('✅ User signed in via state change');
                this._authProcessing = true;
                await this.handleAuthSuccess(session);
                this._authProcessing = false;
            } else if (event === 'SIGNED_OUT') {
                console.log('👋 User signed out');
                this.handleSignOut();
            } else if (event === 'TOKEN_REFRESHED') {
                console.log('🔄 Token refreshed successfully');
            }
        });
    }

    async loadDataWithoutAuth() {
        const safeLoad = async (name, fn) => {
            try { await fn(); }
            catch (e) { console.warn(`⚠️ ${name} failed:`, e.message); }
        };

        await safeLoad('loadMembers', () => this.loadMembers());
        await safeLoad('loadMissions', () => this.loadMissions());
        await safeLoad('loadEvents', () => this.loadEvents());
        await safeLoad('loadPaintings', () => this.loadPaintings());
        await safeLoad('loadCheckInStatuses', () => this.loadCheckInStatuses());
        await safeLoad('loadSubscriptionTiers', () => this.loadSubscriptionTiers());
        await safeLoad('updateStats', () => this.updateStats());
        this.renderFeaturedMembers();
        this.renderLatestNeeds();
        await safeLoad('renderUpcomingEventsHome', () => this.renderUpcomingEventsHome());
    }

    async handleAuthSuccess(session) {
        console.log('🔐 handleAuthSuccess called with session:', session.user.email);
        console.log('📧 User ID:', session.user.id);

        try {
            // Close auth modal if it's open (important for OAuth redirects)
            console.log('🔍 Checking for auth modal...');
            const authModal = document.getElementById('authModal');
            console.log('📱 Auth modal found:', !!authModal);
            console.log('📱 Auth modal active:', authModal?.classList.contains('active'));

            if (authModal && authModal.classList.contains('active')) {
                this.closeModal(authModal);
                console.log('✅ Auth modal closed successfully');
            } else {
                console.log('ℹ️ Auth modal was not active or not found');
            }

            // Check if profile exists
            console.log('🔍 Querying profile from database...');
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .maybeSingle();

            console.log('📊 Profile query result:', { hasProfile: !!profile, error: profileError });

            if (!profile) {
                // Profile doesn't exist, create it
                console.log('No profile found, creating new one...');
                await this.createNewProfile(session.user);
            } else if (profileError) {
                // Some other error
                console.error('Profile query error:', profileError);
                throw profileError;
            } else {
                console.log('Profile found, loading...');

                // CRITICAL: Set currentUser immediately with the profile data
                this.currentUser = {
                    id: profile.id,
                    name: profile.name,
                    email: profile.email,
                    bio: profile.bio || '',
                    skills: profile.skills || [],
                    website: profile.website || '',
                    portfolio: profile.portfolio || '',
                    social: profile.social || '',
                    contact: profile.contact || profile.email,
                    avatar: profile.avatar || '',
                    user_status: profile.user_status || 'unverified',
                    projects: profile.projects || [],
                    profile_gallery: profile.profile_gallery || [],
                    subscription_tier: profile.subscription_tier || 'visitor',
                    phone: profile.phone || '',
                    instagram_url: profile.instagram_url || '',
                    linkedin_url: profile.linkedin_url || ''
                };

                console.log('✓ currentUser set:', this.currentUser.name, 'Status:', this.currentUser.user_status);

                // Load all necessary data
                await this.loadMembers();
                await this.loadUserSubscription();
                await this.loadMissions();
                await this.loadEvents();
                await this.loadPaintings();
                await this.loadCheckInStatuses();
                await this.loadSubscriptionTiers();
                await this.updateStats();

                // Render homepage sections
                this.renderFeaturedMembers();
                this.renderLatestNeeds();
                await this.renderUpcomingEventsHome();

                // FORCE UI UPDATE with null checks for mobile
                setTimeout(() => {
                    this.updateAuthButton();
                    const profileBtn = document.getElementById('profileNavBtn');
                    if (profileBtn) {
                        profileBtn.style.display = 'block';
                        console.log('✓ Profile nav button displayed');
                    }
                    const checkInBtn = document.getElementById('checkInNavBtn');
                    if (checkInBtn && this.currentUser) {
                        checkInBtn.style.display = 'block';
                        console.log('✓ Check-in nav button displayed');
                    }
                }, 100);

                // Only show onboarding for truly empty profiles (no name set beyond email default)
                const hasName = profile.name && profile.name !== profile.email?.split('@')[0];
                const hasBio = profile.bio && profile.bio.trim().length > 0;
                const hasSkills = profile.skills && profile.skills.length > 0;
                if (!hasName && !hasBio && !hasSkills) {
                    this.showSection('profile');
                    this.showAlert('Please complete your profile!', 'success');
                    setTimeout(() => this.showOnboarding(), 500);
                } else {
                    this.showSection('home');
                    this.showAlert(`Welcome back, ${profile.name}!`, 'success');
                }
            }
        } catch (error) {
            console.error('Auth success handler error:', error);
            this.showAlert('Error loading profile: ' + error.message, 'error');
        }
    }

    async createNewProfile(user) {
        console.log('Creating new profile for:', user.email);
        
        const userName = user.user_metadata.full_name || 
                        user.user_metadata.name || 
                        user.email.split('@')[0];
        
        console.log('Profile name will be:', userName);
        
        try {
            const { data, error } = await supabase.from('profiles').insert([{
                id: user.id,
                email: user.email,
                name: userName,
                user_status: 'unverified',
                bio: '',
                skills: [],
                created_at: new Date().toISOString()
            }]).select();

            if (error) {
                console.error('Profile creation error:', error);
                throw error;
            }

            console.log('Profile created successfully:', data);

            await this.loadUserProfile(user.id);
            await this.loadMembers();
            this.updateAuthButton();
            document.getElementById('profileNavBtn').style.display = 'block';
            const checkInBtn = document.getElementById('checkInNavBtn');
            if (checkInBtn) {
                checkInBtn.style.display = 'block';
            }

            this.showSection('profile');
            this.showAlert('Welcome! Please complete your profile.', 'success');
            setTimeout(() => this.showOnboarding(), 500);
        } catch (error) {
            console.error('Create profile failed:', error);
            throw error;
        }
    }

    handleSignOut() {
        this.currentUser = null;
        this.updateAuthButton();
        document.getElementById('profileNavBtn').style.display = 'none';
            document.getElementById('checkInNavBtn').style.display = 'none';
        
        if (document.getElementById('profile')?.classList.contains('active')) {
            this.showSection('home');
        }
        
        this.showAlert('Logged out successfully', 'success');
    }

    async signInWithGoogle() {
        try {
            console.log('🔐 Initiating Google sign-in...');
            console.log('📱 Current URL:', window.location.href);
            console.log('🔙 Redirect URL will be:', `${window.location.origin}${window.location.pathname}`);

            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: `${window.location.origin}${window.location.pathname}`,
                    skipBrowserRedirect: false,
                    queryParams: {
                        access_type: 'offline',
                        prompt: 'consent'
                    }
                }
            });

            if (error) {
                console.error('❌ Google OAuth error:', error);
                throw error;
            }

            console.log('✅ Google OAuth response:', data);
            console.log('✓ Google OAuth initiated, redirecting to:', data?.url || 'unknown');
            // The page will redirect to Google, no need to do anything else here
        } catch (error) {
            console.error('❌ Google sign-in failed:', error);
            this.showAlert('Failed to sign in with Google: ' + error.message, 'error');
        }
    }

    async handleAuth(e) {
        e.preventDefault();
        
        const email = document.getElementById('authEmail').value;
        const password = document.getElementById('authPassword').value;
        const name = document.getElementById('authName').value;

        if (this.isLoginMode) {
            await this.login(email, password);
        } else {
            await this.signup(email, password, name);
        }
    }

    async login(email, password) {
        console.log('🔐 Login attempt for:', email);

        if (!email || !password) {
            this.showAlert('Please enter both email and password', 'error');
            return;
        }

        try {
            console.log('Calling Supabase signInWithPassword...');
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password: password
            });

            if (error) {
                console.error('Login error:', error);
                throw error;
            }

            console.log('✓ Auth successful, user ID:', data.user.id);

            // Load the profile which sets currentUser
            console.log('Loading user profile...');
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', data.user.id)
                .single();

            if (profileError) {
                console.error('Profile load error:', profileError);
                throw profileError;
            }

            if (profile) {
                this.currentUser = {
                    id: profile.id,
                    name: profile.name,
                    email: profile.email,
                    bio: profile.bio || '',
                    skills: profile.skills || [],
                    website: profile.website || '',
                    portfolio: profile.portfolio || '',
                    social: profile.social || '',
                    contact: profile.contact || profile.email,
                    avatar: profile.avatar || '',
                    user_status: profile.user_status || 'unverified',
                    projects: profile.projects || [],
                    profile_gallery: profile.profile_gallery || [],
                    phone: profile.phone || '',
                    instagram_url: profile.instagram_url || '',
                    linkedin_url: profile.linkedin_url || ''
                };

                console.log('✓ Login successful, currentUser set:', this.currentUser.name);
            } else {
                console.error('No profile found for user');
                throw new Error('Profile not found. Please contact support.');
            }

            this.closeModal(document.getElementById('authModal'));
            this.updateAuthButton();

            const profileNavBtn = document.getElementById('profileNavBtn');
            if (profileNavBtn) profileNavBtn.style.display = 'block';

            const checkInBtn = document.getElementById('checkInNavBtn');
            if (checkInBtn) {
                checkInBtn.style.display = 'block';
            }

            // Reload data with user context
            await this.loadMembers();
            await this.loadMissions();
            await this.loadEvents();

            this.showAlert(`Welcome back, ${this.currentUser.name}!`, 'success');
        } catch (error) {
            console.error('Login failed:', error);
            let errorMessage = 'Login failed: ';
            if (error.message.includes('Invalid login credentials')) {
                errorMessage = 'Invalid email or password';
            } else if (error.message.includes('Email not confirmed')) {
                errorMessage = 'Please verify your email address';
            } else {
                errorMessage = error.message;
            }
            this.showAlert(errorMessage, 'error');
        }
    }

    async signup(email, password, name) {
        console.log('📝 Signup attempt for:', email);

        if (!name || !email || !password) {
            this.showAlert('Please fill in all fields', 'error');
            return;
        }

        if (password.length < 6) {
            this.showAlert('Password must be at least 6 characters', 'error');
            return;
        }

        try {
            console.log('Creating auth account...');
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email: email.trim(),
                password: password,
                options: {
                    data: {
                        full_name: name
                    }
                }
            });

            if (authError) {
                console.error('Signup auth error:', authError);
                throw authError;
            }

            if (!authData.user) {
                throw new Error('Failed to create account');
            }

            console.log('✓ Auth account created, user ID:', authData.user.id);
            console.log('Creating profile...');

            const { error: profileError } = await supabase
                .from('profiles')
                .insert([{
                    id: authData.user.id,
                    email: email.trim(),
                    name: name,
                    user_status: 'unverified',
                    bio: '',
                    skills: [],
                    created_at: new Date().toISOString()
                }]);

            if (profileError) {
                console.error('Profile creation error:', profileError);
                throw profileError;
            }

            console.log('✓ Profile created successfully');

            await this.loadUserProfile(authData.user.id);

            this.closeModal(document.getElementById('authModal'));
            this.updateAuthButton();

            const profileNavBtn = document.getElementById('profileNavBtn');
            if (profileNavBtn) profileNavBtn.style.display = 'block';

            const checkInBtn = document.getElementById('checkInNavBtn');
            if (checkInBtn && this.currentUser) {
                checkInBtn.style.display = 'block';
            }

            this.showAlert('Account created! Please complete your profile.', 'success');
            this.showOnboarding();
        } catch (error) {
            console.error('Signup failed:', error);
            let errorMessage = 'Signup failed: ';
            if (error.message.includes('already registered')) {
                errorMessage = 'This email is already registered';
            } else if (error.message.includes('invalid email')) {
                errorMessage = 'Please enter a valid email address';
            } else {
                errorMessage = error.message;
            }
            this.showAlert(errorMessage, 'error');
        }
    }

    async logout() {
        try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;

            this.handleSignOut();
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    toggleAuthMode() {
        this.isLoginMode = !this.isLoginMode;
        
        const title = document.getElementById('authModalTitle');
        const submitBtn = document.getElementById('authSubmit');
        const nameGroup = document.getElementById('authNameGroup');
        const toggleText = document.getElementById('authToggleText');
        const toggleLink = document.getElementById('authToggleLink');

        if (this.isLoginMode) {
            title.textContent = 'Login';
            submitBtn.textContent = 'Login';
            nameGroup.style.display = 'none';
            toggleText.textContent = "Don't have an account?";
            toggleLink.textContent = 'Sign up';
        } else {
            title.textContent = 'Sign Up';
            submitBtn.textContent = 'Sign Up';
            nameGroup.style.display = 'block';
            toggleText.textContent = 'Already have an account?';
            toggleLink.textContent = 'Login';
        }
    }

    updateAuthButton() {
        const authBtn = document.getElementById('authBtn');
        const profileNavBtn = document.getElementById('profileNavBtn');
        const createEventBtn = document.getElementById('createEventBtn');

        // Desktop dropdown buttons (V5.2)
        const authDropdownBtn = document.getElementById('authDropdownBtn');
        const profileDropdownBtn = document.getElementById('profileDropdownBtn');
        const checkInDropdownBtn = document.getElementById('checkInDropdownBtn');

        if (this.currentUser) {
            document.body.classList.add('user-logged-in');
            authBtn.textContent = 'Logout';
            profileNavBtn.style.display = 'block';

            // Update dropdown buttons (V5.2)
            if (authDropdownBtn) authDropdownBtn.textContent = 'Logout';
            if (profileDropdownBtn) profileDropdownBtn.style.display = 'block';
            if (checkInDropdownBtn) {
                checkInDropdownBtn.style.display = 'block';
            }

            // Show create event button only for admins
            if (createEventBtn && this.currentUser.user_status === 'admin') {
                createEventBtn.style.display = 'block';
            } else if (createEventBtn) {
                createEventBtn.style.display = 'none';
            }

            // Update home check-in widget
            this.updateHomeCheckInStatus();
        } else {
            document.body.classList.remove('user-logged-in');
            authBtn.textContent = 'Login';
            profileNavBtn.style.display = 'none';

            // Update dropdown buttons (V5.2)
            if (authDropdownBtn) authDropdownBtn.textContent = 'Login';
            if (profileDropdownBtn) profileDropdownBtn.style.display = 'none';
            if (checkInDropdownBtn) checkInDropdownBtn.style.display = 'none';

            if (createEventBtn) {
                createEventBtn.style.display = 'none';
            }
        }
    }

    // ====================================
    // USER PROFILE MANAGEMENT
    // ====================================
    async loadUserProfile(userId) {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (error) throw error;

            this.currentUser = {
                id: data.id,
                name: data.name,
                email: data.email,
                bio: data.bio || '',
                skills: data.skills || [],
                website: data.website || '',
                portfolio: data.portfolio || '',
                social: data.social || '',
                contact: data.contact || data.email,
                avatar: data.avatar || '',
                user_status: data.user_status || 'unverified',
                projects: data.projects || [],
                profile_gallery: data.profile_gallery || [],
                phone: data.phone || '',
                instagram_url: data.instagram_url || '',
                linkedin_url: data.linkedin_url || ''
            };

            console.log('User profile loaded:', this.currentUser.name);
        } catch (error) {
            console.error('Load profile error:', error);
        }
    }

    async saveProfile(e) {
        if (e) e.preventDefault();
        if (!this.currentUser) return;

        const profileData = {
            name: document.getElementById('profileName').value,
            bio: document.getElementById('profileBio').value,
            skills: document.getElementById('profileSkills').value
                .split(',')
                .map(s => s.trim())
                .filter(s => s),
            website: document.getElementById('profileWebsite').value,
            portfolio: document.getElementById('profilePortfolio').value,
            social: document.getElementById('profileSocial').value,
            contact: document.getElementById('profileContact').value,
            avatar: document.getElementById('profileAvatar').value,
            projects: this.currentUser.projects || [],
            phone: document.getElementById('profilePhone').value,
            instagram_url: document.getElementById('profileInstagram').value,
            linkedin_url: document.getElementById('profileLinkedin').value
        };

        try {
            const { error } = await supabase
                .from('profiles')
                .update(profileData)
                .eq('id', this.currentUser.id);

            if (error) throw error;

            Object.assign(this.currentUser, profileData);

            // Exit edit mode
            this.setProfileEditMode(false);

            this.showAlert('Profile saved successfully!', 'success');

            // Refresh data
            await this.loadMembers();
            this.updateStats();
            this.populateSkillFilters();
            this.renderFeaturedMembers();

            if (document.getElementById('directory').classList.contains('active')) {
                this.renderMembers();
            }
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    setProfileEditMode(editing) {
        this._profileEditing = editing;
        const container = document.querySelector('.profile-container');
        const fields = document.querySelectorAll('#profileForm input:not([type="hidden"]):not([type="file"]), #profileForm textarea');
        const fileInput = document.getElementById('profilePhotosInput');
        const addProjectBtn = document.getElementById('addProjectBtn');
        const editBtn = document.getElementById('profileEditBtn');
        const skillsSuggestions = document.querySelector('.skills-suggestions');

        fields.forEach(field => {
            if (field.id === 'profileEmail') return;
            field.disabled = !editing;
        });

        if (fileInput) fileInput.disabled = !editing;
        // Add Project button stays enabled for logged-in users
        if (addProjectBtn) addProjectBtn.disabled = false;

        // Always keep button as type="button" to prevent accidental form submission
        editBtn.type = 'button';

        if (editing) {
            if (container) container.classList.add('editing');
            editBtn.textContent = 'Save Profile';
            if (skillsSuggestions) skillsSuggestions.style.display = 'flex';
            document.querySelectorAll('.profile-project-card .project-actions, .profile-photo-item .photo-remove').forEach(el => {
                el.style.display = '';
            });
        } else {
            if (container) container.classList.remove('editing');
            editBtn.textContent = 'Edit Profile';
            if (skillsSuggestions) skillsSuggestions.style.display = 'none';
            document.querySelectorAll('.profile-project-card .project-actions, .profile-photo-item .photo-remove').forEach(el => {
                el.style.display = 'none';
            });
        }
    }

    toggleProfileEditMode() {
        // Use button text as source of truth to prevent state desync
        const editBtn = document.getElementById('profileEditBtn');
        const isCurrentlyEditing = editBtn && editBtn.textContent.trim() === 'Save Profile';

        if (isCurrentlyEditing) {
            this.saveProfile(null);
        } else {
            this.setProfileEditMode(true);
        }
    }

    loadUserProfileForm() {
        if (!this.currentUser) {
            this.showAlert('Please login to view your profile', 'error');
            this.showAuthModal();
            return;
        }

        console.log('Loading profile form for user:', this.currentUser.name);

        // Update status banner
        const statusBanner = document.getElementById('userStatusBanner');
        const statusText = document.getElementById('statusText');

        if (statusBanner && statusText) {
            const statusConfig = {
                'unverified': { text: 'Unverified Account - Limited Access', bg: '#fff', color: '#000' },
                'verified': { text: 'Verified', bg: '#000', color: '#fff' },
                'admin': { text: 'Catalist', bg: '#000', color: '#fff' }
            };

            const config = statusConfig[this.currentUser.user_status] || statusConfig['unverified'];
            statusText.textContent = config.text;
            statusBanner.style.background = config.bg;
            statusBanner.style.color = config.color;
        }

        // Load form data
        document.getElementById('profileName').value = this.currentUser.name || '';
        document.getElementById('profileEmail').value = this.currentUser.email || '';
        document.getElementById('profilePhone').value = this.currentUser.phone || '';
        document.getElementById('profileBio').value = this.currentUser.bio || '';
        document.getElementById('profileSkills').value = this.currentUser.skills?.join(', ') || '';
        document.getElementById('profileWebsite').value = this.currentUser.website || '';
        document.getElementById('profilePortfolio').value = this.currentUser.portfolio || '';
        document.getElementById('profileSocial').value = this.currentUser.social || '';
        document.getElementById('profileContact').value = this.currentUser.contact || '';
        document.getElementById('profileAvatar').value = this.currentUser.avatar || '';
        document.getElementById('profileInstagram').value = this.currentUser.instagram_url || '';
        document.getElementById('profileLinkedin').value = this.currentUser.linkedin_url || '';

        // Update avatar display
        this.updateAvatarDisplay();

        this.renderUserProjects();
        this.renderProfilePhotos();

        // Preserve edit mode if already editing, otherwise start in view mode
        if (!this._profileEditing) {
            this.setProfileEditMode(false);
        }
    }

    updateAvatarDisplay() {
        const avatarUrl = document.getElementById('profileAvatar').value;
        const display = document.getElementById('profileAvatarDisplay');

        if (display) {
            if (avatarUrl) {
                display.innerHTML = `<img src="${avatarUrl}" alt="Profile photo">`;
            } else {
                display.innerHTML = '<div class="avatar-placeholder">Photo</div>';
            }
        }
    }

    addSkillToInput(skill) {
        const input = document.getElementById('profileSkills');
        const currentSkills = input.value ? input.value.split(',').map(s => s.trim()) : [];
        
        if (!currentSkills.includes(skill)) {
            currentSkills.push(skill);
            input.value = currentSkills.join(', ');
            // profile updated
        }
    }

    // ====================================
    // ONBOARDING
    // ====================================
    showOnboarding() {
        if (this.currentUser) {
            if (this.currentUser.name) document.getElementById('onboardName').value = this.currentUser.name;
            if (this.currentUser.bio) document.getElementById('onboardBio').value = this.currentUser.bio;
            if (this.currentUser.portfolio) document.getElementById('onboardPortfolio').value = this.currentUser.portfolio;
            if (this.currentUser.website) document.getElementById('onboardWebsite').value = this.currentUser.website;
            if (this.currentUser.social) document.getElementById('onboardSocial').value = this.currentUser.social;

            // Pre-check existing skills
            if (this.currentUser.skills && this.currentUser.skills.length > 0) {
                const knownSkills = new Set(this.currentUser.skills);
                document.querySelectorAll('.skill-checkbox input').forEach(cb => {
                    if (knownSkills.has(cb.value)) cb.checked = true;
                });
            }
        }

        document.getElementById('onboardingModal').classList.add('active');
        this.onboardingStep = 1;
        this.showOnboardingStep(1);
    }

    showOnboardingStep(step) {
        document.querySelectorAll('.onboarding-step').forEach(s => s.classList.remove('active'));
        document.querySelector(`[data-step="${step}"]`).classList.add('active');
        this.onboardingStep = step;
    }

    nextOnboardingStep() {
        if (this.onboardingStep === 1) {
            const name = document.getElementById('onboardName').value;
            const bio = document.getElementById('onboardBio').value;
            if (!name || !bio) {
                this.showAlert('Please fill in all required fields', 'error');
                return;
            }
        }

        if (this.onboardingStep < 3) {
            this.showOnboardingStep(this.onboardingStep + 1);
        }
    }

    prevOnboardingStep() {
        if (this.onboardingStep > 1) {
            this.showOnboardingStep(this.onboardingStep - 1);
        }
    }

    async completeOnboarding(e) {
        e.preventDefault();
        if (!this.currentUser) return;

        // Collect skills
        const selectedSkills = Array.from(document.querySelectorAll('.skill-checkbox input:checked'))
            .map(cb => cb.value);

        const otherSkills = document.getElementById('onboardOtherSkills').value
            .split(',')
            .map(s => s.trim())
            .filter(s => s);

        const allSkills = [...selectedSkills, ...otherSkills];

        // Only update fields that have values — don't overwrite existing data with blanks
        const profileData = {};
        const onboardName = document.getElementById('onboardName').value.trim();
        const onboardBio = document.getElementById('onboardBio').value.trim();
        const onboardPortfolio = document.getElementById('onboardPortfolio').value.trim();
        const onboardWebsite = document.getElementById('onboardWebsite').value.trim();
        const onboardSocial = document.getElementById('onboardSocial').value.trim();

        if (onboardName) profileData.name = onboardName;
        if (onboardBio) profileData.bio = onboardBio;
        if (allSkills.length > 0) profileData.skills = allSkills;
        if (onboardPortfolio) profileData.portfolio = onboardPortfolio;
        if (onboardWebsite) profileData.website = onboardWebsite;
        if (onboardSocial) profileData.social = onboardSocial;

        try {
            const { error } = await supabase
                .from('profiles')
                .update(profileData)
                .eq('id', this.currentUser.id);

            if (error) throw error;

            Object.assign(this.currentUser, profileData);
            
            this.closeModal(document.getElementById('onboardingModal'));
            this.showAlert('Profile completed! Welcome to DōM!', 'success');
            
            await this.loadMembers();
            this.renderFeaturedMembers();
            this.loadUserProfileForm();
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    // ====================================
    // DATA LOADING
    // ====================================
    async loadMembers() {
        try {
            console.log('Loading members from database...');
            
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }

            console.log('Raw data from Supabase:', data);

            this.members = data.map(m => ({
                id: m.id,
                name: m.name,
                email: m.email,
                bio: m.bio || '',
                skills: m.skills || [],
                website: m.website || '',
                portfolio: m.portfolio || '',
                social: m.social || '',
                contact: m.contact || m.email,
                avatar: m.avatar || '',
                user_status: m.user_status || 'unverified',
                projects: m.projects || [],
                joinDate: new Date(m.created_at)
            }));

            this.updateStats();
            console.log('✓ Loaded', this.members.length, 'members');
        } catch (error) {
            console.error('❌ Load members error:', error);
            console.error('Error details:', error.message, error.code, error.details);
            this.members = [];
        }
    }
    async loadMissions() {
        try {
            console.log('Loading missions from database...');
            
            const { data, error } = await supabase
                .from('missions')
                .select('*')
                .eq('status', 'open')
                .order('posted_date', { ascending: false });

            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }

            console.log('Raw missions data:', data);

            this.needs = data.map(n => ({
                id: n.id,
                title: n.title,
                description: n.description,
                skills: n.skills || [],
                budget: n.budget || 'Budget not specified',
                authorId: n.author_id,
                postedDate: new Date(n.posted_date),
                status: n.status,
                deadline: n.deadline
            }));

            this.updateStats();
            console.log('✓ Loaded', this.needs.length, 'needs');
        } catch (error) {
            console.error('❌ Load missions error:', error);
            console.error('Error details:', error.message, error.code, error.details);
            this.needs = [];
        }
    }
    async loadEvents() {
        try {
            console.log('Loading events from database...');
            
            const { data, error } = await supabase
                .from('events')
                .select('*')
                .order('date', { ascending: true });

            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }

            console.log('Raw events data:', data);

            this.events = data.map(e => ({
                id: e.id,
                title: e.title,
                description: e.description || '',
                date: new Date(e.date),
                time: e.time || '',
                location: e.location || '',
                type: e.type || 'Other',
                organizerId: e.organizer_id
            }));

            this.updateStats();
            console.log('✓ Loaded', this.events.length, 'events');
        } catch (error) {
            console.error('❌ Load events error:', error);
            console.error('Error details:', error.message, error.code, error.details);
            this.events = [];
        }
    }

    async fetchGoogleCalendarEvents() {
        console.log('Fetching Google Calendar events...');
        
        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(now.getDate() + 7);
        
        const timeMin = now.toISOString();
        const timeMax = nextWeek.toISOString();
        
        console.log('Time range:', { timeMin, timeMax });
        
        try {
            const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events?key=${GOOGLE_CALENDAR_API_KEY}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=10`;
            
            console.log('Fetching from URL (key hidden):', url.replace(GOOGLE_CALENDAR_API_KEY, 'HIDDEN'));
            
            const response = await fetch(url);
            
            console.log('Calendar API response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Calendar API error:', errorText);
                throw new Error(`Failed to fetch calendar events: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('Calendar API success - Events found:', data.items?.length || 0);
            
            if (data.items && data.items.length > 0) {
                console.log('First event:', data.items[0]);
            }
            
            return data.items || [];
        } catch (error) {
            console.error('Google Calendar API error:', error);
            return [];
        }
    }

    // ====================================
    // PROJECTS
    // ====================================
    renderUserProjects() {
        if (!this.currentUser || !this.currentUser.projects) return;

        const container = document.getElementById('portfolioProjects');

        if (this.currentUser.projects.length === 0) {
            container.innerHTML = '<p class="empty-state">Add projects to showcase your work</p>';
            return;
        }

        container.innerHTML = this.currentUser.projects.map((project, index) => `
            <div class="profile-project-card">
                ${project.image ? `<img src="${project.image}" alt="${project.title}" class="project-image">` : ''}
                <div class="project-info">
                    <h4>${project.title}</h4>
                    <p>${project.description || ''}</p>
                    ${project.tags ? `<div class="project-tags">${(Array.isArray(project.tags) ? project.tags : []).map(t => `<span class="project-tag">${t}</span>`).join('')}</div>` : ''}
                </div>
                <div class="project-actions" style="${this._profileEditing ? '' : 'display:none'}">
                    ${project.link ? `<a href="${project.link}" target="_blank" class="btn btn-outline">View</a>` : ''}
                    <button class="btn btn-outline" onclick="app.editProject(${index})">Edit</button>
                    <button class="btn btn-outline" onclick="app.deleteProject(${index})">Remove</button>
                </div>
            </div>
        `).join('');
    }

    async addProject(e) {
        e.preventDefault();
        if (!this.currentUser) return;

        const project = {
            title: document.getElementById('projectTitle').value,
            description: document.getElementById('projectDescription').value,
            image: document.getElementById('projectImage').value,
            link: document.getElementById('projectLink').value
        };

        if (!this.currentUser.projects) {
            this.currentUser.projects = [];
        }

        const isEditing = this._editingProjectIndex !== null && this._editingProjectIndex !== undefined;

        if (isEditing) {
            this.currentUser.projects[this._editingProjectIndex] = project;
        } else {
            this.currentUser.projects.push(project);
        }

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ projects: this.currentUser.projects })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            this._editingProjectIndex = null;
            this.closeModal(document.getElementById('projectModal'));
            this.renderUserProjects();
            this.showAlert(isEditing ? 'Project updated!' : 'Project added successfully!', 'success');
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    async deleteProject(index) {
        if (!this.currentUser || !this.currentUser.projects) return;
        
        this.currentUser.projects.splice(index, 1);

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ projects: this.currentUser.projects })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            this.renderUserProjects();
            // profile updated
            this.showAlert('Project removed', 'success');
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    async handleProjectImageSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            this.showAlert('Please select an image file', 'error');
            e.target.value = '';
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            this.showAlert('Image must be less than 5MB', 'error');
            e.target.value = '';
            return;
        }

        // Show preview immediately
        const reader = new FileReader();
        reader.onload = (event) => {
            const preview = document.getElementById('projectImagePreview');
            preview.innerHTML = `<img src="${event.target.result}" alt="Preview" style="max-width: 100%; border: 3px solid #000;">`;
        };
        reader.readAsDataURL(file);

        // Auto-upload to Supabase
        const statusEl = document.getElementById('projectImageUploadStatus');

        try {
            statusEl.textContent = 'Uploading image...';
            statusEl.style.color = '#000';

            const fileExt = file.name.split('.').pop();
            const fileName = `${this.currentUser.id}/project-${Date.now()}.${fileExt}`;

            const { data, error } = await supabase.storage
                .from('project-images')
                .upload(fileName, file, {
                    cacheControl: '3600',
                    upsert: true
                });

            if (error) throw error;

            const { data: { publicUrl } } = supabase.storage
                .from('project-images')
                .getPublicUrl(fileName);

            document.getElementById('projectImage').value = publicUrl;

            statusEl.textContent = 'Image uploaded successfully!';
            statusEl.style.color = '#000';

            setTimeout(() => {
                statusEl.textContent = '';
            }, 3000);
        } catch (error) {
            console.error('Upload error:', error);
            statusEl.textContent = 'Upload failed: ' + error.message;
            statusEl.style.color = '#f00';
            e.target.value = '';
            document.getElementById('projectImagePreview').innerHTML = '';
        }
    }

    showProjectModal(editIndex = null) {
        if (!this.currentUser) {
            this.showAlert('Please login to add projects', 'error');
            return;
        }
        this._editingProjectIndex = editIndex;
        document.getElementById('projectForm').reset();
        document.getElementById('projectImage').value = '';
        document.getElementById('projectImagePreview').innerHTML = '';
        document.getElementById('projectImageUploadStatus').textContent = '';

        const modalTitle = document.querySelector('#projectModal h3');
        const submitBtn = document.querySelector('#projectForm .btn-primary');

        if (editIndex !== null && this.currentUser.projects && this.currentUser.projects[editIndex]) {
            const project = this.currentUser.projects[editIndex];
            document.getElementById('projectTitle').value = project.title || '';
            document.getElementById('projectDescription').value = project.description || '';
            document.getElementById('projectImage').value = project.image || '';
            document.getElementById('projectLink').value = project.link || '';
            if (project.image) {
                document.getElementById('projectImagePreview').innerHTML = `<img src="${project.image}" style="max-width:100%;max-height:200px;border:2px solid #000;">`;
            }
            if (modalTitle) modalTitle.textContent = 'Edit Project';
            if (submitBtn) submitBtn.textContent = 'Save Changes';
        } else {
            if (modalTitle) modalTitle.textContent = 'Add Portfolio Project';
            if (submitBtn) submitBtn.textContent = 'Add Project';
        }

        document.getElementById('projectModal').classList.add('active');
    }

    editProject(index) {
        this.showProjectModal(index);
    }
    async handleProfilePhotos(e) {
        if (!this.currentUser) {
            this.showAlert('Please login first', 'error');
            return;
        }

        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const statusEl = document.getElementById('avatarUploadStatus');
        statusEl.textContent = 'Uploading...';

        const uploadedUrls = [];

        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;
            if (file.size > 5 * 1024 * 1024) {
                this.showAlert('Skipped file over 5MB: ' + file.name, 'error');
                continue;
            }

            try {
                const fileExt = file.name.split('.').pop();
                const fileName = `${this.currentUser.id}/photo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`;

                const { error } = await supabase.storage
                    .from('profile-galleries')
                    .upload(fileName, file, {
                        cacheControl: '3600',
                        upsert: false
                    });

                if (error) throw error;

                const { data: { publicUrl } } = supabase.storage
                    .from('profile-galleries')
                    .getPublicUrl(fileName);

                uploadedUrls.push(publicUrl);
            } catch (error) {
                console.error('Upload error:', error);
                statusEl.textContent = 'Error uploading: ' + error.message;
            }
        }

        if (uploadedUrls.length > 0) {
            // Add to existing gallery
            if (!this.currentUser.profile_gallery) {
                this.currentUser.profile_gallery = [];
            }
            this.currentUser.profile_gallery = [...this.currentUser.profile_gallery, ...uploadedUrls];

            // First photo is always the avatar/cover
            const coverPhoto = this.currentUser.profile_gallery[0];
            this.currentUser.avatar = coverPhoto;
            document.getElementById('profileAvatar').value = coverPhoto;

            try {
                const { error } = await supabase
                    .from('profiles')
                    .update({ 
                        profile_gallery: this.currentUser.profile_gallery,
                        avatar: coverPhoto
                    })
                    .eq('id', this.currentUser.id);

                if (error) throw error;

                statusEl.textContent = `✓ Added ${uploadedUrls.length} photo(s)`;
                setTimeout(() => { statusEl.textContent = ''; }, 3000);
                
                this.renderProfilePhotos();
                this.updateAvatarDisplay();
            } catch (error) {
                this.showAlert('Error saving photos: ' + error.message, 'error');
            }
        }

        // Clear input
        e.target.value = '';
    }

    async removeProfilePhoto(index) {
        if (!this.currentUser || !this.currentUser.profile_gallery) return;
        
        if (!confirm('Remove this photo?')) return;

        this.currentUser.profile_gallery.splice(index, 1);

        // Update avatar to first remaining photo or empty
        const newAvatar = this.currentUser.profile_gallery[0] || '';
        this.currentUser.avatar = newAvatar;
        document.getElementById('profileAvatar').value = newAvatar;

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ 
                    profile_gallery: this.currentUser.profile_gallery,
                    avatar: newAvatar
                })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            this.showAlert('Photo removed', 'success');
            this.renderProfilePhotos();
            this.updateAvatarDisplay();
        } catch (error) {
            this.showAlert('Error removing photo: ' + error.message, 'error');
        }
    }

    renderProfilePhotos() {
        const container = document.getElementById('profilePhotosGrid');
        if (!container) return;

        const photos = this.currentUser?.profile_gallery || [];

        if (photos.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = photos.map((url, index) => `
            <div class="profile-photo-item ${index === 0 ? 'cover-photo' : ''}">
                ${index === 0 ? '<span class="photo-badge">Cover</span>' : ''}
                <button class="photo-remove" onclick="app.removeProfilePhoto(${index})">×</button>
                <img src="${url}" alt="Photo ${index + 1}">
            </div>
        `).join('');
    }


    // ====================================
    // NEEDS BOARD
    // ====================================
    async postMission(e) {
        e.preventDefault();
        
        // Enhanced double submission prevention
        const now = Date.now();
        if (this._isSubmittingNeed || (now - this._lastSubmitTime < 2000)) {
            console.log('Already submitting or too soon, ignoring duplicate submission');
            return;
        }
        this._lastSubmitTime = now;
        
        if (!this.currentUser) return;

        if (this.currentUser.user_status !== 'verified' && this.currentUser.user_status !== 'admin') {
            this.showAlert('Only verified members can post missions', 'error');
            return;
        }

        // Set flag to prevent double submission
        this._isSubmittingNeed = true;
        const submitBtn = document.querySelector('#needModal button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Posting...';
        }

        const missionData = {
            title: document.getElementById('needTitle').value,
            description: document.getElementById('needDescription').value,
            skills: document.getElementById('needSkills').value
                .split(',')
                .map(s => s.trim())
                .filter(s => s),
            budget: document.getElementById('needBudget').value || 'Budget not specified',
            author_id: this.currentUser.id,
            posted_date: new Date().toISOString(),
            status: 'open',
            deadline: document.getElementById('needDeadline')?.value || null
        };

        try {
            const { error } = await supabase
                .from('missions')
                .insert([missionData]);

            if (error) throw error;

            this.closeModal(document.getElementById('needModal'));
            this.showAlert('Mission posted successfully!', 'success');
            await this.loadMissions();
            
            if (document.getElementById('needs').classList.contains('active')) {
                this.renderNeeds();
            }
        } catch (error) {
            this.showAlert(error.message, 'error');
        } finally {
            // Reset submission flag with delay
            setTimeout(() => {
                this._isSubmittingNeed = false;
            }, 1000);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Post Need';
            }
        }
    }

    async markNeedClosed(needId) {
        if (!this.currentUser) {
            this.showAlert('Please login to close needs', 'error');
            return;
        }
        
        if (!confirm('Mark this need as closed?')) {
            return;
        }
        
        try {
            const { error } = await supabase
                .from('missions')
                .update({ status: 'closed' })
                .eq('id', needId)
                .eq('author_id', this.currentUser.id);

            if (error) throw error;

            this.showAlert('Need marked as closed', 'success');
            await this.loadMissions();
            this.renderNeeds();
        } catch (error) {
            this.showAlert('Error closing need: ' + error.message, 'error');
        }
    }
    showEditNeedModal(needId) {
    if (!this.currentUser) return;
    
    const need = this.needs.find(n => n.id === needId);
    if (!need || need.authorId !== this.currentUser.id) return;
    
    // Populate form with existing data
    document.getElementById('needTitle').value = need.title;
    document.getElementById('needDescription').value = need.description;
    document.getElementById('needSkills').value = need.skills.join(', ');
    document.getElementById('needBudget').value = need.budget;
    document.getElementById('needDeadline').value = need.deadline || '';
    
    // Change form submission to update instead of create
    const form = document.getElementById('needForm');
    form.onsubmit = async (e) => {
        e.preventDefault();
        await this.updateMission(needId);
    };
    
    // Change modal title
    document.querySelector('#needModal h3').textContent = 'Edit Need';
    document.querySelector('#needModal button[type="submit"]').textContent = 'Update Need';
    
    document.getElementById('needModal').classList.add('active');
}

async updateMission(needId) {
        if (!this.currentUser) return;

        const missionData = {
            title: document.getElementById('needTitle').value,
            description: document.getElementById('needDescription').value,
            skills: document.getElementById('needSkills').value
                .split(',')
                .map(s => s.trim())
                .filter(s => s),
            budget: document.getElementById('needBudget').value || 'Budget not specified',
            deadline: document.getElementById('needDeadline')?.value || null
        };

        try {
            const { error } = await supabase
                .from('missions')
                .update(missionData)
                .eq('id', needId)
                .eq('author_id', this.currentUser.id);

            if (error) throw error;

            this.closeModal(document.getElementById('needModal'));
            this.showAlert('Need updated successfully!', 'success');
            
            // Reset form for next use
            document.getElementById('needForm').onsubmit = (e) => this.postMission(e);
            document.querySelector('#needModal h3').textContent = 'Post a Need';
            document.querySelector('#needModal button[type="submit"]').textContent = 'Post Need';
            
            await this.loadMissions();
            this.renderNeeds();
        } catch (error) {
            this.showAlert('Error updating need: ' + error.message, 'error');
        }
    }

    editNeed(needId) {
        this.showEditNeedModal(needId);
    }
    showNeedModal() {
        console.log('=== showNeedModal DEBUG ===');
        console.log('currentUser:', this.currentUser);
        console.log('currentUser exists?', !!this.currentUser);
        
        // Reset submission protection
        this._isSubmittingNeed = false;
        this._lastSubmitTime = 0;
        
        if (!this.currentUser) {
            console.log('❌ No currentUser - showing auth modal');
            this.showAlert('Please login to post a need', 'error');
            this.showAuthModal();
            return;
        }
        
        console.log('✓ User found:', this.currentUser.name);
        console.log('✓ User status:', this.currentUser.user_status);
        console.log('✓ User ID:', this.currentUser.id);
        
        if (this.currentUser.user_status !== 'verified' && this.currentUser.user_status !== 'admin') {
            console.log('❌ User not verified/admin');
            this.showAlert('Only verified members can post needs. Please contact an admin for verification.', 'error');
            return;
        }
        
        console.log('✓ All checks passed - opening modal');
        
        // Reset form for new post
        document.getElementById('needForm').reset();
        document.getElementById('needForm').onsubmit = (e) => this.postMission(e);
        document.querySelector('#needModal h3').textContent = 'Post a Need';
        document.querySelector('#needModal button[type="submit"]').textContent = 'Post Need';
        
        document.getElementById('needModal').classList.add('active');
    }

    respondToNeed(needId) {
        if (!this.currentUser) {
            this.showAlert('Please login to respond', 'error');
            this.showAuthModal();
            return;
        }

        const need = this.needs.find(n => n.id === needId);
        if (!need) {
            this.showAlert('Need not found', 'error');
            return;
        }

        const author = this.members.find(m => m.id === need.authorId);
        if (!author) {
            this.showAlert('Could not find need author', 'error');
            return;
        }

        this.contactRecipient = author;
        document.getElementById('messageSubject').value = `Re: ${need.title}`;
        document.getElementById('messageContent').value = `Hi ${author.name},\n\nI'm interested in your posting: "${need.title}"\n\nI believe my skills in ${this.currentUser.skills.join(', ')} would be a great fit for your project.\n\nBest regards,\n${this.currentUser.name}`;
        
        document.getElementById('contactModal').classList.add('active');
    }

    findMatches(need) {
        if (!need.skills || need.skills.length === 0) return [];
        
        return this.members
            .filter(member => member.id !== need.authorId)
            .map(member => {
                const matchingSkills = member.skills.filter(skill => 
                    need.skills.some(needSkill => 
                        skill.toLowerCase().includes(needSkill.toLowerCase()) || 
                        needSkill.toLowerCase().includes(skill.toLowerCase())
                    )
                );
                return { ...member, matchingSkills };
            })
            .filter(member => member.matchingSkills.length > 0)
            .sort((a, b) => b.matchingSkills.length - a.matchingSkills.length);
    }

    // ====================================
    // EVENTS
    // ====================================
    async createEvent(e) {
        e.preventDefault();
        console.log('=== CREATE EVENT DEBUG ===');
        console.log('currentUser:', this.currentUser);
        console.log('user_status:', this.currentUser?.user_status);
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating...';
        }
        console.log('Form data:', {
            title: document.getElementById('eventTitle').value,
            date: document.getElementById('eventDate').value,
            time: document.getElementById('eventTime').value
        });
        
        if (!this.currentUser) {
            this.showAlert('Please login to create events', 'error');
            return;
        }

        const eventData = {
            title: document.getElementById('eventTitle').value,
            description: document.getElementById('eventDescription').value,
            date: document.getElementById('eventDate').value,
            time: document.getElementById('eventTime').value,
            location: document.getElementById('eventLocation').value,
            type: document.getElementById('eventType').value,
            organizer_id: this.currentUser.id
        };

        try {
            // Insert into database
            const { error } = await supabase
                .from('events')
                .insert([eventData]);

            if (error) throw error;

            // Try to add to Google Calendar
            const addToCalendar = document.getElementById('addToGoogleCalendar')?.checked;
            if (addToCalendar) {
                await this.addToGoogleCalendar(eventData);
            }

            this.closeModal(document.getElementById('eventModal'));
            this.showAlert('Event created successfully!', 'success');
            await this.loadEvents();
            this.renderUpcomingWeekEvents();
        } catch (error) {
            console.error('Create event error:', error);
            this.showAlert('Error creating event: ' + error.message, 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create Event';
            }
        }
    }

    async addToGoogleCalendar(eventData) {
        // Create datetime string
        const dateTime = eventData.time 
            ? `${eventData.date}T${eventData.time}:00`
            : `${eventData.date}T12:00:00`;
        
        const startDateTime = new Date(dateTime).toISOString();
        const endDateTime = new Date(new Date(dateTime).getTime() + 2 * 60 * 60 * 1000).toISOString(); // +2 hours

        // Create Google Calendar link
        const calendarUrl = new URL('https://www.google.com/calendar/render');
        calendarUrl.searchParams.set('action', 'TEMPLATE');
        calendarUrl.searchParams.set('text', eventData.title);
        calendarUrl.searchParams.set('dates', `${startDateTime.replace(/[-:]/g, '').split('.')[0]}Z/${endDateTime.replace(/[-:]/g, '').split('.')[0]}Z`);
        calendarUrl.searchParams.set('details', eventData.description || '');
        calendarUrl.searchParams.set('location', eventData.location || '');
        calendarUrl.searchParams.set('add', GOOGLE_CALENDAR_ID);

        // Open in new window
        window.open(calendarUrl.toString(), '_blank');
        
        this.showAlert('Opening Google Calendar... Please add the event manually.', 'success');
    }

    showEventModal() {
        if (!this.currentUser) {
            this.showAlert('Please login to create events', 'error');
            this.showAuthModal();
            return;
        }
        if (this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can create events', 'error');
            return;
        }
        document.getElementById('eventModal').classList.add('active');
    }

    // ====================================
    // MESSAGING
    // ====================================
    contactMember(memberId) {
        if (!this.currentUser) {
            this.showAlert('Please login to send messages', 'error');
            this.showAuthModal();
            return;
        }

        const member = this.members.find(m => m.id === memberId);
        if (!member) return;

        this.contactRecipient = member;
        document.getElementById('messageSubject').value = `Message from ${this.currentUser.name}`;
        
        document.querySelectorAll('.modal.active').forEach(modal => modal.classList.remove('active'));
        document.getElementById('contactModal').classList.add('active');
    }

    async sendMessage(e) {
        e.preventDefault();
        if (!this.currentUser || !this.contactRecipient) return;

        const messageData = {
            from_id: this.currentUser.id,
            to_id: this.contactRecipient.id,
            subject: document.getElementById('messageSubject').value,
            content: document.getElementById('messageContent').value,
            sent_date: new Date().toISOString(),
            read: false
        };

        try {
            const { error } = await supabase
                .from('messages')
                .insert([messageData]);

            if (error) throw error;

            this.closeModal(document.getElementById('contactModal'));
            this.showAlert('Message sent successfully!', 'success');
            this.contactRecipient = null;
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    // ====================================
    // RENDERING METHODS
    // ====================================
    showSection(sectionName) {
        console.log('Showing section:', sectionName, 'User:', this.currentUser?.name || 'Not logged in');

        if (sectionName === 'profile' && !this.currentUser) {
            this.showAlert('Please login to view your profile', 'error');
            this.showAuthModal();
            return;
        }

        // Update mobile navigation
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.querySelector(`.nav-btn[data-section="${sectionName}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
            console.log('Activated mobile nav button:', sectionName);
        }

        // Update dropdown navigation (V5.2)
        document.querySelectorAll('.dropdown-nav-btn').forEach(btn => btn.classList.remove('active'));
        const activeDropdownBtn = document.querySelector(`.dropdown-nav-btn[data-section="${sectionName}"]`);
        if (activeDropdownBtn) {
            activeDropdownBtn.classList.add('active');
            console.log('Activated dropdown nav button:', sectionName);
        }

        // Show section
        document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
        const targetSection = document.getElementById(sectionName);
        if (targetSection) {
            targetSection.classList.add('active');
            console.log('Section displayed:', sectionName);
        } else {
            console.error('Section not found:', sectionName);
        }

        // Load section-specific content
        switch(sectionName) {
            case 'directory':
                this.renderMembers();
                break;
            case 'needs':
                this.renderNeeds();
                break;
            case 'gallery':
                this.renderPaintings();
                break;
            case 'profile':
                this.loadUserProfileForm();
                break;
            case 'calendar':
                // Load calendar async in background
                this.renderUpcomingWeekEvents().catch(err => {
                    console.error('Error loading calendar:', err);
                });
                break;
            case 'checkin':
                this.loadCheckInStatuses();
                this.renderCheckInSection();
                break;
            case 'about':
                this.loadAboutSection();
                break;
        }
    }

    renderMembers(filteredMembers = null) {
        const container = document.getElementById('memberGrid');
        const membersToRender = filteredMembers || this.members;

        container.innerHTML = membersToRender.map(member => {
            const tier = member.subscription_tier || 'visitor';
            const tierLabel = this.getTierDisplayName(tier);
            return `
            <div class="member-card fade-in">
                <div class="member-avatar">
                    ${member.avatar ?
                        `<img src="${member.avatar}" alt="${member.name}">` :
                        '<div class="avatar-placeholder">Photo</div>'
                    }
                    <span class="member-tier-badge tier-${tier}">${tierLabel}</span>
                </div>
                <div class="member-info">
                    <h4>${member.name}</h4>
                    ${member.user_status === 'admin' ? '<span class="status-badge">Catalist</span>' : ''}
                    ${member.user_status === 'verified' ? '<span class="status-badge" style="background: #fff; color: #000;">Verified</span>' : ''}
                    ${member.user_status === 'unverified' ? '<span class="status-badge" style="background: #666; color: #fff;">Unverified</span>' : ''}
                    <p class="member-bio">${member.bio || 'No bio yet'}</p>
                    <div class="member-skills">
                        ${member.skills.map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
                    </div>
                    ${this.currentUser?.user_status === 'admin' && this.currentUser.id !== member.id ? `
                        <div class="member-actions" style="margin-bottom: 1rem; border-top: 2px solid #000; padding-top: 1rem;">
                            <button class="btn btn-outline" onclick="event.stopPropagation(); app.toggleVerification('${member.id}', '${member.user_status}')" style="font-size: 0.7rem; padding: 0.5rem;">
                                ${member.user_status === 'verified' ? 'Unverify' : 'Verify'}
                            </button>
                            <button class="btn btn-outline" onclick="event.stopPropagation(); app.deleteMember('${member.id}')" style="font-size: 0.7rem; padding: 0.5rem; background: #000; color: #fff;">
                                Delete
                            </button>
                        </div>
                    ` : ''}
                    <div class="member-actions">
                        <button class="btn btn-outline" onclick="app.viewMemberProfile('${member.id}')">View Profile</button>
                        ${this.currentUser && this.currentUser.id !== member.id ? 
                            `<button class="btn btn-primary" onclick="app.contactMember('${member.id}')">Contact</button>` : 
                            ''}
                    </div>
                </div>
            </div>
        `}).join('');
    }

    renderFeaturedMembers() {
        const featured = this.members.slice(0, 3);
        const container = document.getElementById('featuredMembers');
        if (!container) return;

        container.innerHTML = featured.map(member => {
            const tier = member.subscription_tier || 'visitor';
            const tierLabel = this.getTierDisplayName(tier);
            return `
            <div class="member-card fade-in">
                <div class="member-avatar">
                    ${member.avatar ?
                        `<img src="${member.avatar}" alt="${member.name}">` :
                        '<div class="avatar-placeholder">Photo</div>'
                    }
                    <span class="member-tier-badge tier-${tier}">${tierLabel}</span>
                </div>
                <div class="member-info">
                    <h4>${member.name}</h4>
                    <p class="member-bio">${member.bio ? member.bio.substring(0, 120) + (member.bio.length > 120 ? '...' : '') : 'No bio yet'}</p>
                    <div class="member-skills">
                        ${member.skills.slice(0, 3).map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
                    </div>
                    <div class="member-actions">
                        <button class="btn btn-outline" onclick="app.viewMemberProfile('${member.id}')">View Profile</button>
                        ${this.currentUser && this.currentUser.id !== member.id ? 
                            `<button class="btn btn-primary" onclick="app.contactMember('${member.id}')">Contact</button>` : 
                            ''}
                    </div>
                </div>
            </div>
        `}).join('');
    }

    viewMemberProfile(memberId) {
        const member = this.members.find(m => m.id === memberId);
        if (!member) return;

        const modal = document.getElementById('memberModal');
        const content = document.getElementById('memberModalContent');
        
        const tier = member.subscription_tier || 'visitor';
        const tierLabel = this.getTierDisplayName(tier);
        content.innerHTML = `
            <div class="member-profile">
                <div class="member-avatar-large" style="position: relative;">
                    ${member.avatar ?
                        `<img src="${member.avatar}" alt="${member.name}">` :
                        '<div class="avatar-placeholder">Photo</div>'
                    }
                    <span class="member-tier-badge tier-${tier}">${tierLabel}</span>
                </div>
                <h2>${member.name}</h2>
                ${member.user_status === 'admin' ? '<span class="status-badge">Catalist</span>' : ''}
                <div class="member-details">
                    <h4>About</h4>
                    <p>${member.bio || 'No bio yet'}</p>
                    
                    <h4>Skills</h4>
                    <div class="member-skills">
                        ${member.skills.map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
                    </div>
                    
                    ${member.projects && member.projects.length > 0 ? `
                        <h4>Portfolio Projects</h4>
                        <div class="portfolio-scroll">
                            ${member.projects.map(project => `
                                <div class="portfolio-project">
                                    ${project.image ? `<img src="${project.image}" alt="${project.title}" class="project-image">` : ''}
                                    <h4>${project.title}</h4>
                                    <p>${project.description}</p>
                                    ${project.link ? `<a href="${project.link}" target="_blank" class="btn btn-outline">View Project</a>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                    
                    ${member.portfolio ? `
                        <h4>Portfolio</h4>
                        <a href="${member.portfolio}" target="_blank" class="btn btn-outline">View Portfolio</a>
                    ` : ''}
                    
                    ${member.website ? `
                        <h4>Website</h4>
                        <a href="${member.website}" target="_blank" class="btn btn-outline">Visit Website</a>
                    ` : ''}
                    
                    ${member.social ? `
                        <h4>Social Media</h4>
                        <p>${member.social}</p>
                    ` : ''}
                    
                    ${this.currentUser && this.currentUser.id !== member.id ? `
                        <div class="member-actions mt-3">
                            <button class="btn btn-primary" onclick="app.contactMember('${member.id}')">Send Message</button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
        
        modal.classList.add('active');
    }

    renderNeeds() {
        const container = document.getElementById('needsGrid');
        
        if (this.needs.length === 0) {
            container.innerHTML = '<p class="empty-state">No active needs at the moment. Be the first to post!</p>';
            return;
        }
        
        container.innerHTML = this.needs.map(need => {
            const author = this.members.find(m => m.id === need.authorId);
            const matches = this.findMatches(need);
            const postedDate = new Date(need.postedDate);
            const daysAgo = Math.floor((new Date() - postedDate) / (1000 * 60 * 60 * 24));
            const timeAgo = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`;
            
            return `
                <div class="need-card fade-in">
                    <div class="need-header">
                        <div>
                            <h3 class="need-title">${need.title}</h3>
                            <p class="need-author">Posted by ${author?.name || 'Unknown'} • ${timeAgo}</p>
                        </div>
                        <div class="need-budget">${need.budget}</div>
                    </div>
                    <p class="need-description">${need.description}</p>
                    ${need.deadline ? `<p class="need-deadline"><strong>Deadline:</strong> ${new Date(need.deadline).toLocaleDateString()}</p>` : ''}
                    <div class="need-skills">
                        ${need.skills.map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
                    </div>
                    ${matches.length > 0 && this.currentUser ? `
                        <div class="matches-section">
                            <h4>✨ Potential Matches (${matches.length})</h4>
                            ${matches.slice(0, 3).map(match => `
                                <div class="match-item">
                                    <div class="match-info">
                                        <h5>${match.name}</h5>
                                        <p>${match.bio.substring(0, 100)}${match.bio.length > 100 ? '...' : ''}</p>
                                        <div class="match-skills">
                                            ${match.matchingSkills.map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
                                        </div>
                                    </div>
                                    ${this.currentUser.id !== match.id ? `<button class="btn btn-primary" onclick="app.contactMember('${match.id}')">Contact</button>` : ''}
                                </div>
                            `).join('')}
                            ${matches.length > 3 ? `<p style="text-align: center; margin-top: 1rem; font-weight: 700;">+${matches.length - 3} more matches</p>` : ''}
                        </div>
                    ` : ''}
                    <div class="need-actions">
                        ${this.currentUser && this.currentUser.id !== need.authorId ? 
                            `<button class="btn btn-primary" onclick="app.respondToNeed('${need.id}')">Respond to Need</button>` : 
                            this.currentUser && this.currentUser.id === need.authorId ?
                            `<button class="btn btn-outline" onclick="app.editNeed('${need.id}')">Edit</button>
                            <button class="btn btn-outline" onclick="app.markNeedClosed('${need.id}')">Mark as Closed</button>` :
                            `<button class="btn btn-outline" onclick="app.showAlert('Please login to respond', 'error'); app.showAuthModal();">Login to Respond</button>`
                        }
                        ${this.currentUser?.user_status === 'admin' && this.currentUser.id !== need.authorId ? `
                            <button class="btn btn-outline" onclick="app.adminDeleteNeed('${need.id}')" style="background: #000; color: #fff; font-size: 0.7rem;">Admin Delete</button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderLatestNeeds() {
        const latest = this.needs.slice(0, 3);
        const container = document.getElementById('latestNeeds');
        
        container.innerHTML = latest.map(need => {
            const author = this.members.find(m => m.id === need.authorId);
            return `
                <div class="need-card fade-in">
                    <div class="need-header">
                        <div>
                            <h3 class="need-title">${need.title}</h3>
                            <p class="need-author">Posted by ${author?.name || 'Unknown'}</p>
                        </div>
                        <div class="need-budget">${need.budget}</div>
                    </div>
                    <p class="need-description">${need.description.substring(0, 150)}${need.description.length > 150 ? '...' : ''}</p>
                    <div class="need-skills">
                        ${need.skills.slice(0, 4).map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
                    </div>
                    <div class="need-actions">
                        <button class="btn btn-outline" onclick="app.showSection('needs')">View All Needs</button>
                        ${this.currentUser && this.currentUser.id !== need.authorId ? 
                            `<button class="btn btn-primary" onclick="app.respondToNeed('${need.id}')">Respond</button>` : 
                            ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    async renderUpcomingEventsHome() {
        const container = document.getElementById('upcomingEvents');
        if (!container) {
            console.error('upcomingEvents container not found!');
            return;
        }
        
        console.log('Rendering upcoming events for home page...');
        container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        
        try {
            const googleEvents = await this.fetchGoogleCalendarEvents();
            console.log('Google events fetched:', googleEvents.length);
            
            if (googleEvents.length === 0) {
                console.log('No events found');
                container.innerHTML = '<p class="empty-state">No upcoming events</p>';
                return;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const eventsHTML = googleEvents.slice(0, 6).map(event => {
                const eventDate = event.start.dateTime ? new Date(event.start.dateTime) : new Date(event.start.date + 'T00:00:00');
                const eventDateMidnight = new Date(eventDate);
                eventDateMidnight.setHours(0, 0, 0, 0);
                const daysUntil = Math.round((eventDateMidnight - today) / (1000 * 60 * 60 * 24));
                const dayLabel = daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`;

                return `
                    <div class="event-card">
                        <span class="event-day-label">${dayLabel}</span>
                        <div class="event-header">
                            <h4 class="event-title">${event.summary || 'Untitled Event'}</h4>
                        </div>
                        <div class="event-details">
                            <div class="event-detail">
                                <strong>Date:</strong> ${eventDate.toLocaleDateString()}
                            </div>
                            ${event.start.dateTime ? `<div class="event-detail"><strong>Time:</strong> ${new Date(event.start.dateTime).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>` : ''}
                            ${event.location ? `<div class="event-detail"><strong>Location:</strong> ${event.location}</div>` : ''}
                        </div>
                        ${event.description ? `<p class="event-description">${event.description.substring(0, 100)}${event.description.length > 100 ? '...' : ''}</p>` : ''}
                        <button class="btn btn-outline" onclick="app.showSection('calendar')" style="margin-top: auto;">View All Events</button>
                    </div>
                `;
            }).join('');
            
            // Create a wrapper div with proper grid styling
            const wrapper = document.createElement('div');
            wrapper.className = 'events-grid';
            wrapper.style.gridTemplateColumns = 'repeat(3, 1fr)';
            wrapper.innerHTML = eventsHTML;
            container.innerHTML = '';
            container.appendChild(wrapper);
            
            console.log('Events rendered successfully');
        } catch (error) {
            console.error('Render events error:', error);
            container.innerHTML = '<p class="empty-state">Failed to load events</p>';
        }
    }

    async renderUpcomingWeekEvents() {
        const container = document.getElementById('upcomingWeekEvents');
        if (!container) return;
        
        container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        
        try {
            const googleEvents = await this.fetchGoogleCalendarEvents();
            
            if (googleEvents.length === 0) {
                container.innerHTML = '<p class="empty-state">No events in the next 7 days</p>';
                return;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const eventsHTML = googleEvents.map(event => {
                const eventDate = event.start.dateTime ? new Date(event.start.dateTime) : new Date(event.start.date + 'T00:00:00');
                const eventDateMidnight = new Date(eventDate);
                eventDateMidnight.setHours(0, 0, 0, 0);
                const daysUntil = Math.round((eventDateMidnight - today) / (1000 * 60 * 60 * 24));
                const dayLabel = daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`;

                return `
                    <div class="event-card">
                        <span class="event-day-label">${dayLabel}</span>
                        <div class="event-header">
                            <h4 class="event-title">${event.summary || 'Untitled Event'}</h4>
                        </div>
                        <div class="event-details">
                            <div class="event-detail">
                                <strong>Date:</strong> ${eventDate.toLocaleDateString()}
                            </div>
                            ${event.start.dateTime ? `<div class="event-detail"><strong>Time:</strong> ${new Date(event.start.dateTime).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>` : ''}
                            ${event.location ? `<div class="event-detail"><strong>Location:</strong> ${event.location}</div>` : ''}
                        </div>
                        ${event.description ? `<p class="event-description">${event.description.substring(0, 100)}${event.description.length > 100 ? '...' : ''}</p>` : ''}
                        ${event.htmlLink ? `<a href="${event.htmlLink}" target="_blank" class="btn btn-outline" style="margin-top: auto;">View Details</a>` : ''}
                    </div>
                `;
            }).join('');
            
            // Create a wrapper div with proper grid styling (same as home page)
            const wrapper = document.createElement('div');
            wrapper.className = 'events-grid';
            wrapper.style.gridTemplateColumns = 'repeat(3, 1fr)';
            wrapper.innerHTML = eventsHTML;
            container.innerHTML = '';
            container.appendChild(wrapper);
            
            console.log('Calendar events rendered successfully');
        } catch (error) {
            container.innerHTML = '<p class="empty-state">Failed to load events</p>';
            console.error(error);
        }
    }
    async toggleVerification(memberId, currentStatus) {
        console.log('=== TOGGLE VERIFICATION DEBUG ===');
        console.log('memberId:', memberId);
        console.log('currentStatus:', currentStatus);
        console.log('currentUser:', this.currentUser);
        console.log('currentUser.user_status:', this.currentUser?.user_status);
        console.log('Is admin?:', this.currentUser?.user_status === 'admin');
        
        if (!this.currentUser) {
            this.showAlert('Please login to verify members', 'error');
            return;
        }
        
        if (this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can verify members. Your status: ' + this.currentUser.user_status, 'error');
            return;
        }

        const newStatus = currentStatus === 'verified' ? 'unverified' : 'verified';
        
        if (!confirm(`Are you sure you want to ${newStatus === 'verified' ? 'verify' : 'unverify'} this member?`)) {
            return;
        }

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ user_status: newStatus })
                .eq('id', memberId);

            if (error) throw error;

            this.showAlert(`Member ${newStatus === 'verified' ? 'verified' : 'unverified'} successfully`, 'success');
            await this.loadMembers();
            this.renderMembers();
        } catch (error) {
            console.error('Verification error:', error);
            this.showAlert('Error updating member: ' + error.message, 'error');
        }
    }

    async deleteMember(memberId) {
        console.log('deleteMember called:', { memberId, currentUser: this.currentUser });
        
        if (!this.currentUser) {
            this.showAlert('Please login to delete members', 'error');
            return;
        }
        
        if (this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can delete members. Your status: ' + this.currentUser.user_status, 'error');
            return;
        }

        if (!confirm('Are you sure you want to delete this member? This action cannot be undone!')) {
            return;
        }

        try {
            // Delete user's missions first
            const { error: missionsError } = await supabase
                .from('missions')
                .delete()
                .eq('author_id', memberId);
            
            if (missionsError) console.warn('Error deleting missions:', missionsError);
            
            // Delete user's messages
            const { error: messagesError } = await supabase
                .from('messages')
                .delete()
                .or(`from_id.eq.${memberId},to_id.eq.${memberId}`);
            
            if (messagesError) console.warn('Error deleting messages:', messagesError);
            
            // Delete profile
            const { error } = await supabase
                .from('profiles')
                .delete()
                .eq('id', memberId);

            if (error) throw error;

            this.showAlert('Member deleted successfully', 'success');
            await this.loadMembers();
            this.renderMembers();
        } catch (error) {
            console.error('Delete member error:', error);
            this.showAlert('Error deleting member: ' + error.message, 'error');
        }
    }
    async adminDeleteNeed(needId) {
        if (!this.currentUser || this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can delete needs', 'error');
            return;
        }

        if (!confirm('Are you sure you want to delete this need? This action cannot be undone!')) {
            return;
        }

        try {
            const { error } = await supabase
                .from('missions')
                .delete()
                .eq('id', needId);

            if (error) throw error;

            this.showAlert('Need deleted successfully', 'success');
            await this.loadMissions();
            this.renderNeeds();
        } catch (error) {
            console.error('Delete need error:', error);
            this.showAlert('Error deleting need: ' + error.message, 'error');
        }
    }
    // ====================================
    // PHOTO GALLERY
    // ====================================
    async uploadToGallery(bucketName, prefix = '') {
        if (!this.currentUser) {
            this.showAlert('Please login first', 'error');
            return null;
        }

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.multiple = true;

        return new Promise((resolve) => {
            fileInput.onchange = async (e) => {
                const files = Array.from(e.target.files);
                if (files.length === 0) {
                    resolve(null);
                    return;
                }

                const uploadedUrls = [];
                
                for (const file of files) {
                    if (!file.type.startsWith('image/')) continue;
                    if (file.size > 5 * 1024 * 1024) continue; // Skip files > 5MB

                    try {
                        const fileExt = file.name.split('.').pop();
                        const fileName = `${this.currentUser.id}/${prefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`;

                        const { error } = await supabase.storage
                            .from(bucketName)
                            .upload(fileName, file, {
                                cacheControl: '3600',
                                upsert: false
                            });

                        if (error) throw error;

                        const { data: { publicUrl } } = supabase.storage
                            .from(bucketName)
                            .getPublicUrl(fileName);

                        uploadedUrls.push(publicUrl);
                    } catch (error) {
                        console.error('Upload error:', error);
                    }
                }

                resolve(uploadedUrls);
            };

            fileInput.click();
        });
    }

    async addProfileGalleryPhotos() {
        const urls = await this.uploadToGallery('profile-galleries', 'gallery-');
        if (!urls || urls.length === 0) return;

        if (!this.currentUser.profile_gallery) {
            this.currentUser.profile_gallery = [];
        }

        this.currentUser.profile_gallery = [...this.currentUser.profile_gallery, ...urls];

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ profile_gallery: this.currentUser.profile_gallery })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            this.showAlert(`Added ${urls.length} photo(s) to gallery`, 'success');
            this.renderProfileGallery();
        } catch (error) {
            this.showAlert('Error saving gallery: ' + error.message, 'error');
        }
    }

    async removeProfileGalleryPhoto(index) {
        if (!this.currentUser || !this.currentUser.profile_gallery) return;
        
        if (!confirm('Remove this photo from your gallery?')) return;

        this.currentUser.profile_gallery.splice(index, 1);

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ profile_gallery: this.currentUser.profile_gallery })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            this.showAlert('Photo removed', 'success');
            this.renderProfileGallery();
        } catch (error) {
            this.showAlert('Error removing photo: ' + error.message, 'error');
        }
    }

    renderProfileGallery() {
        const container = document.getElementById('profileGalleryGrid');
        if (!container) return;

        if (!this.currentUser.profile_gallery || this.currentUser.profile_gallery.length === 0) {
            container.innerHTML = '<p class="empty-state">No photos yet - add some to showcase yourself!</p>';
            return;
        }

        container.innerHTML = `
            <div class="gallery-grid">
                ${this.currentUser.profile_gallery.map((url, index) => `
                    <div class="gallery-item" onclick="app.viewGallery(app.currentUser.profile_gallery, ${index})">
                        ${index === 0 ? '<span class="gallery-item-badge">Cover</span>' : ''}
                        <span class="gallery-item-remove" onclick="event.stopPropagation(); app.removeProfileGalleryPhoto(${index})">×</span>
                        <img src="${url}" alt="Gallery photo ${index + 1}">
                    </div>
                `).join('')}
                <div class="gallery-add-btn" onclick="app.addProfileGalleryPhotos()">+</div>
            </div>
        `;
    }

    viewGallery(images, startIndex = 0) {
        this.currentGallery = images;
        this.currentGalleryIndex = startIndex;
        
        document.getElementById('galleryImage').src = images[startIndex];
        document.getElementById('galleryCounter').textContent = `${startIndex + 1} / ${images.length}`;
        document.getElementById('galleryModal').classList.add('active');
    }

    nextGalleryImage() {
        if (this.currentGalleryIndex < this.currentGallery.length - 1) {
            this.currentGalleryIndex++;
            document.getElementById('galleryImage').src = this.currentGallery[this.currentGalleryIndex];
            document.getElementById('galleryCounter').textContent = `${this.currentGalleryIndex + 1} / ${this.currentGallery.length}`;
        }
    }

    prevGalleryImage() {
        if (this.currentGalleryIndex > 0) {
            this.currentGalleryIndex--;
            document.getElementById('galleryImage').src = this.currentGallery[this.currentGalleryIndex];
            document.getElementById('galleryCounter').textContent = `${this.currentGalleryIndex + 1} / ${this.currentGallery.length}`;
        }
    }
    // ====================================
    // FILTERING & SEARCH
    // ====================================
    filterMembers() {
        const searchTerm = document.getElementById('memberSearch').value.toLowerCase();
        const selectedSkill = document.getElementById('skillFilter').value;

        let filtered = this.members.filter(member => {
            const matchesSearch = !searchTerm || 
                member.name.toLowerCase().includes(searchTerm) ||
                member.bio.toLowerCase().includes(searchTerm) ||
                member.skills.some(skill => skill.toLowerCase().includes(searchTerm));

            const matchesSkill = !selectedSkill || member.skills.includes(selectedSkill);

            return matchesSearch && matchesSkill;
        });

        this.renderMembers(filtered);
    }

    populateSkillFilters() {
        const allSkills = [...new Set(this.members.flatMap(m => m.skills))].sort();
        const select = document.getElementById('skillFilter');
        
        while (select.options.length > 1) {
            select.remove(1);
        }
        
        allSkills.forEach(skill => {
            const option = document.createElement('option');
            option.value = skill;
            option.textContent = skill;
            select.appendChild(option);
        });
    }
    showLoadingStats() {
            document.getElementById('memberCount').textContent = '0';
            document.getElementById('needsCount').textContent = '0';
            document.getElementById('eventsCount').textContent = '0';
            document.getElementById('checkedInCount').textContent = '0';
        }
    // ====================================
    // UI HELPERS
    // ====================================
    async updateStats() {
        document.getElementById('memberCount').textContent = this.members.length;
        document.getElementById('needsCount').textContent = this.needs.filter(n => n.status === 'open').length;
        
        // Count checked in members
        const checkedIn = this.checkInStatuses.filter(s => s.status === 'in').length;
        const checkedInEl = document.getElementById('checkedInCount');
        if (checkedInEl) {
            checkedInEl.textContent = checkedIn;
        }
        
        // Update Open/Closed status based on admin/catalist check-in
        this.updateSpaceStatus();

        // Count only Google Calendar events in next 7 days
        try {
            const googleEvents = await this.fetchGoogleCalendarEvents();
            document.getElementById('eventsCount').textContent = googleEvents.length;
        } catch (error) {
            console.error('Error counting events:', error);
            document.getElementById('eventsCount').textContent = '0';
        }
    }

    updateSpaceStatus() {
        const indicator = document.getElementById('spaceStatusIndicator');
        const statusText = document.getElementById('spaceStatusText');
        if (!indicator || !statusText) return;

        // Check if any admin (catalist) members are currently checked in
        const adminMembers = this.members.filter(m => m.user_status === 'admin');
        const adminCheckedIn = adminMembers.some(admin => {
            const status = this.checkInStatuses.find(s => s.user_id === admin.id);
            return status && status.status === 'in';
        });

        if (adminCheckedIn) {
            indicator.classList.add('is-open');
            indicator.classList.remove('is-closed');
            statusText.textContent = 'OPEN';
        } else {
            indicator.classList.remove('is-open');
            indicator.classList.add('is-closed');
            statusText.textContent = 'CLOSED';
        }
    }

    showAuthModal() {
        document.getElementById('authModal').classList.add('active');
    }

    closeModal(modal) {
        console.log('🚪 Closing modal:', modal.id);
        modal.classList.remove('active');

        // Force hide on mobile (double-check for mobile browsers)
        if (window.innerWidth <= 768) {
            console.log('📱 Mobile detected - forcing modal display:none');
            modal.style.display = 'none';
            // Reset after a moment to allow CSS to take over
            setTimeout(() => {
                modal.style.display = '';
                console.log('✅ Modal display reset to CSS control');
            }, 100);
        }

        this.clearForms();
        console.log('✅ Modal closed successfully');
    }

    clearForms() {
        document.querySelectorAll('form').forEach(form => form.reset());
    }

    showAlert(message, type = 'success') {
        console.log(`Alert (${type}):`, message);

        // Remove existing alerts
        document.querySelectorAll('.alert').forEach(alert => alert.remove());

        const alert = document.createElement('div');
        alert.className = `alert alert-${type} fade-in`;
        alert.textContent = message;
        alert.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10000;
            max-width: 90%;
            width: auto;
            min-width: 300px;
            text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;

        document.body.appendChild(alert);

        setTimeout(() => {
            if (alert.parentNode) {
                alert.style.opacity = '0';
                alert.style.transition = 'opacity 0.3s ease';
                setTimeout(() => alert.remove(), 300);
            }
        }, 5000);
    }
    // ====================================
    // CHECK-IN SYSTEM
    // ====================================
    async loadCheckInStatuses() {
        try {
            console.log('Loading check-in statuses...');
            
            const { data, error } = await supabase
                .from('current_check_in_status')
                .select('*');

            if (error) throw error;

            this.checkInStatuses = data || [];
            console.log('✓ Loaded', this.checkInStatuses.length, 'check-in statuses');
        } catch (error) {
            console.error('Load check-in statuses error:', error);
            this.checkInStatuses = [];
        }
    }

    async renderCheckInSection() {
        if (!this.currentUser) {
            document.getElementById('checkinAccessDenied').style.display = 'block';
            document.getElementById('userCheckinCard').style.display = 'none';
            document.getElementById('adminCheckinControls').style.display = 'none';
            return;
        }

        document.getElementById('checkinAccessDenied').style.display = 'none';
        document.getElementById('userCheckinCard').style.display = 'block';

        // Show current status
        await this.updateUserCheckInStatus();

        // Show admin controls if admin
        if (this.currentUser.user_status === 'admin') {
            document.getElementById('adminCheckinControls').style.display = 'block';
            await this.renderAdminCheckInList();
            if (this.activityWeekOffset === undefined) this.initActivityLog();
            await this.renderActivityLog();
        } else {
            document.getElementById('adminCheckinControls').style.display = 'none';
        }
    }

    async updateUserCheckInStatus() {
        if (!this.currentUser) return;

        try {
            const { data, error } = await supabase
                .from('current_check_in_status')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .maybeSingle();

            if (error && error.code !== 'PGRST116') throw error;

            const currentStatus = data?.status || 'out';
            const timestamp = data?.timestamp ? new Date(data.timestamp) : null;

            const statusText = document.getElementById('userStatusText');
            const statusTime = document.getElementById('userStatusTime');
            const toggleBtn = document.getElementById('toggleStatusBtn');
            const toggleBtnText = document.getElementById('toggleStatusText');
            const toggleBtnIcon = document.getElementById('toggleStatusIcon');

            if (currentStatus === 'in') {
                statusText.textContent = 'You are IN the space';
                toggleBtn.className = 'circular-checkin-btn status-in';
                toggleBtnText.textContent = 'Check Out';
                toggleBtnIcon.textContent = '●';
                toggleBtnIcon.style.color = '#000';
            } else {
                statusText.textContent = 'You are OUT';
                toggleBtn.className = 'circular-checkin-btn status-out';
                toggleBtnText.textContent = 'Check In';
                toggleBtnIcon.textContent = '○';
                toggleBtnIcon.style.color = '#000';
            }

            if (timestamp) {
                const timeAgo = this.getTimeAgo(timestamp);
                statusTime.textContent = `Last updated ${timeAgo}`;
            } else {
                statusTime.textContent = 'No check-ins yet';
            }
        } catch (error) {
            console.error('Error loading user status:', error);
        }
    }

    async updateHomeCheckInStatus() {
        if (!this.currentUser) return;

        try {
            const { data, error } = await supabase
                .from('current_check_in_status')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .maybeSingle();

            if (error && error.code !== 'PGRST116') throw error;

            const currentStatus = data?.status || 'out';
            const timestamp = data?.timestamp ? new Date(data.timestamp) : null;

            const statusText = document.getElementById('homeStatusText');
            const statusTime = document.getElementById('homeStatusTime');
            const toggleBtn = document.getElementById('homeToggleStatusBtn');
            const toggleBtnText = document.getElementById('homeToggleStatusText');

            if (!statusText || !toggleBtn) return;

            if (currentStatus === 'in') {
                statusText.textContent = 'You are IN the space';
                toggleBtn.className = 'circular-checkin-btn status-in';
                toggleBtnText.textContent = 'Check Out';
            } else {
                statusText.textContent = 'You are OUT';
                toggleBtn.className = 'circular-checkin-btn status-out';
                toggleBtnText.textContent = 'Check In';
            }

            if (timestamp) {
                statusTime.textContent = `Last updated ${this.getTimeAgo(timestamp)}`;
            } else {
                statusTime.textContent = '';
            }
        } catch (error) {
            console.error('Error loading home check-in status:', error);
        }
    }

    async toggleUserCheckIn() {
        if (!this.currentUser) return;

        try {
            const { data: current, error: fetchError } = await supabase
                .from('current_check_in_status')
                .select('status')
                .eq('user_id', this.currentUser.id)
                .maybeSingle();

            if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

            const currentStatus = current?.status || 'out';
            const newStatus = currentStatus === 'in' ? 'out' : 'in';

            const { error: insertError } = await supabase
                .from('check_ins')
                .insert([{
                    user_id: this.currentUser.id,
                    status: newStatus,
                    timestamp: new Date().toISOString()
                }]);

            if (insertError) throw insertError;

            this.showAlert(`Successfully checked ${newStatus}!`, 'success');
            await this.loadCheckInStatuses();
            await this.updateUserCheckInStatus();
            await this.updateHomeCheckInStatus();

            // Reset buttons to unpressed position (clears sticky hover/active on mobile)
            const checkinBtn = document.getElementById('toggleStatusBtn');
            const homeBtn = document.getElementById('homeToggleStatusBtn');
            if (checkinBtn) checkinBtn.blur();
            if (homeBtn) homeBtn.blur();

            if (this.currentUser.user_status === 'admin') {
                await this.renderAdminCheckInList();
            }
        } catch (error) {
            console.error('Toggle check-in error:', error);
            this.showAlert('Error updating status: ' + error.message, 'error');
        }
    }

    async renderAdminCheckInList() {
        const container = document.getElementById('adminCheckinList');
        if (!container) return;

        await this.loadCheckInStatuses();
        await this.loadMembers();

        // Calculate stats
        const inSpace = this.checkInStatuses.filter(s => s.status === 'in').length;
        const checkedOut = this.checkInStatuses.filter(s => s.status === 'out').length;
        
        document.getElementById('totalInSpace').textContent = inSpace;
        document.getElementById('totalCheckedOut').textContent = checkedOut;

        // Get all members with their status
        const membersWithStatus = this.members.map(member => {
            const status = this.checkInStatuses.find(s => s.user_id === member.id);
            return {
                ...member,
                checkInStatus: status?.status || 'out',
                lastUpdate: status?.timestamp || null,
                manually_set_by: status?.manually_set_by || null
            };
        });

        // Filter based on current filter
        let filteredMembers = membersWithStatus;
        if (this.currentCheckInFilter === 'in') {
            filteredMembers = membersWithStatus.filter(m => m.checkInStatus === 'in');
        } else if (this.currentCheckInFilter === 'out') {
            filteredMembers = membersWithStatus.filter(m => m.checkInStatus === 'out');
        }

        // Sort: in first, then by name
        filteredMembers.sort((a, b) => {
            if (a.checkInStatus === 'in' && b.checkInStatus !== 'in') return -1;
            if (a.checkInStatus !== 'in' && b.checkInStatus === 'in') return 1;
            return a.name.localeCompare(b.name);
        });

        container.innerHTML = filteredMembers.map(member => {
            const timeAgo = member.lastUpdate ? this.getTimeAgo(new Date(member.lastUpdate)) : 'Never';
            return `
                <div class="admin-checkin-item ${member.checkInStatus === 'in' ? 'status-in' : 'status-out'}">
                    <div class="checkin-item-info">
                        <div class="checkin-item-header">
                            <h4>${member.name}</h4>
                            <span class="checkin-status-badge status-${member.checkInStatus}">
                                ${member.checkInStatus === 'in' ? '● IN' : '○ OUT'}
                            </span>
                        </div>
                        <p class="checkin-time">Last update: ${timeAgo}</p>
                    </div>
                    <div class="checkin-item-actions">
                        <button class="btn btn-outline btn-sm" onclick="app.adminSetStatus('${member.id}', 'in')">
                            Set IN
                        </button>
                        <button class="btn btn-outline btn-sm" onclick="app.adminSetStatus('${member.id}', 'out')">
                            Set OUT
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    async adminSetStatus(userId, status) {
        if (!this.currentUser || this.currentUser.user_status !== 'admin') {
            this.showAlert('Admin access required', 'error');
            return;
        }

        const member = this.members.find(m => m.id === userId);
        if (!confirm(`Set ${member?.name || 'this member'} as ${status.toUpperCase()}?`)) {
            return;
        }

        try {
            const { error } = await supabase
                .from('check_ins')
                .insert([{
                    user_id: userId,
                    status: status,
                    manually_set_by: this.currentUser.id,
                    timestamp: new Date().toISOString()
                }]);

            if (error) throw error;

            this.showAlert(`Status updated to ${status.toUpperCase()}`, 'success');
            await this.loadCheckInStatuses();
            await this.renderAdminCheckInList();
        } catch (error) {
            console.error('Admin set status error:', error);
            this.showAlert('Error updating status: ' + error.message, 'error');
        }
    }

    setCheckInFilter(filter) {
        this.currentCheckInFilter = filter;

        document.querySelectorAll('.checkin-filters .filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-filter="${filter}"]`).classList.add('active');

        this.renderAdminCheckInList();
    }

    // ====================================
    // ACTIVITY LOG - WEEK CALENDAR
    // ====================================
    initActivityLog() {
        this.activityWeekOffset = 0; // 0 = current week, -1 = last week, etc.

        document.getElementById('activityPrevWeek')?.addEventListener('click', () => {
            this.activityWeekOffset--;
            this.renderActivityLog();
        });

        document.getElementById('activityNextWeek')?.addEventListener('click', () => {
            if (this.activityWeekOffset < 0) {
                this.activityWeekOffset++;
                this.renderActivityLog();
            }
        });
    }

    getWeekRange(offset) {
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0=Sun
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - dayOfWeek + (offset * 7));
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        return { start: startOfWeek, end: endOfWeek };
    }

    async renderActivityLog() {
        if (!this.currentUser || this.currentUser.user_status !== 'admin') return;

        const { start, end } = this.getWeekRange(this.activityWeekOffset);

        // Update week label
        const label = document.getElementById('activityWeekLabel');
        const opts = { month: 'short', day: 'numeric' };
        label.textContent = `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;

        // Disable next button if current week
        const nextBtn = document.getElementById('activityNextWeek');
        if (nextBtn) {
            nextBtn.disabled = this.activityWeekOffset >= 0;
            nextBtn.style.opacity = this.activityWeekOffset >= 0 ? '0.4' : '1';
        }

        // Fetch check-in history for this week
        try {
            const { data, error } = await supabase
                .from('check_ins')
                .select('*')
                .gte('timestamp', start.toISOString())
                .lte('timestamp', end.toISOString())
                .order('timestamp', { ascending: true });

            if (error) throw error;

            const entries = data || [];

            // Build member name lookup
            const memberMap = {};
            this.members.forEach(m => { memberMap[m.id] = m.name; });

            // Summary stats
            const totalEvents = entries.length;
            const checkIns = entries.filter(e => e.status === 'in').length;
            const checkOuts = entries.filter(e => e.status === 'out').length;
            const uniqueMembers = new Set(entries.map(e => e.user_id)).size;

            const summaryEl = document.getElementById('activitySummary');
            summaryEl.innerHTML = `
                <div class="activity-summary-stat">
                    <span class="stat-number">${totalEvents}</span>
                    <span class="stat-label">Total Events</span>
                </div>
                <div class="activity-summary-stat">
                    <span class="stat-number">${checkIns}</span>
                    <span class="stat-label">Check Ins</span>
                </div>
                <div class="activity-summary-stat">
                    <span class="stat-number">${checkOuts}</span>
                    <span class="stat-label">Check Outs</span>
                </div>
                <div class="activity-summary-stat">
                    <span class="stat-number">${uniqueMembers}</span>
                    <span class="stat-label">Unique Members</span>
                </div>
            `;

            // Group entries by day
            const dayBuckets = {};
            for (let i = 0; i < 7; i++) {
                const d = new Date(start);
                d.setDate(start.getDate() + i);
                const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                dayBuckets[key] = [];
            }

            entries.forEach(entry => {
                const entryDate = new Date(entry.timestamp);
                const key = `${entryDate.getFullYear()}-${String(entryDate.getMonth()+1).padStart(2,'0')}-${String(entryDate.getDate()).padStart(2,'0')}`;
                if (dayBuckets[key]) {
                    dayBuckets[key].push(entry);
                }
            });

            // Render week grid
            const now = new Date();
            const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const grid = document.getElementById('activityWeekGrid');

            grid.innerHTML = Object.keys(dayBuckets).map(dateKey => {
                const d = new Date(dateKey + 'T12:00:00');
                const dayName = dayNames[d.getDay()];
                const dayNum = d.getDate();
                const isToday = dateKey === today;
                const dayEntries = dayBuckets[dateKey];

                const entriesHTML = dayEntries.length === 0
                    ? '<div class="activity-day-empty">—</div>'
                    : dayEntries.map(entry => {
                        const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                        });
                        const name = memberMap[entry.user_id] || 'Unknown';
                        const isIn = entry.status === 'in';
                        return `
                            <div class="activity-entry">
                                <span class="activity-dot ${isIn ? 'dot-in' : 'dot-out'}">${isIn ? '●' : '○'}</span>
                                <div class="activity-entry-info">
                                    <div class="activity-entry-name">${name}</div>
                                    <div class="activity-entry-time">${isIn ? 'IN' : 'OUT'} · ${time}</div>
                                </div>
                            </div>
                        `;
                    }).join('');

                return `
                    <div class="activity-day ${isToday ? 'today' : ''}">
                        <div class="activity-day-header">
                            <span>${dayName}</span>
                            <span class="activity-day-date">${dayNum}</span>
                        </div>
                        <div class="activity-day-entries">${entriesHTML}</div>
                    </div>
                `;
            }).join('');

        } catch (error) {
            console.error('Error loading activity log:', error);
        }
    }

    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);

        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;

        return date.toLocaleDateString();
    }

    // ====================================
    // MEMBERSHIP & SUBSCRIPTIONS
    // ====================================
    async loadSubscriptionTiers() {
        try {
            const { data, error } = await supabase
                .from('subscription_tiers')
                .select('*')
                .order('price', { ascending: true });

            if (error) throw error;

            this.subscriptionTiers = data || [];
            console.log('Loaded subscription tiers:', this.subscriptionTiers);
        } catch (error) {
            console.error('Error loading subscription tiers:', error);
        }
    }

    async loadUserSubscription() {
        if (!this.currentUser) return;

        try {
            const { data, error } = await supabase
                .from('user_subscriptions')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .eq('status', 'active')
                .single();

            if (error && error.code !== 'PGRST116') throw error;

            this.userSubscription = data;
            this.updateMembershipDisplay();
        } catch (error) {
            console.error('Error loading user subscription:', error);
        }
    }

    updateMembershipDisplay() {
        const currentStatus = document.getElementById('currentMembershipStatus');
        const currentTierName = document.getElementById('currentTierName');
        const currentTierStatus = document.getElementById('currentTierStatus');

        if (!this.currentUser) {
            if (currentStatus) currentStatus.style.display = 'none';
            return;
        }

        if (currentStatus) currentStatus.style.display = 'block';

        const tierName = this.userSubscription?.tier_id || this.currentUser.subscription_tier || 'visitor';
        const status = this.userSubscription?.status || 'active';

        if (currentTierName) currentTierName.textContent = this.getTierDisplayName(tierName);
        if (currentTierStatus) {
            currentTierStatus.textContent = status.charAt(0).toUpperCase() + status.slice(1);
            currentTierStatus.className = 'tier-status ' + (status === 'active' ? 'status-active' : 'status-inactive');
        }

        document.querySelectorAll('.tier-select-btn').forEach(btn => {
            const btnTier = btn.dataset.tier;
            if (btnTier === tierName) {
                btn.textContent = 'Current Tier';
                btn.classList.remove('btn-primary');
                btn.classList.add('btn-outline');
                btn.disabled = true;
            } else {
                btn.disabled = false;
                if (btnTier === 'visitor') {
                    btn.textContent = 'Downgrade to ' + this.getTierDisplayName('visitor');
                } else {
                    btn.textContent = 'Select ' + this.getTierDisplayName(btnTier);
                }
            }
        });
    }

    async selectMembershipTier(tier, price) {
        if (!this.currentUser) {
            this.showAlert('Please log in to select a membership tier', 'error');
            this.showAuthModal();
            return;
        }

        const priceNum = parseFloat(price);

        if (tier === 'visitor' || priceNum === 0) {
            await this.downgradeMembership(tier);
            return;
        }

        await this.createStripeCheckout(tier, priceNum);
    }

    async createStripeCheckout(tier, price) {
        const paymentLinks = {
            member: 'https://buy.stripe.com/3cI8wP6Uwc22gpY1FSgnK00',
            contributor: 'https://buy.stripe.com/eVq9ATceQ6HIddM4S4gnK01'
        };

        const link = paymentLinks[tier];
        if (!link) {
            this.showAlert('Invalid membership tier selected.', 'error');
            return;
        }

        this.showAlert('Redirecting to checkout...', 'info');
        window.location.href = link;
    }

    async downgradeMembership(tier) {
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ subscription_tier: tier })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            if (this.userSubscription) {
                const { error: subError } = await supabase
                    .from('user_subscriptions')
                    .update({
                        status: 'canceled',
                        cancel_at_period_end: true
                    })
                    .eq('user_id', this.currentUser.id);

                if (subError) console.error('Error canceling subscription:', subError);
            }

            this.currentUser.subscription_tier = tier;
            await this.loadUserSubscription();
            this.showAlert('Membership updated successfully!', 'success');

        } catch (error) {
            console.error('Error downgrading membership:', error);
            this.showAlert('Error updating membership. Please try again.', 'error');
        }
    }

    async manageMembership() {
        if (!this.userSubscription || !this.userSubscription.stripe_customer_id) {
            this.showAlert('No active subscription to manage', 'info');
            return;
        }

        this.showAlert('Opening billing portal...', 'info');
    }

    async handlePaymentSuccess(tier) {
        try {
            const { error: profileError } = await supabase
                .from('profiles')
                .update({ subscription_tier: tier })
                .eq('id', this.currentUser.id);

            if (profileError) throw profileError;

            const { error: subError } = await supabase
                .from('user_subscriptions')
                .upsert({
                    user_id: this.currentUser.id,
                    tier_id: tier,
                    status: 'active',
                    current_period_start: new Date().toISOString(),
                    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                }, {
                    onConflict: 'user_id'
                });

            if (subError) throw subError;

            this.currentUser.subscription_tier = tier;
            await this.loadUserSubscription();
            this.showAlert('Welcome to DōM ' + tier.charAt(0).toUpperCase() + tier.slice(1) + ' membership!', 'success');
            this.showSection('membership');

        } catch (error) {
            console.error('Error processing payment success:', error);
            this.showAlert('Payment successful but error updating membership. Please contact support.', 'error');
        }
    }

    // ====================================
    // ABOUT / FEEDBACK
    // ====================================
    loadAboutSection() {
        // Show admin feedback panel if user is admin
        const adminSection = document.getElementById('feedbackAdminSection');
        if (this.currentUser && this.currentUser.user_status === 'admin') {
            adminSection.style.display = 'block';
            this.loadFeedback();
        } else {
            adminSection.style.display = 'none';
        }
    }

    async submitFeedback(e) {
        e.preventDefault();

        const name = document.getElementById('feedbackName').value.trim() || 'Anonymous';
        const type = document.getElementById('feedbackType').value;
        const message = document.getElementById('feedbackMessage').value.trim();

        if (!message) {
            this.showAlert('Please enter a message', 'error');
            return;
        }

        try {
            const { error } = await supabase.from('feedback').insert([{
                name: name,
                type: type,
                message: message,
                user_id: this.currentUser?.id || null,
                created_at: new Date().toISOString()
            }]);

            if (error) throw error;

            document.getElementById('feedbackForm').reset();
            this.showAlert('Thank you for your feedback!', 'success');
        } catch (error) {
            console.error('Feedback submission error:', error);
            this.showAlert('Failed to submit feedback. Please try again.', 'error');
        }
    }

    async loadFeedback() {
        const list = document.getElementById('feedbackList');
        list.innerHTML = '<p class="empty-state">Loading feedback...</p>';

        try {
            const { data, error } = await supabase
                .from('feedback')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (!data || data.length === 0) {
                list.innerHTML = '<p class="empty-state">No feedback yet</p>';
                return;
            }

            list.innerHTML = data.map(item => `
                <div class="feedback-item">
                    <div class="feedback-item-header">
                        <span class="feedback-item-name">${item.name || 'Anonymous'}</span>
                        <span class="feedback-item-type">${item.type || 'general'}</span>
                    </div>
                    <p class="feedback-item-message">${item.message}</p>
                    <span class="feedback-item-date">${new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                </div>
            `).join('');
        } catch (error) {
            console.error('Load feedback error:', error);
            list.innerHTML = '<p class="empty-state">Could not load feedback</p>';
        }
    }

    // ====================================
    // EVENT BINDING
    // ====================================
    bindEvents() {
        // Navigation (Mobile)
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.showSection(e.target.dataset.section));
        });

        // Desktop Logo click-to-toggle sidebar (keeps menu open until clicked again)
        const logoTrigger = document.getElementById('logoDropdownTrigger');
        if (logoTrigger) {
            logoTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const container = document.querySelector('.logo-dropdown-container');
                if (container) container.classList.toggle('active');
            });
            // Close sidebar when clicking anywhere outside it
            document.addEventListener('click', (e) => {
                const container = document.querySelector('.logo-dropdown-container');
                if (container && container.classList.contains('active') && !container.contains(e.target)) {
                    container.classList.remove('active');
                }
            });
        }

        // Desktop Dropdown Navigation (V5.2)
        document.querySelectorAll('.dropdown-nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.showSection(e.target.dataset.section);
                // Close dropdown after selection
                const container = document.querySelector('.logo-dropdown-container');
                if (container) container.classList.remove('active');
            });
        });

        // Desktop Dropdown Auth Button (V5.2)
        const authDropdownBtn = document.getElementById('authDropdownBtn');
        if (authDropdownBtn) {
            authDropdownBtn.addEventListener('click', () => {
                if (this.currentUser) {
                    this.logout();
                } else {
                    this.showAuthModal();
                }
                // Close dropdown after action
                const container = document.querySelector('.logo-dropdown-container');
                if (container) container.classList.remove('active');
            });
        }

        // Authentication
        document.getElementById('authBtn').addEventListener('click', () => {
            if (this.currentUser) {
                this.logout();
            } else {
                this.showAuthModal();
            }
        });
        document.getElementById('authForm').addEventListener('submit', (e) => this.handleAuth(e));
        document.getElementById('googleSignInBtn').addEventListener('click', () => this.signInWithGoogle());
        document.getElementById('authToggleLink').addEventListener('click', (e) => {
            e.preventDefault();
            this.toggleAuthMode();
        });

        // Onboarding
        document.getElementById('onboardingForm').addEventListener('submit', (e) => this.completeOnboarding(e));

        // Profile
        document.getElementById('profileForm').addEventListener('submit', (e) => this.saveProfile(e));
        document.getElementById('profileEditBtn').addEventListener('click', () => this.toggleProfileEditMode());
        document.getElementById('profileAvatar').addEventListener('input', () => this.updateAvatarDisplay());
        document.getElementById('addProjectBtn').addEventListener('click', () => this.showProjectModal());
        const profilePhotosInput = document.getElementById('profilePhotosInput');
        if (profilePhotosInput) {
            profilePhotosInput.addEventListener('change', (e) => this.handleProfilePhotos(e));
        }
        
        const projectImageFile = document.getElementById('projectImageFile');
        if (projectImageFile) {
            projectImageFile.addEventListener('change', (e) => this.handleProjectImageSelect(e));
        }

        // Skill suggestions
        document.querySelectorAll('.skills-suggestions .skill-tag').forEach(tag => {
            tag.addEventListener('click', () => this.addSkillToInput(tag.dataset.skill));
        });

        // Needs
        document.getElementById('postNeedBtn').addEventListener('click', () => this.showNeedModal());
        document.getElementById('needForm').addEventListener('submit', (e) => this.postMission(e));

        // Events
        const createEventBtn = document.getElementById('createEventBtn');
        if (createEventBtn) {
            createEventBtn.addEventListener('click', () => this.showEventModal());
        }
        document.getElementById('eventForm').addEventListener('submit', (e) => this.createEvent(e));

        // Projects
        document.getElementById('projectForm').addEventListener('submit', (e) => this.addProject(e));

        // Search and filters
        document.getElementById('memberSearch').addEventListener('input', () => this.filterMembers());
        document.getElementById('skillFilter').addEventListener('change', () => this.filterMembers());

        // Contact
        document.getElementById('contactForm').addEventListener('submit', (e) => this.sendMessage(e));

        // Feedback
        document.getElementById('feedbackForm').addEventListener('submit', (e) => this.submitFeedback(e));

        // Modal controls
        document.querySelectorAll('.close').forEach(close => {
            close.addEventListener('click', (e) => this.closeModal(e.target.closest('.modal')));
        });

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeModal(modal);
            });
        });
        // Check-in
        const toggleStatusBtn = document.getElementById('toggleStatusBtn');
        if (toggleStatusBtn) {
            toggleStatusBtn.addEventListener('click', () => this.toggleUserCheckIn());
        }

        // Home check-in widget button
        const homeToggleStatusBtn = document.getElementById('homeToggleStatusBtn');
        if (homeToggleStatusBtn) {
            homeToggleStatusBtn.addEventListener('click', () => this.toggleUserCheckIn());
        }

        // Check-in filters
        document.querySelectorAll('.checkin-filters .filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setCheckInFilter(e.target.dataset.filter));
        });

        // Membership
        document.querySelectorAll('.tier-select-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.selectMembershipTier(e.target.dataset.tier, e.target.dataset.price));
        });
        const manageMembershipBtn = document.getElementById('manageMembershipBtn');
        if (manageMembershipBtn) {
            manageMembershipBtn.addEventListener('click', () => this.manageMembership());
        }

        // Gallery/Paintings
        const addPaintingBtn = document.getElementById('addPaintingBtn');
        if (addPaintingBtn) {
            addPaintingBtn.addEventListener('click', () => this.showAddPaintingModal());
        }
        const paintingForm = document.getElementById('paintingForm');
        if (paintingForm) {
            paintingForm.addEventListener('submit', (e) => this.addPainting(e));
        }
        const paintingImageFile = document.getElementById('paintingImageFile');
        if (paintingImageFile) {
            paintingImageFile.addEventListener('change', (e) => this.handlePaintingImageSelect(e));
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal.active').forEach(modal => {
                    this.closeModal(modal);
                });
            }
        });
    }

    // ====================================
    // ART GALLERY FUNCTIONS
    // ====================================
    async loadPaintings() {
        try {
            console.log('Loading paintings from database...');

            const { data, error } = await supabase
                .from('paintings')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }

            this.paintings = data || [];
            console.log('✓ Loaded', this.paintings.length, 'paintings');

            // Render if we're on the gallery page
            if (document.getElementById('gallery')?.classList.contains('active')) {
                this.renderPaintings();
            }
        } catch (error) {
            console.error('❌ Load paintings error:', error);
            this.paintings = [];
        }
    }

    renderPaintings() {
        console.log('=== renderPaintings DEBUG ===');
        console.log('Current user:', this.currentUser?.name, 'Status:', this.currentUser?.user_status);
        console.log('Paintings to render:', this.paintings.length);

        const container = document.getElementById('galleryGrid');
        if (!container) {
            console.error('Gallery container not found!');
            return;
        }

        // Show add button for admins
        const addBtn = document.getElementById('addPaintingBtn');
        if (addBtn && this.currentUser?.user_status === 'admin') {
            console.log('✓ Showing add painting button for admin');
            addBtn.style.display = 'block';
        } else if (addBtn) {
            console.log('⨯ Hiding add painting button (not admin)');
            addBtn.style.display = 'none';
        }

        if (!this.paintings || this.paintings.length === 0) {
            console.log('No paintings to display');
            container.innerHTML = '<p class="empty-state">No paintings in the gallery yet. Check back soon!</p>';
            return;
        }

        console.log('Rendering', this.paintings.length, 'paintings...');

        container.innerHTML = this.paintings.map(painting => `
            <div class="painting-card fade-in" style="cursor:pointer;" onclick="app.openPaintingDetail('${painting.id}')">
                <div class="painting-image-container">
                    <img src="${painting.image_url}" alt="${painting.title}">
                    ${!painting.available ? '<div class="painting-sold-overlay">SOLD</div>' : ''}
                </div>
                <div class="painting-info">
                    <div class="painting-header">
                        <h3 class="painting-title">${painting.title}</h3>
                        <p class="painting-artist">by ${painting.artist_name}</p>
                    </div>
                    ${painting.description ? `<p class="painting-description">${painting.description}</p>` : ''}
                    ${painting.artist_credit ? `<div class="painting-credit">${painting.artist_credit}</div>` : ''}
                    <div class="painting-price">
                        <span class="price-currency">$</span>${parseFloat(painting.price).toFixed(2)}
                    </div>
                    <div class="painting-actions">
                        ${painting.available && this.currentUser ?
                            `<button class="btn btn-primary" onclick="event.stopPropagation(); app.openPaintingDetail('${painting.id}')">Purchase</button>` :
                            painting.available ?
                            `<button class="btn btn-outline" onclick="event.stopPropagation(); app.showAlert('Please login to purchase', 'error'); app.showAuthModal();">Login to Purchase</button>` :
                            `<button class="btn btn-outline" disabled>Sold</button>`
                        }
                    </div>
                    ${this.currentUser?.user_status === 'admin' ? `
                        <div class="painting-admin-actions">
                            <button class="btn btn-outline" onclick="event.stopPropagation(); app.editPainting('${painting.id}')">Edit</button>
                            <button class="btn btn-outline" onclick="event.stopPropagation(); app.togglePaintingAvailability('${painting.id}', ${painting.available})">${painting.available ? 'Mark Sold' : 'Mark Available'}</button>
                            <button class="btn btn-outline" onclick="event.stopPropagation(); app.deletePainting('${painting.id}')" style="background: #000; color: #fff;">Delete</button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `).join('');
    }

    showAddPaintingModal() {
        if (!this.currentUser || this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can add paintings', 'error');
            return;
        }

        // Reset submission flag
        this._isSubmittingPainting = false;

        // Reset form
        const form = document.getElementById('paintingForm');
        form.reset();
        document.getElementById('paintingModalTitle').textContent = 'Add Painting';
        document.querySelector('#paintingForm button[type="submit"]').textContent = 'Add Painting';
        document.getElementById('paintingImagePreview').innerHTML = '';
        document.getElementById('paintingImageUploadStatus').textContent = '';
        document.getElementById('paintingImage').value = '';

        // Make file input required for new paintings
        document.getElementById('paintingImageFile').setAttribute('required', 'required');

        // Remove any existing submit handlers and add new one
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        // Re-bind the submit event
        newForm.addEventListener('submit', (e) => this.addPainting(e));

        // Re-bind the file input event
        const fileInput = newForm.querySelector('#paintingImageFile');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => this.handlePaintingImageSelect(e));
        }

        document.getElementById('paintingModal').classList.add('active');
    }

    async handlePaintingImageSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        // Validate file
        if (!file.type.startsWith('image/')) {
            this.showAlert('Please select an image file', 'error');
            e.target.value = '';
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            this.showAlert('Image must be less than 5MB', 'error');
            e.target.value = '';
            return;
        }

        // Show preview immediately
        const reader = new FileReader();
        reader.onload = (event) => {
            const preview = document.getElementById('paintingImagePreview');
            preview.innerHTML = `<img src="${event.target.result}" alt="Preview" style="max-width: 100%; border: 3px solid #000;">`;
        };
        reader.readAsDataURL(file);

        // Auto-upload to Supabase
        const statusEl = document.getElementById('paintingImageUploadStatus');

        try {
            statusEl.textContent = '⏳ Uploading image...';
            statusEl.style.color = '#000';

            const fileExt = file.name.split('.').pop();
            const fileName = `painting-${Date.now()}.${fileExt}`;

            const { data, error } = await supabase.storage
                .from('painting-images')
                .upload(fileName, file, {
                    cacheControl: '3600',
                    upsert: true
                });

            if (error) throw error;

            const { data: { publicUrl } } = supabase.storage
                .from('painting-images')
                .getPublicUrl(fileName);

            // Store URL in hidden field for form submission
            document.getElementById('paintingImage').value = publicUrl;

            statusEl.textContent = '✓ Image uploaded successfully!';
            statusEl.style.color = '#000';

            setTimeout(() => {
                statusEl.textContent = '';
            }, 3000);
        } catch (error) {
            console.error('Upload error:', error);
            statusEl.textContent = '✗ Upload failed: ' + error.message;
            statusEl.style.color = '#f00';
            e.target.value = '';
            document.getElementById('paintingImagePreview').innerHTML = '';
        }
    }


    async addPainting(e) {
        e.preventDefault();

        // Prevent double submission
        if (this._isSubmittingPainting) {
            console.log('Already submitting painting, ignoring duplicate');
            return;
        }

        if (!this.currentUser || this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can add paintings', 'error');
            return;
        }

        // Check if image was uploaded
        const imageUrl = document.getElementById('paintingImage').value;
        if (!imageUrl) {
            this.showAlert('Please wait for image to finish uploading', 'error');
            return;
        }

        this._isSubmittingPainting = true;
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Adding...';
        }

        const paintingData = {
            title: document.getElementById('paintingTitle').value,
            artist_name: document.getElementById('paintingArtist').value,
            artist_credit: document.getElementById('paintingCredit').value || null,
            description: document.getElementById('paintingDescription').value || null,
            price: parseFloat(document.getElementById('paintingPrice').value),
            image_url: imageUrl,
            available: true,
            created_by: this.currentUser.id
        };

        try {
            const { error } = await supabase
                .from('paintings')
                .insert([paintingData]);

            if (error) throw error;

            this.closeModal(document.getElementById('paintingModal'));
            this.showAlert('Painting added successfully!', 'success');

            // Reload paintings and render
            await this.loadPaintings();
            this.renderPaintings();
        } catch (error) {
            console.error('Add painting error:', error);
            this.showAlert('Error adding painting: ' + error.message, 'error');
        } finally {
            this._isSubmittingPainting = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Add Painting';
            }
        }
    }

    editPainting(paintingId) {
        if (!this.currentUser || this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can edit paintings', 'error');
            return;
        }

        const painting = this.paintings.find(p => p.id === paintingId);
        if (!painting) return;

        // Populate form with existing data
        document.getElementById('paintingTitle').value = painting.title;
        document.getElementById('paintingArtist').value = painting.artist_name;
        document.getElementById('paintingCredit').value = painting.artist_credit || '';
        document.getElementById('paintingDescription').value = painting.description || '';
        document.getElementById('paintingPrice').value = painting.price;

        // Store existing image URL in hidden field
        document.getElementById('paintingImage').value = painting.image_url;

        // Show existing image preview
        const preview = document.getElementById('paintingImagePreview');
        preview.innerHTML = `<img src="${painting.image_url}" alt="Current image" style="max-width: 100%; border: 3px solid #000;">`;

        // Make file input optional for editing (keep existing image if no new one selected)
        document.getElementById('paintingImageFile').removeAttribute('required');
        document.getElementById('paintingImageUploadStatus').textContent = '💡 Leave empty to keep current image';

        // Change form submission to update
        document.getElementById('paintingModalTitle').textContent = 'Edit Painting';
        document.querySelector('#paintingForm button[type="submit"]').textContent = 'Update Painting';
        document.getElementById('paintingForm').onsubmit = async (e) => {
            e.preventDefault();
            await this.updatePainting(paintingId);
        };

        document.getElementById('paintingModal').classList.add('active');
    }

    async updatePainting(paintingId) {
        if (!this.currentUser || this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can update paintings', 'error');
            return;
        }

        const paintingData = {
            title: document.getElementById('paintingTitle').value,
            artist_name: document.getElementById('paintingArtist').value,
            artist_credit: document.getElementById('paintingCredit').value || null,
            description: document.getElementById('paintingDescription').value || null,
            price: parseFloat(document.getElementById('paintingPrice').value),
            image_url: document.getElementById('paintingImage').value
        };

        try {
            const { error } = await supabase
                .from('paintings')
                .update(paintingData)
                .eq('id', paintingId);

            if (error) throw error;

            this.closeModal(document.getElementById('paintingModal'));
            this.showAlert('Painting updated successfully!', 'success');
            await this.loadPaintings();
            this.renderPaintings();
        } catch (error) {
            this.showAlert('Error updating painting: ' + error.message, 'error');
        }
    }

    async togglePaintingAvailability(paintingId, currentAvailable) {
        if (!this.currentUser || this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can change availability', 'error');
            return;
        }

        try {
            const { error } = await supabase
                .from('paintings')
                .update({ available: !currentAvailable })
                .eq('id', paintingId);

            if (error) throw error;

            this.showAlert(`Painting marked as ${!currentAvailable ? 'available' : 'sold'}`, 'success');
            await this.loadPaintings();
            this.renderPaintings();
        } catch (error) {
            this.showAlert('Error updating painting: ' + error.message, 'error');
        }
    }

    async deletePainting(paintingId) {
        if (!this.currentUser || this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can delete paintings', 'error');
            return;
        }

        if (!confirm('Are you sure you want to delete this painting? This action cannot be undone!')) {
            return;
        }

        try {
            const { error } = await supabase
                .from('paintings')
                .delete()
                .eq('id', paintingId);

            if (error) throw error;

            this.showAlert('Painting deleted successfully', 'success');
            await this.loadPaintings();
            this.renderPaintings();
        } catch (error) {
            this.showAlert('Error deleting painting: ' + error.message, 'error');
        }
    }

    // ====================================
    // PAINTING DETAIL VIEW
    // ====================================
    openPaintingDetail(paintingId) {
        const painting = this.paintings.find(p => p.id === paintingId);
        if (!painting) return;

        this._detailPaintingId = paintingId;

        document.getElementById('paintingDetailImage').src = painting.image_url;
        document.getElementById('paintingDetailImage').alt = painting.title;
        document.getElementById('paintingDetailTitle').textContent = painting.title;
        document.getElementById('paintingDetailArtist').textContent = 'by ' + painting.artist_name;
        document.getElementById('paintingDetailDescription').textContent = painting.description || '';

        const creditEl = document.getElementById('paintingDetailCredit');
        if (painting.artist_credit) {
            creditEl.textContent = painting.artist_credit;
            creditEl.style.display = 'block';
        } else {
            creditEl.style.display = 'none';
        }

        document.getElementById('paintingDetailPrice').innerHTML = '<span class="price-currency">$</span>' + parseFloat(painting.price).toFixed(2);

        const overlay = document.getElementById('paintingDetailSoldOverlay');
        overlay.style.display = painting.available ? 'none' : 'flex';

        // Build action buttons
        const actionsEl = document.getElementById('paintingDetailActions');
        actionsEl.innerHTML = '';

        if (painting.available && this.currentUser) {
            // PayPal container
            const paypalDiv = document.createElement('div');
            paypalDiv.id = 'paypal-detail-btn';
            paypalDiv.className = 'paypal-button-container';
            actionsEl.appendChild(paypalDiv);

            // Render PayPal button after modal is visible
            setTimeout(() => this.renderPayPalButton('paypal-detail-btn', painting), 100);
        } else if (painting.available) {
            const loginBtn = document.createElement('button');
            loginBtn.className = 'btn btn-outline';
            loginBtn.textContent = 'Login to Purchase';
            loginBtn.onclick = () => { this.showAlert('Please login to purchase', 'error'); this.showAuthModal(); };
            actionsEl.appendChild(loginBtn);
        } else {
            const soldBtn = document.createElement('button');
            soldBtn.className = 'btn btn-outline';
            soldBtn.textContent = 'Sold';
            soldBtn.disabled = true;
            actionsEl.appendChild(soldBtn);
        }

        document.getElementById('paintingDetailModal').classList.add('active');
    }

    closePaintingDetail() {
        this.closeModal(document.getElementById('paintingDetailModal'));
    }

    // ====================================
    // PAYPAL PAYMENT
    // ====================================
    renderPayPalButton(containerId, painting) {
        const container = document.getElementById(containerId);
        if (!container || !window.paypal) return;
        container.innerHTML = '';

        window.paypal.Buttons({
            style: {
                layout: 'horizontal',
                color: 'black',
                shape: 'rect',
                label: 'pay',
                height: 45
            },
            createOrder: (data, actions) => {
                return actions.order.create({
                    purchase_units: [{
                        description: painting.title + ' by ' + painting.artist_name,
                        amount: {
                            value: parseFloat(painting.price).toFixed(2)
                        }
                    }]
                });
            },
            onApprove: async (data, actions) => {
                const order = await actions.order.capture();
                console.log('PayPal payment captured:', order);
                await this.handlePaintingPurchaseSuccess(painting.id);
                this.closePaintingDetail();
            },
            onError: (err) => {
                console.error('PayPal error:', err);
                this.showAlert('PayPal payment failed. Please try again.', 'error');
            }
        }).render('#' + containerId);
    }

    async purchasePainting(paintingId) {
        // Open the detail view which has payment options
        this.openPaintingDetail(paintingId);
    }

    async handlePaintingPurchaseSuccess(paintingId) {
        try {
            // Record the purchase
            const painting = this.paintings.find(p => p.id === paintingId);
            if (!painting) {
                console.error('Painting not found:', paintingId);
                return;
            }

            // Mark painting as sold
            const { error: updateError } = await supabase
                .from('paintings')
                .update({ available: false })
                .eq('id', paintingId);

            if (updateError) throw updateError;

            this.showAlert(`Thank you for purchasing "${painting.title}"! The artist will be in touch with you soon.`, 'success');
            this.showSection('gallery');
            await this.loadPaintings();
            this.renderPaintings();
        } catch (error) {
            console.error('Error handling purchase success:', error);
            this.showAlert('Purchase successful, but there was an error updating the gallery. Please contact support.', 'error');
        }
    }
}

// ====================================
// INITIALIZATION
// ====================================
let app;

document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== DOM Content Loaded ===');
    console.log('Starting DōM Collective...');
    
    // Check if Supabase loaded
    if (typeof window.supabase === 'undefined') {
        console.error('ERROR: Supabase library not loaded!');
        alert('Failed to load Supabase. Check your internet connection and try refreshing.');
        return;
    }
    console.log('✓ Supabase library loaded');
    console.log('✓ Supabase connection ready');
    
    // Initialize app
    try {
        console.log('Creating CreativeCollective instance...');
        app = new CreativeCollective();
        window.app = app;
        console.log('✓ Instance created');
        
        // Now initialize
        console.log('Calling init()...');
        await app.init();
        console.log('✓ Init completed');
        
        // Expose for debugging
        window.supabase = supabase;
        console.log('✓ Setup complete');
    } catch (error) {
        console.error('=== INITIALIZATION FAILED ===');
        console.error('Error:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        alert('Failed to initialize app: ' + error.message + '\n\nCheck the console for details.');
    }
});