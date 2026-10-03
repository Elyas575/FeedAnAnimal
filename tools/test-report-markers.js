function speciesRule(s) {
  var H = { cat: { food: 14, water: 10 }, dog: { food: 16, water: 12 } };
  var h = H[s] || { food: 14, water: 10 };
  return { food: h.food * 60 + 120, water: h.water * 60 + 120 };
}
function encode(desc, nf, nw, nv) {
  var x = desc || '';
  if (nf) x = '[NEEDS_FOOD] ' + x;
  if (nw) x = '[NEEDS_WATER] ' + x;
  if (nv) x = '[NEEDS_VET] ' + x;
  return x || null;
}
function decode(row) {
  var rawText = row.description || '';
  var needsVet = rawText.indexOf('[NEEDS_VET]') === 0;
  var afterVet = needsVet ? rawText.slice('[NEEDS_VET]'.length).trim() : rawText;
  var needsWater = afterVet.indexOf('[NEEDS_WATER]') === 0;
  var afterWater = needsWater ? afterVet.slice('[NEEDS_WATER]'.length).trim() : afterVet;
  var needsFood = afterWater.indexOf('[NEEDS_FOOD]') === 0;
  var desc = (needsFood ? afterWater.slice('[NEEDS_FOOD]'.length).trim() : afterWater)
    || 'Reported by a community volunteer.';
  var rule = speciesRule(row.species || 'cat');
  return {
    fedMin: needsFood ? rule.food : 5,
    waterMin: needsWater ? rule.water : 5,
    health: needsVet ? 'critical' : 'healthy',
    desc: desc
  };
}

var cases = [
  ['all three', 'very thin', 1, 1, 1, 960, 720, 'critical', 'very thin'],
  ['none', 'friendly cat', 0, 0, 0, 5, 5, 'healthy', 'friendly cat'],
  ['food only', '', 1, 0, 0, 960, 5, 'healthy', 'Reported by a community volunteer.'],
  ['water only', '', 0, 1, 0, 5, 720, 'healthy', 'Reported by a community volunteer.'],
  ['vet only', 'bleeding', 0, 0, 1, 5, 5, 'critical', 'bleeding'],
  ['food+vet', 'limping', 1, 0, 1, 960, 5, 'critical', 'limping'],
  ['all, no desc', '', 1, 1, 1, 960, 720, 'critical', 'Reported by a community volunteer.']
];

var failed = 0;
cases.forEach(function (c) {
  var out = decode({ species: 'cat', description: encode(c[1], c[2], c[3], c[4]) });
  var pass = out.fedMin === c[5] && out.waterMin === c[6] && out.health === c[7] && out.desc === c[8];
  if (!pass) failed += 1;
  console.log((pass ? 'OK  ' : 'FAIL') + ' ' + c[0].padEnd(13) +
    'food=' + String(out.fedMin).padStart(4) + 'm' +
    ' water=' + String(out.waterMin).padStart(4) + 'm' +
    ' health=' + out.health.padEnd(9) + ' desc="' + out.desc + '"');
});
console.log(failed ? '\n' + failed + ' FAILED' : '\nall ' + cases.length + ' round trips correct');
process.exit(failed ? 1 : 0);