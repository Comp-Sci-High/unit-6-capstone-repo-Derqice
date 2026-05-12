require('dotenv').config();
// ─────────────────────────────────────────────────────────────────────────────
//  app.js  ·  The Dial · CompSciHigh Language Simplification Tool
//  Stack:  Node.js · Express · EJS · Tailwind CSS (CDN)
// ─────────────────────────────────────────────────────────────────────────────

const express        = require('express');
const path           = require('path');
const expressLayouts = require('express-ejs-layouts');
const session        = require('express-session');
const morgan         = require('morgan');
const mongoose        = require('mongoose');
const app  = express();

// ── View Engine ────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');           // default wrapper: views/layout.ejs
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret:             || 'dial-dev-secret-change-me',
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure:  === 'production' },
}));

// ── Global locals (available in every EJS template) ────────────────────────
app.use((req, res, next) => {
  res.locals.user        = req.session.user || null;
  res.locals.currentPath = req.path;
  next();
});

// ── Simple auth guard ──────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login');
}

function requireTeacher(req, res, next) {
  if (req.session.user?.role === 'teacher') return next();
  res.status(403).render('error', { title: 'Access Denied', message: 'Teacher accounts only.' });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── Home / Landing ─────────────────────────────────────────────────────────
// Public landing page — no auth required
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard'); // skip landing if logged in
  res.render('home', { title: 'Welcome' });
});
 
// The actual simplify tool — auth required
app.get('/app', requireAuth, (req, res) => {
  res.render('index', { title: 'Home' });
});

// ── Auth ───────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Sign In', layout: 'layout' });
});

// Local login (demo – replace with real auth / Passport.js)
app.post('/auth/login', (req, res) => {
  const { email, role } = req.body;

  // Temporary: accept any email, use the role dropdown to switch views
  req.session.user = {
    name:  email.split('@')[0] || 'Test User',
    email: email || 'test@compscihigh.org',
    role:  role  || 'student',
    level: 'B1',
  };
  res.redirect('/dashboard');
});

// Google OAuth redirect (wire up Passport.js + passport-google-oauth20)
app.get('/auth/google', (req, res) => {
  // TODO: passport.authenticate('google', { scope: ['profile', 'email'] })
  res.redirect('/login?notice=google_oauth_not_configured');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});
// ── Signup ───────────────────────────────────────────────────────────────────

app.get('/signup', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('signup', { title: 'Create Account' });
});
 
app.post('/auth/signup', async (req, res) => {
  const { firstName, lastName, email, password, confirmPassword, role, level } = req.body;
 
  // Basic server-side validation
  if (!email.endsWith('@compscihigh.org')) {
    return res.render('signup', { title: 'Create Account', error: 'You must use a @compscihigh.org email address.' });
  }
  if (password !== confirmPassword) {
    return res.render('signup', { title: 'Create Account', error: 'Passwords do not match.' });
  }
  if (password.length < 8) {
    return res.render('signup', { title: 'Create Account', error: 'Password must be at least 8 characters.' });
  }
 
  // TODO: Check if email already exists in DB
  // const existing = await User.findOne({ email });
  // if (existing) return res.render('signup', { title: 'Create Account', error: 'An account with that email already exists.' });
 
  // TODO: Hash password and save user
  // const hashed = await bcrypt.hash(password, 12);
  // const user = await User.create({ firstName, lastName, email, password: hashed, role, level: role === 'student' ? level : null });
 
  // Stub: log them straight in after signup
  req.session.user = {
    name:  `${firstName} ${lastName}`,
    email,
    role:  role || 'student',
    level: role === 'student' ? (level || 'B1') : null,
  };
 
  res.redirect('/dashboard');
});
 
// ── Simplify (core feature) ────────────────────────────────────────────────
app.post('/simplify', requireAuth, async (req, res) => {
  const { content, level, save_to_library } = req.body;
  // TODO: call your LLM / simplification service here
  // const simplified = await simplifyService.run(content, level);
  // if (save_to_library) await Library.save(req.session.user.id, simplified);
  res.render('result', {
    title:   'Simplified Article',
    content,
    level,
    simplified: '<!-- TODO: insert LLM response here -->',
  });
});

// ── Student Dashboard ──────────────────────────────────────────────────────
app.get('/dashboard', requireAuth, async (req, res) => {
  const user = req.session.user;
  if (user.role === 'teacher') return res.redirect('/teacher/dashboard');

  // TODO: fetch real data from DB
  // const articles = await Library.findByUser(user.id);
  // const vocab    = await VocabBank.findByUser(user.id);
  res.render('student-dashboard', { title: 'My Dashboard' });
});

app.post('/library/remove', requireAuth, (req, res) => {
  const { id } = req.body;
  // TODO: await Library.remove(req.session.user.id, id);
  res.json({ success: true });
});

app.post('/vocab/remove', requireAuth, (req, res) => {
  const { word } = req.body;
  // TODO: await VocabBank.remove(req.session.user.id, word);
  res.json({ success: true });
});

// ── Teacher Dashboard ──────────────────────────────────────────────────────
app.get('/teacher/dashboard', requireAuth, requireTeacher, async (req, res) => {
  // TODO: const stats   = await Analytics.classStats(req.session.user.classId);
  // TODO: const words   = await Analytics.struggleWords(req.session.user.classId);
  // TODO: const activity = await Analytics.weeklyActivity(req.session.user.classId);
  res.render('teacher-dashboard', { title: 'Teacher Dashboard' });
});

app.post('/teacher/assign', requireAuth, requireTeacher, async (req, res) => {
  const { url, level, dueDate, note, notify } = req.body;
  // TODO: await Assignment.create({ teacherId: req.session.user.id, url, level, dueDate, note, notify });
  // TODO: if (notify) await Mailer.notifyClass(req.session.user.classId, url, note);
  req.session.flash = 'Assignment sent to class!';
  res.redirect('/teacher/dashboard');
});

// ── 404 catch-all ──────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', { title: '404 Not Found', message: "Look Somewhere Else" });
});


// ── 500 error handler ───────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { title: 'Server Error', message: 'Let me just fix that for you' });
});

// ── Start ──────────────────────────────────────────────────────────────────
async function startServer() {
  await mongoose.connect();
  app.listen(3000, () => {
    console.log(`\n🐍  The Dial is running  →  http://localhost:3000\n`);
  });
}
startServer();
module.exports = app;