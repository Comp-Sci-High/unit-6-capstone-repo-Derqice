require('dotenv').config();
// ─────────────────────────────────────────────────────────────────────────────
//  app.js  ·  The Dial · CompSciHigh Language Simplification Tool
//  Stack:  Node.js · Express · EJS · Tailwind CSS (CDN)
// ─────────────────────────────────────────────────────────────────────────────
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI();
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); // free tier
const express        = require('express');
const path           = require('path');
const expressLayouts = require('express-ejs-layouts');
const session        = require('express-session');
const morgan         = require('morgan');
const mongoose        = require('mongoose');
const app  = express();
const LEVEL_PROMPTS = {
  A1: 'Rewrite this text for a complete beginner (CEFR A1). Use only the most basic and common vocabulary. Write very short, simple sentences. Avoid all jargon and complex grammar.',
  A2: 'Rewrite this text for an elementary reader (CEFR A2). Use simple vocabulary and short sentences. Explain any technical or complex terms in plain words.',
  B1: 'Rewrite this text for an intermediate reader (CEFR B1). Use clear language and moderate vocabulary. You can keep some technical terms but briefly explain them.',
  B2: 'Rewrite this text for an upper-intermediate reader (CEFR B2). Keep most of the original vocabulary but improve clarity and flow where needed.',
};

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
  const { content, level, language, save_to_library } = req.body; // ← add language

  const isURL = content.startsWith('http://') || content.startsWith('https://');

  try {
  const prompt = `You are a language simplification and translation assistant for high school students.
Your job is to rewrite and translate content at the requested CEFR level IN THE REQUESTED LANGUAGE.
The vocab words and definitions in your response must also be written in the requested output language.
Always respond with a JSON object in this exact format:
{
  "title": "A short title for the article in the output language",
  "simplified": "The full rewritten and translated text as plain paragraphs",
  "vocab": [
    { "word": "difficultword", "definition": "simple definition in the output language" }
  ]
}
Return ONLY the JSON. No markdown, no backticks, no extra text.

${LEVEL_PROMPTS[level] || LEVEL_PROMPTS['B1']}
OUTPUT LANGUAGE: ${language || 'English'}. Write the entire response in ${language || 'English'}.

${isURL ? `The content is from this URL: ${content}` : `Here is the text to simplify:\n\n${content}`}`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text().trim();

  // Strip markdown code fences if Gemini adds them anyway
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(cleaned);

  res.render('result', {
    title:     parsed.title || 'Simplified Article',
    simplified: parsed.simplified,
    vocab:      parsed.vocab || [],
    level,
    language:   language || 'English',
    original:   content,
  });

} catch (err) {
  console.error('Gemini error:', err.message);
  res.render('result', {
    title:      'Error',
    simplified: 'Something went wrong. Please try again.',
    vocab:      [],
    level,
    language:   language || 'English',
    original:   content,
  });
}

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
<<<<<<< HEAD
  await mongoose.connect();
=======
  await mongoose.connect();
>>>>>>> 6696de4 (fixed simplify route debugged and changed the ai from using openai api to google gemini api)
  app.listen(3000, () => {
    console.log(`\n🐍  The Dial is running  →  http://localhost:3000\n`);
  });
}
startServer();
module.exports = app;