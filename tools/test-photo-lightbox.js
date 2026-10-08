#!/usr/bin/env node
/* PHOTO LIGHTBOX checks.
 *
 *   node tools/test-photo-lightbox.js
 *
 * Volunteers asked to SEE the animal: a 64-80px thumbnail is fine for
 * scanning a list, but the click-through has to deliver a huge picture.
 * Everything about that flow is wiring between index.html (the modal) and
 * index.js (the action, the card tap, the thumbnails) - exactly the kind of
 * coupling that rots silently and is only discovered by tapping in a
 * browser. These checks pin it down headlessly:
 *
 *   1. The lightbox is a real modal (backdrop click / X / Escape come from
 *      the shared system, so no second closing path can drift).
 *   2. One `photo` action feeds all three entry points: sidebar card,
 *      details drawer, map popup.
 *   3. A dead photo link (the old Google aida CDN 403s) degrades to a
 *      caption instead of a full-screen broken-image glyph.
 *   4. The thumbnails actually grew - the "make them bigger" half of the
 *      request, easy to quietly revert during unrelated CSS work.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

const rows = [];
const ok = (label, pass, detail) => rows.push([pass ? 'OK  ' : 'MISS', label + (detail === undefined ? '' : '  ->  ' + detail)]);

/* ------------------------------ the modal ---------------------------- */
ok('the lightbox exists', /id="photo-modal"/.test(html));
ok('it opts into the shared modal system', /id="photo-modal"[^>]*data-modal/.test(html));
ok('it stacks above the chat modal', /id="photo-modal"[^>]*z-\[88\]/.test(html) && /id="chat-modal"[^>]*z-\[85\]/.test(html));
ok('the toast stack still sits on top', /id="toast-stack"[^>]*z-\[90\]/.test(html));
ok('it is a labelled dialog', /id="photo-modal"[^>]*aria-label="Animal photo"/.test(html));
ok('the X closes it through the shared hook', html.indexOf('data-close-modal="photo-modal"') !== -1);
ok('it has an image slot', html.indexOf('id="photo-img"') !== -1);
ok('it has a title and a caption', html.indexOf('id="photo-title"') !== -1 && html.indexOf('id="photo-caption"') !== -1);
ok('the image slot ships without a src (set per animal)', !/<img id="photo-img"[^>]*\ssrc=/.test(html));
ok('the picture is capped so it never overflows', /id="photo-img"[^>]*max-h-\[74vh\]/.test(html) && /id="photo-img"[^>]*object-contain/.test(html));
ok('Escape closes every modal including this one', /event\.key === 'Escape'\) closeAllModals\(\)/.test(js));
ok('a backdrop click closes it', /target === modal\) closeModal\(modal\.id\)/.test(js));

/* ------------------------------ openPhoto ---------------------------- */
ok('openPhoto() is defined', js.indexOf('function openPhoto(id)') !== -1);
ok('it resolves the animal first', /function openPhoto\(id\)[\s\S]{0,200}animalById\(id\)/.test(js));
ok('it fills the image from photoUrl', /function openPhoto\(id\)[\s\S]{0,1400}img\.src = animal\.photoUrl/.test(js));
ok('it opens the lightbox', /function openPhoto\(id\)[\s\S]{0,1600}openModal\('photo-modal'\)/.test(js));
ok('a dead photo link never shows a broken glyph full screen', /function openPhoto\(id\)[\s\S]{0,1600}img\.onerror/.test(js));
ok('handlers are attached before the src is assigned', /img\.onerror = function[\s\S]{0,400}img\.src = animal\.photoUrl/.test(js));
ok('an animal with no photo explains itself', js.indexOf('No photo of ') !== -1);

/* --------------------------- the entry points ------------------------ */
/* NOTE: split card behaviour — the PHOTO thumb (data-action="photo") opens
   the lightbox, the REST of the card flies the map (revealAnimal). The
   thumb button answers first via the [data-action] handler, so the card
   handler only sees non-button taps. */
ok('exactly one photo action handler exists', (js.match(/action === 'photo'/g) || []).length === 1);
ok('the photo action opens the lightbox', /action === 'photo'\)[\s\S]{0,80}openPhoto\(id\)/.test(js));
ok('the card thumbnail is a photo button', /data-action="photo" data-id=[\s\S]{0,80}View a big photo/.test(js));
ok('tapping the card body flies the map to the animal', /closest\('\[data-animal-card\]'\)[\s\S]{0,160}revealAnimal\(/.test(js));
ok('the card tap sits AFTER the action buttons', js.indexOf("target.closest('[data-action]')") < js.indexOf("target.closest('[data-animal-card]')"));
ok('the card tap sits AFTER the action buttons', js.indexOf("target.closest('[data-action]')") < js.indexOf("target.closest('[data-animal-card]')"));
ok('the card reads as clickable', /data-animal-card=.*cursor-pointer/.test(js));
ok('the card thumbnail shows a zoom affordance', js.indexOf('group-hover:opacity-100') !== -1 && js.indexOf('zoom_in') !== -1);
ok('the details drawer thumbnail opens the lightbox', /data-action="photo" data-id=[\s\S]{0,200}View a big photo/.test(js));
ok('the map popup thumb opens the lightbox', js.indexOf('class="fta-popup__thumb" data-action="photo"') !== -1);

/* --------------------------- the sizes ------------------------------- */
ok('sidebar thumbnails grew to 80px', js.indexOf('w-20 h-20 rounded-xl overflow-hidden shrink-0') !== -1);
ok('the drawer thumbnail grew to 112px', js.indexOf('w-28 h-28 rounded-xl overflow-hidden shrink-0') !== -1);
ok('popup thumbnail stays compact at 56px', /\.fta-popup__thumb \{ width: 56px; height: 56px;/.test(html));
ok('a bigger thumb can never push the close button out', /drawerThumb[\s\S]{0,400}truncate/.test(js));

/* --------------------------- supporting plumbing --------------------- */
ok('closing the lightbox keeps scrolling locked for the drawer beneath it',
  /document\.querySelector\('\[data-modal\]:not\(\.hidden\)'\) \? 'hidden'/.test(js));
ok('the new JS-only utilities are in the class primer', html.indexOf('cursor-zoom-in') !== -1 && html.indexOf('group-hover:opacity-100') !== -1);

/* ------------------------------ report ------------------------------- */
rows.forEach((row) => console.log(row[0] + ' ' + row[1]));
const failed = rows.filter((row) => row[0] === 'MISS').length;
console.log(failed ? '\n' + failed + ' MISS' : '\nall ' + rows.length + ' photo lightbox checks passed');
process.exit(failed ? 1 : 0);
