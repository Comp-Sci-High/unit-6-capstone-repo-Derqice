require('dotenv').config();
const express        = require('express');
const path           = require('path');
const expressLayouts = require('express-ejs-layouts');
const session        = require('express-session');
const morgan         = require('morgan');
const mongoose       = require('mongoose');
const bcrypt         = require('bcrypt');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { User, Article, Vocab, Class, Assignment, WordClick } = require('./models');

const app   = express();
const genAI = new GoogleGenerativeAI();
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
const LEVEL_PROMPTS = {
  A1: 'Rewrite this text for a complete beginner (CEFR A1). Use only the most basic and common vocabulary. Write very short, simple sentences. Avoid all jargon and complex grammar.',
  A2: 'Rewrite this text for an elementary reader (CEFR A2). Use simple vocabulary and short sentences. Explain any technical or complex terms in plain words.',
  B1: 'Rewrite this text for an intermediate reader (CEFR B1). Use clear language and moderate vocabulary. You can keep some technical terms but briefly explain them.',
  B2: 'Rewrite this text for an upper-intermediate reader (CEFR B2). Keep most of the original vocabulary but improve clarity and flow where needed.',
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret:  || 'dial-dev-secret',
  resave: false, saveUninitialized: false,
  cookie: { secure:  === 'production' },
}));


app.use((req, res, next) => {
  res.locals.user        = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.flash       = req.session.flash || null; 
  delete req.session.flash;      
  next();
});

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login');
}
function requireTeacher(req, res, next) {
  if (req.session.user?.role === 'teacher') return next();
  res.status(403).render('error', { title: 'Access Denied', message: 'Teacher accounts only.', statusCode: 403 });
}

// ── Public ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard'); // ← was /library
  res.render('home', { title: 'Welcome' });
});
app.get('/about',   (req, res) => res.render('about',   { title: 'About' }));
app.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy Policy' }));
app.get('/help',    (req, res) => res.render('help',    { title: 'Help' }));
// ── Settings ──────────────────────────────────────────────────────────────
// ── Settings routes — paste these into app.js replacing ALL existing /settings/* routes ──

app.get('/settings', requireAuth, async (req, res) => {
  try {
    const dbUser = req.session.user.id
      ? await User.findById(req.session.user.id)
      : null;
    const flash = req.session.flash || null;
    delete req.session.flash;
    res.render('settings', { title: 'Settings', dbUser, flash });
  } catch (err) {
    res.render('settings', { title: 'Settings', dbUser: null, flash: null });
  }
});

app.post('/settings/profile', requireAuth, async (req, res) => {
  const { firstName, lastName, email } = req.body;
  if (!email.endsWith('@compscihigh.org')) {
    req.session.flash = { type: 'error', msg: 'Must use a @compscihigh.org email.' };
    return res.redirect('/settings');
  }
  try {
    if (req.session.user.id) {
      await User.findByIdAndUpdate(req.session.user.id, {
        firstName, lastName, email: email.toLowerCase(),
      });
    }
    req.session.user.name      = `${firstName} ${lastName}`;
    req.session.user.firstName = firstName;
    req.session.user.lastName  = lastName;
    req.session.user.email     = email.toLowerCase();
    req.session.flash = { type: 'success', msg: 'Profile updated successfully.' };
    res.redirect('/settings');
  } catch (err) {
    console.error(err);
    req.session.flash = { type: 'error', msg: 'Something went wrong. Try again.' };
    res.redirect('/settings');
  }
});

app.post('/settings/reading', requireAuth, async (req, res) => {
  const { level, language, autoSave, autoVocab } = req.body;
  try {
    if (req.session.user.id) {
      await User.findByIdAndUpdate(req.session.user.id, {
        level,
        defaultLanguage: language || 'English',
        autoSave:        autoSave  === '1',
        autoVocab:       autoVocab === '1',
      });
    }
    req.session.user.level           = level;
    req.session.user.defaultLanguage = language || 'English';
    req.session.flash = { type: 'success', msg: 'Reading preferences saved.' };
    res.redirect('/settings');
  } catch (err) {
    console.error(err);
    req.session.flash = { type: 'error', msg: 'Something went wrong. Try again.' };
    res.redirect('/settings');
  }
});

app.post('/settings/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    req.session.flash = { type: 'error', msg: 'New password must be at least 8 characters.' };
    return res.redirect('/settings');
  }
  if (newPassword !== confirmPassword) {
    req.session.flash = { type: 'error', msg: 'Passwords do not match.' };
    return res.redirect('/settings');
  }
  try {
    const dbUser = await User.findById(req.session.user.id);
    if (!dbUser?.password) {
      req.session.flash = { type: 'error', msg: 'No password set. Try signing in with Google.' };
      return res.redirect('/settings');
    }
    const match = await bcrypt.compare(currentPassword, dbUser.password);
    if (!match) {
      req.session.flash = { type: 'error', msg: 'Current password is incorrect.' };
      return res.redirect('/settings');
    }
    const hashed = await bcrypt.hash(newPassword, 12);
    await User.findByIdAndUpdate(req.session.user.id, { password: hashed });
    req.session.flash = { type: 'success', msg: 'Password changed successfully.' };
    res.redirect('/settings');
  } catch (err) {
    console.error(err);
    req.session.flash = { type: 'error', msg: 'Something went wrong. Try again.' };
    res.redirect('/settings');
  }
});

app.post('/settings/notifications', requireAuth, async (req, res) => {
  try {
    const prefs = {
      assignment: req.body.notifAssignment === '1',
      streak:     req.body.notifStreak     === '1',
      vocab:      req.body.notifVocab      === '1',
      level:      req.body.notifLevel      === '1',
      email:      req.body.notifEmail      === '1',
    };
    if (req.session.user.id) {
      await User.findByIdAndUpdate(req.session.user.id, { notifPrefs: prefs });
    }
    req.session.flash = { type: 'success', msg: 'Notification preferences saved.' };
    res.redirect('/settings');
  } catch (err) {
    req.session.flash = { type: 'error', msg: 'Something went wrong. Try again.' };
    res.redirect('/settings');
  }
});

app.post('/settings/clear-vocab', requireAuth, async (req, res) => {
  try {
    await Vocab.deleteMany({ user: req.session.user.id });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

app.post('/settings/clear-library', requireAuth, async (req, res) => {
  try {
    await Article.deleteMany({ user: req.session.user.id });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

app.post('/settings/delete-account', requireAuth, async (req, res) => {
  try {
    const id = req.session.user.id;
    await User.findByIdAndDelete(id);
    await Article.deleteMany({ user: id });
    await Vocab.deleteMany({ user: id });
    await Class.updateMany({}, { $pull: { students: id } });
    req.session.destroy(() => res.json({ success: true }));
  } catch (err) {
    res.json({ success: false });
  }
});
// ── Auth ──────────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/library');
  res.render('login', { title: 'Sign In', error: null });
});

app.post('/auth/login', async (req, res) => {
  const { email, password, role } = req.body;
  try {
    const dbUser = await User.findOne({ email: email.toLowerCase() });
    if (dbUser) {
      const match = await bcrypt.compare(password, dbUser.password);
      if (!match) return res.render('login', { title: 'Sign In', error: 'Incorrect email or password.' });
      req.session.user = { id: dbUser._id, name: `${dbUser.firstName} ${dbUser.lastName}`, email: dbUser.email, role: dbUser.role, level: dbUser.level };
      return res.redirect('/library');
    }
    // Temp stub — remove once DB is populated
    req.session.user = { name: email.split('@')[0], email, role: role || 'student', level: 'B1' };
    res.redirect('/library');
  } catch (err) {
    console.error(err);
    res.render('login', { title: 'Sign In', error: 'Something went wrong. Try again.' });
  }
});

app.get('/signup', (req, res) => {
  if (req.session.user) return res.redirect('/library');
  res.render('signup', { title: 'Create Account', error: null });
});

app.post('/auth/signup', async (req, res) => {
  const { firstName, lastName, email, password, confirmPassword, role, level } = req.body;
  if (!email.endsWith('@compscihigh.org'))
    return res.render('signup', { title: 'Create Account', error: 'Must use a @compscihigh.org email.' });
  if (password !== confirmPassword)
    return res.render('signup', { title: 'Create Account', error: 'Passwords do not match.' });
  if (password.length < 8)
    return res.render('signup', { title: 'Create Account', error: 'Password must be at least 8 characters.' });
  try {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing)
      return res.render('signup', { title: 'Create Account', error: 'An account with that email already exists.' });
    const hashed = await bcrypt.hash(password, 12);
    const newUser = await User.create({ firstName, lastName, email: email.toLowerCase(), password: hashed, role: role || 'student', level: level || 'B1' });
    req.session.user = { id: newUser._id, name: `${firstName} ${lastName}`, email: newUser.email, role: newUser.role, level: newUser.level };
    res.redirect('/library');
  } catch (err) {
    console.error(err);
    res.render('signup', { title: 'Create Account', error: 'Something went wrong. Try again.' });
  }
});

app.get('/auth/google', (req, res) => res.redirect('/login?notice=google_oauth_not_configured'));
app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ── Library (main home) ───────────────────────────────────────────────────────
// My Library nav link → full article search page
app.get('/library', requireAuth, async (req, res) => {
  try {
    const readingList = req.session.user.id
      ? await Article.find({ user: req.session.user.id }).sort({ createdAt: -1 })
      : [];
    res.render('library', { title: 'My Library', readingList });
  } catch (err) {
    res.render('library', { title: 'My Library', readingList: [] });
  }
});

app.post('/library/save', requireAuth, async (req, res) => {
  const { title, content, simplified, level, language } = req.body;
  try {
    await Article.create({
      user: req.session.user.id, title,
      source: content?.startsWith('http') ? content : 'Pasted text',
      originalText: content, simplified, level, language: language || 'English',
    });
    res.redirect('/library');
  } catch (err) { res.redirect('/library'); }
});

app.post('/library/remove', requireAuth, async (req, res) => {
  try {
    await Article.deleteOne({ _id: req.body.id, user: req.session.user.id });
    res.json({ success: true });
  } catch (err) { res.json({ success: false }); }
});

app.post('/library/progress', requireAuth, async (req, res) => {
  const { id, progress } = req.body;
  try {
    await Article.findOneAndUpdate({ _id: id, user: req.session.user.id }, { progress, isComplete: progress >= 100 });
    res.json({ success: true });
  } catch (err) { res.json({ success: false }); }
});

// ── Simplify ──────────────────────────────────────────────────────────────────
app.get('/app', requireAuth, (req, res) => res.render('index', { title: 'Simplify' }));

app.post('/simplify', requireAuth, async (req, res) => {
  const { content, level, language, save_to_library } = req.body;
  const isURL = content.startsWith('http://') || content.startsWith('https://');
  try {
    const prompt = `You are a language simplification and translation assistant for high school students.
Your job is to rewrite and translate content at the requested CEFR level IN THE REQUESTED LANGUAGE.
Always respond with ONLY a JSON object in this exact format (no markdown, no backticks):
{"title":"...","simplified":"...","vocab":[{"word":"...","definition":"..."}]}

${LEVEL_PROMPTS[level] || LEVEL_PROMPTS['B1']}
OUTPUT LANGUAGE: ${language || 'English'}.
${isURL ? `URL: ${content}` : `TEXT:\n\n${content}`}`;

    const result  = await model.generateContent(prompt);
    const raw     = result.response.text().trim().replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```$/i,'').trim();
    const parsed  = JSON.parse(raw);

    let articleId = null;
    if (save_to_library && req.session.user.id) {
      const saved = await Article.create({
        user: req.session.user.id, title: parsed.title,
        source: isURL ? content : 'Pasted text',
        originalText: content, simplified: parsed.simplified, level, language: language || 'English',
      });
      articleId = saved._id;
      if (parsed.vocab?.length) {
        for (const v of parsed.vocab) {
          await Vocab.findOneAndUpdate(
            { user: req.session.user.id, word: v.word },
            { $set: { definition: v.definition, language: language || 'English', level, article: articleId }, $inc: { clickCount: 1 } },
            { upsert: true }
          );
        }
      }
    }

    res.render('result', { title: parsed.title || 'Simplified Article', simplified: parsed.simplified, vocab: parsed.vocab || [], level, language: language || 'English', original: content, articleId });
  } catch (err) {
    console.error('Gemini error:', err.message);
    res.render('result', { title: 'Error', simplified: 'Something went wrong. Please try again.', vocab: [], level, language: language || 'English', original: content, articleId: null });
  }
});

// ── Dashboards ────────────────────────────────────────────────────────────────
// Logo link → student dashboard (their "home base")
app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const readingList = req.session.user.id
      ? await Article.find({ user: req.session.user.id }).sort({ createdAt: -1 }).limit(10)
      : [];
    const vocabBank = req.session.user.id
      ? await Vocab.find({ user: req.session.user.id }).sort({ createdAt: -1 })
      : [];
    res.render('student-dashboard', { title: 'Dashboard', readingList, vocabBank });
  } catch (err) {
    res.render('student-dashboard', { title: 'Dashboard', readingList: [], vocabBank: [] });
  }
});

app.get('/teacher/dashboard', requireAuth, requireTeacher, async (req, res) => {
  try {
    const myClasses     = req.session.user.id ? await Class.find({ teacher: req.session.user.id }) : [];
    const classIds      = myClasses.map(c => c._id);
    const studentIds    = myClasses.flatMap(c => c.students);
    const struggleWords = await WordClick.aggregate([
      { $match: { class: { $in: classIds } } },
      { $group: { _id: '$word', clicks: { $sum: 1 } } },
      { $sort: { clicks: -1 } }, { $limit: 10 },
      { $project: { word: '$_id', clicks: 1, _id: 0 } },
    ]);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const activityRaw  = await Article.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo }, user: { $in: studentIds } } },
      { $group: { _id: { $dayOfWeek: '$createdAt' }, count: { $sum: 1 } } },
    ]);
    const days     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const activity = days.map((day, i) => ({ day, count: activityRaw.find(a => a._id === i + 1)?.count || 0 }));
    res.render('teacher-dashboard', {
      title: 'Teacher Dashboard',
      stats: { totalStudents: studentIds.length, activeToday: 0, avgLevel: 'B1', articlesThisWeek: activityRaw.reduce((n, a) => n + a.count, 0) },
      words: struggleWords, activity,
    });
  } catch (err) {
    console.error(err);
    res.render('teacher-dashboard', { title: 'Teacher Dashboard', stats: {}, words: [], activity: [] });
  }
});
// ── All Students page ─────────────────────────────────────────────────────
app.get('/teacher/students', requireAuth, requireTeacher, async (req, res) => {
  try {
    const myClasses = await Class.find({ teacher: req.session.user.id });
    const classList = myClasses.map(c => c.name);

    // Get all unique student IDs across all classes
    const studentIds = [...new Set(myClasses.flatMap(c => c.students.map(s => s.toString())))];

    // Fetch students and annotate with their class name + article/vocab counts
    const users = await User.find({ _id: { $in: studentIds } });

    const studentList = await Promise.all(users.map(async s => {
      const enrolledClass = myClasses.find(c => c.students.map(id => id.toString()).includes(s._id.toString()));
      const articleCount  = await Article.countDocuments({ user: s._id });
      const vocabCount    = await Vocab.countDocuments({ user: s._id });
      return {
        _id:           s._id,
        firstName:     s.firstName,
        lastName:      s.lastName,
        email:         s.email,
        level:         s.level,
        streak:        s.streak,
        lastActive:    s.lastActive,
        articleCount,
        vocabCount,
        enrolledClass: enrolledClass?.name || 'Unknown',
      };
    }));

    res.render('all-students', { title: 'All Students', studentList, classList });
  } catch (err) {
    console.error(err);
    res.render('all-students', { title: 'All Students', studentList: [], classList: [] });
  }
});

// Remove a student from class
app.post('/teacher/students/remove', requireAuth, requireTeacher, async (req, res) => {
  const { studentId } = req.body;
  try {
    await Class.updateMany({ teacher: req.session.user.id }, { $pull: { students: studentId } });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// Assign article to individual student
app.post('/teacher/assign-student', requireAuth, requireTeacher, async (req, res) => {
  const { studentId, url, level, dueDate } = req.body;
  try {
    // TODO: trigger simplification and save to student's library
    // const simplified = await simplify(url, level);
    // await Article.create({ user: studentId, assignedBy: req.session.user.id, ... });
    res.redirect('/teacher/students');
  } catch (err) {
    res.redirect('/teacher/students');
  }
});
// ── Vocab ─────────────────────────────────────────────────────────────────────
app.post('/vocab/remove', requireAuth, async (req, res) => {
  try { await Vocab.deleteOne({ user: req.session.user.id, word: req.body.word }); res.json({ success: true }); }
  catch (err) { res.json({ success: false }); }
});

app.post('/vocab/click', requireAuth, async (req, res) => {
  const { word, articleId, classId } = req.body;
  try {
    await Vocab.findOneAndUpdate({ user: req.session.user.id, word }, { $inc: { clickCount: 1 } });
    await WordClick.create({ student: req.session.user.id, word: word.toLowerCase(), article: articleId || null, class: classId || null });
    res.json({ success: true });
  } catch (err) { res.json({ success: false }); }
});

// ── Enrollment ────────────────────────────────────────────────────────────────
app.get('/enroll', requireAuth, async (req, res) => {
  try {
    const enrolledClasses  = req.session.user.id ? await Class.find({ students: req.session.user.id }).populate('teacher','firstName lastName') : [];
    const enrolledIds      = enrolledClasses.map(c => c._id.toString());
    const availableClasses = await Class.find({ isActive: true, _id: { $nin: enrolledIds } }).populate('teacher','firstName lastName');
    res.render('enroll', { title: 'Enroll in a Class', enrolledClasses, availableClasses });
  } catch (err) { res.render('enroll', { title: 'Enroll in a Class', enrolledClasses: [], availableClasses: [] }); }
});

app.post('/enroll/code', requireAuth, async (req, res) => {
  try {
    const cls = await Class.findOne({ code: req.body.code.toUpperCase() });
    if (!cls) return res.redirect('/enroll?error=invalid_code');
    await Class.findByIdAndUpdate(cls._id, { $addToSet: { students: req.session.user.id } });
    res.redirect('/library');
  } catch (err) { res.redirect('/enroll'); }
});

app.post('/enroll/join',  requireAuth, async (req, res) => {
  try { await Class.findByIdAndUpdate(req.body.classId, { $addToSet: { students: req.session.user.id } }); res.redirect('/library'); }
  catch (err) { res.redirect('/enroll'); }
});

app.post('/enroll/leave', requireAuth, async (req, res) => {
  try { await Class.findByIdAndUpdate(req.body.classId, { $pull: { students: req.session.user.id } }); res.redirect('/enroll'); }
  catch (err) { res.redirect('/enroll'); }
});

app.post('/teacher/assign', requireAuth, requireTeacher, async (req, res) => {
  const { url, level, dueDate, note, notify, classId } = req.body;
  try {
    await Assignment.create({ teacher: req.session.user.id, class: classId, url, level, note, dueDate: dueDate || null, notify: !!notify });
    res.redirect('/teacher/dashboard');
  } catch (err) { res.redirect('/teacher/dashboard'); }
});

app.post('/teacher/enroll', requireAuth, requireTeacher, async (req, res) => {
  const { studentEmail, classId } = req.body;
  try {
    const student = await User.findOne({ email: studentEmail.toLowerCase() });
    if (!student) return res.redirect('/teacher/dashboard?error=student_not_found');
    await Class.findByIdAndUpdate(classId, { $addToSet: { students: student._id } });
    res.redirect('/teacher/dashboard');
  } catch (err) { res.redirect('/teacher/dashboard'); }
});

// ── Error handlers ────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).render('error', { title: '404 Not Found', message: 'Look Somewhere Else', statusCode: 404 }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { title: 'Server Error', message: 'Let me just fix that for you', statusCode: 500 });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function startServer() {
  await mongoose.connect();
  console.log('🍃 MongoDB connected');
  app.listen(3001, () => console.log('\n🐍  The Dial is running  →  http://localhost:3001\n'));
}
startServer();
module.exports = app;
//add a practice page
// add a home page for the students where they can see all there articles and even search for them which would ofc translate over to the teachers make sure the dial logo connects to this page
//fix the search word feater in the struggle words box of the student page
//make it so teachers can use the app just like a student can just with that extra ability to assign work to their class and see analytics on how their students are doing