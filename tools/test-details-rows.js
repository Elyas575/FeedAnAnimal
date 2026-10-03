#!/usr/bin/env node
/* Renders the details-drawer fact block for a realistic community report and
   for a well-observed animal, to confirm unknown values are dropped. */
const isUnknown = (value) => {
  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  return !text || text === 'unknown' || text === 'not recorded' ||
    text === 'not sure' || text === 'none recorded' || text === 'unassigned' ||
    text === 'not assigned' || text === 'n/a' || text === '-';
};
function detailRow(label, value) {
  if (isUnknown(value)) return '';
  return '  ' + label + ': ' + value;
}
function countRow(label, count) {
  const n = Number(count) || 0;
  if (n <= 0) return '';
  return detailRow(label, n + (n === 1 ? ' time' : ' times'));
}
function rows(a, station) {
  const sexAge = [a.sex, a.ageClass].every(isUnknown)
    ? '' : (isUnknown(a.sex) ? '' : a.sex) + ' • ' + (isUnknown(a.ageClass) ? '' : a.ageClass);
  return [
    detailRow('Species', a.speciesLabel),
    detailRow('Sex / age', sexAge),
    detailRow('Temperament', a.temperament),
    detailRow('Health', a.health),
    a.sterilized ? detailRow('Neutered', 'Yes') : '',
    a.vaccinated ? detailRow('Vaccinated', 'Yes') : '',
    a.microchipped ? detailRow('Microchipped', 'Yes') : '',
    detailRow('First reported', a.reported),
    countRow('Feeds logged', a.feedCount),
    countRow('Water refills logged', a.waterCount),
    detailRow('Caretakers', a.caretakers && a.caretakers.length ? a.caretakers.join(', ') : ''),
    detailRow('Feeding station', station || ''),
    a.isReport ? detailRow('Reported', a.reporterName || 'by a community volunteer') : ''
  ].filter(Boolean);
}

var report = {
  speciesLabel: 'Cat', sex: 'unknown', ageClass: 'unknown', temperament: 'unknown',
  health: 'healthy', sterilized: false, vaccinated: false, microchipped: false,
  reported: '2h ago', feedCount: 0, waterCount: 0, caretakers: ['Community'],
  isReport: true, reporterName: 'Alex R.'
};
var observed = {
  speciesLabel: 'Cat', sex: 'female', ageClass: 'adult', temperament: 'friendly',
  health: 'treatment', sterilized: true, vaccinated: true, microchipped: false,
  reported: '9d ago', feedCount: 4, waterCount: 2, caretakers: ['Alex R.', 'Priya N.'],
  isReport: false
};

[['community report', report, ''], ['observed animal', observed, 'Station #02']].forEach(function (c) {
  console.log('\n' + c[0] + ' (' + rows(c[1], c[2]).length + ' rows):');
  rows(c[1], c[2]).forEach(function (r) { console.log(r); });
});