/* Finishes the auth.html patch that tools/patch-auth-redirect.js left at
 * "1 of 4". That script spells its line breaks as \r\n because this file is
 * CRLF, so this one does the same for the three edits it MISSed.
 * Safe to re-run: every block is checked for uniqueness first. */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'auth.html');

let src = fs.readFileSync(FILE, 'utf8');
const NL = '\r\n';
const before = src;

function replace(what, oldText, newText) {
  const oldS = oldText.split('\n').join(NL);
  const newS = newText.split('\n').join(NL);
  if (src.indexOf(oldS) === -1) { console.log('MISS  ' + what); process.exitCode = 1; return; }
  if (src.indexOf(oldS) !== src.lastIndexOf(oldS)) { console.log('DUP   ' + what); process.exitCode = 1; return; }
  src = src.replace(oldS, newS);
  console.log('OK    ' + what);
}

/* 2. Register: go home immediately when email confirmation is OFF, so the
      volunteer never lands on a form they already completed. */
replace(
  'register goes home when confirmation is off',
  [
    "await window.sbAuth.signUpWithPassword(email(), $('auth-password').value, $('auth-name').value);",
    "status('Account created! Check your email for the confirm link, click it, then press Login.', true);",
    "toast('Account created! Check your email, then Login.', 'ok');",
    'showUser();',
  ].join('\n'),
  [
    "await window.sbAuth.signUpWithPassword(email(), $('auth-password').value, $('auth-name').value);",
    '/* Email confirmation ON -> signUp returns no session, so the volunteer has',
    '   to click the confirm link first and stays here. Confirmation OFF -> they',
    '   are already signed in, so the map is the only sensible next screen. */',
    'if (isSignedIn(await window.sbAuth.currentUser())) {',
    "  status('Account created! Taking you to the map…', true);",
    "  toast('Welcome to FeedAnAnimalMap!', 'ok');",
    '  goHome(800);',
    '} else {',
    "  status('Account created! Check your email for the confirm link, click it, then press Login.', true);",
    "  toast('Account created! Check your email, then Login.', 'ok');",
    '}',
  ].join('\n'));

/* 3. Login: route through goHome() so Back does not return to the form. */
replace(
  'password login goes home through goHome()',
  [
    "status('Logged in! Back to map...', true);",
    "toast('Welcome back!', 'ok');",
    "setTimeout(function(){ location.href = 'index.html'; }, 800);",
  ].join('\n'),
  [
    "status('Logged in! Taking you to the map…', true);",
    "toast('Welcome back!', 'ok');",
    'goHome(800);',
  ].join('\n'));

/* 4. Boot: watch the session. Without this the magic-link and Google
      round trips return here with a session in the URL and nothing moves
      the volunteer home. */
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