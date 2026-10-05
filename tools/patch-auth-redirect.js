/* One-off patcher for auth.html (this repo uses CRLF line endings, and the
   inline <script> body carries no indentation, so the blocks below are copied
   verbatim and the line breaks are spelled as \r\n explicitly). */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'auth.html');

let src = fs.readFileSync(FILE, 'utf8');
const NL = '\r\n';
const before = src;

function replace(what, oldText, newText) {
  const oldS = oldText.split('\n').join(NL);
  const newS = newText.split('\n').join(NL);
  if (src.indexOf(oldS) === -1) {
    console.log('MISS  ' + what);
    process.exitCode = 1;
    return;
  }
  if (src.indexOf(oldS) !== src.lastIndexOf(oldS)) {
    console.log('DUP   ' + what);
    process.exitCode = 1;
    return;
  }
  src = src.replace(oldS, newS);
  console.log('OK    ' + what);
}

replace(
  'signed-in detection + goHome() redirect helper',
  [
    "function email(){ return ($('auth-email').value || '').trim(); }",
    'async function showUser(){',
    'try {',
    'var u = await window.sbAuth.currentUser();',
    "if (u) { status('Signed in as ' + (u.email || u.id), true); $('btn-logout').classList.remove('hidden'); }",
    '} catch(e){}',
    '}',
  ].join('\n'),
  [
    "function email(){ return ($('auth-email').value || '').trim(); }",
    '/* A volunteer only counts as signed in with a real account. Anonymous',
    '   sessions are created silently for forum posting (sbEnsureAuth), and those',
    '   visitors still need this page, so is_anonymous must not redirect home. */',
    'function isSignedIn(u){ return !!u && !u.is_anonymous; }',
    '/* Every successful sign-in ends on the map. location.replace() rather than a',
    '   plain href assignment, so the browser Back button skips auth.html instead of',
    '   bouncing the volunteer back to a form they already completed. */',
    'var leaving = false;',
    'function goHome(delay){',
    '  if (leaving) return;',
    '  leaving = true;',
    "  setTimeout(function(){ window.location.replace('index.html'); }, delay || 0);",
    '}',
    '/* The magic link and the Google button both return to this same page with the',
    '   session in the URL. Supabase consumes it and fires onAuthStateChange, and that',
    '   is what finally sends the volunteer home. */',
    'function watchSession(){',
    '  try { window.sbAuth.onChange(function(u){ if (isSignedIn(u)) goHome(); }); }',
    '  catch(e){}',
    '}',
    'async function showUser(){',
    'try {',
    'var u = await window.sbAuth.currentUser();',
    'if (isSignedIn(u)) {',
    "  status('Signed in as ' + (u.email || u.id), true);",
    "  $('btn-logout').classList.remove('hidden');",
    '  goHome(700);   /* already signed in — no reason to stay on this form */',
    '}',
    '} catch(e){}',
    '}',
  ].join('\n'));

replace(
  'password login goes home through goHome()',
  [
    "    status('Logged in! Back to map...', true);",
    "    toast('Welcome back!', 'ok');",
    "    setTimeout(function(){ location.href = 'index.html'; }, 800);",
  ].join('\n'),
  [
    "    status('Logged in! Taking you to the map…', true);",
    "    toast('Welcome back!', 'ok');",
    '    goHome(800);',
  ].join('\n'));

replace(
  'register goes home when confirmation is off',
  [
    "    await window.sbAuth.signUpWithPassword(email(), $('auth-password').value, $('auth-name').value);",
    "    status('Account created! Check your email for the confirm link, click it, then press Login.', true);",
    "    toast('Account created! Check your email, then Login.', 'ok');",
    '    showUser();',
  ].join('\n'),
  [
    "    await window.sbAuth.signUpWithPassword(email(), $('auth-password').value, $('auth-name').value);",
    '    /* Email confirmation ON -> signUp returns no session, so the volunteer has',
    '       to click the confirm link first and stays here. Confirmation OFF -> they',
    '       are already signed in, so the map is the only sensible next screen. */',
    '    if (isSignedIn(await window.sbAuth.currentUser())) {',
    "      status('Account created! Taking you to the map…', true);",
    "      toast('Welcome to FeedAnAnimalMap!', 'ok');",
    '      goHome(800);',
    '    } else {',
    "      status('Account created! Check your email for the confirm link, click it, then press Login.', true);",
    "      toast('Account created! Check your email, then Login.', 'ok');",
    '    }',
  ].join('\n'));

replace(
  'boot watches the session and forwards returning users',
  [
    "$('btn-logout').onclick = async function(){ await window.sbAuth.signOut(); location.reload(); };",
    'showUser();',
  ].join('\n'),
  [
    "$('btn-logout').onclick = async function(){ await window.sbAuth.signOut(); location.reload(); };",
    '/* Covers the magic-link and Google round trips: those come back here first. */',
    'watchSession();',
    '/* Covers a volunteer who is already signed in and opens this page again. */',
    'showUser();',
  ].join('\n'));

if (src !== before) {
  fs.writeFileSync(FILE, src, 'utf8');
  console.log('wrote ' + FILE);
}
