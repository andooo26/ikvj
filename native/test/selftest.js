// Plain-Node self-test for the native engine: compositing math, layer order,
// sender lifecycle. Runs without Electron (and on GPU-less CI via WARP on
// Windows). Usage: node native/test/selftest.js
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { Engine, MIX, SLOTS, listServers } = require(
  path.join(__dirname, '..', 'build', 'Release', 'ikvj_native.node'),
);

const W = 1920;
const H = 1080;
const near = (actual, expected, label) => {
  for (let i = 0; i < 4; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= 2,
      `${label}: got [${actual}] expected [${expected}]`,
    );
  }
};

const e = new Engine(W, H);
console.log(`backend=${e.backend} adapter="${e.adapter}" slots=${SLOTS} mix=${MIX}`);

e.fillSource(0, 1, 0, 0); // A red
e.fillSource(1, 0, 0, 1); // B blue
e.fillSource(2, 0, 1, 0); // C green
e.fillSource(3, 1, 1, 1); // D white

e.compose([]);
near(e.readPixel(MIX, W / 2, H / 2), [0, 0, 0, 255], 'empty mix is black');

e.compose([{ slot: 0, opacity: 1 }]);
near(e.readPixel(MIX, 0, 0), [255, 0, 0, 255], 'A alone');

e.compose([
  { slot: 0, opacity: 1 },
  { slot: 1, opacity: 0.5 },
]);
near(e.readPixel(MIX, W - 1, H - 1), [128, 0, 128, 255], 'B 50% over A');

e.compose([
  { slot: 1, opacity: 1 },
  { slot: 0, opacity: 1 },
]);
near(e.readPixel(MIX, 10, 10), [255, 0, 0, 255], 'top layer wins');

e.compose([
  { slot: 2, opacity: 1 },
  { slot: 3, opacity: 0 },
]);
near(e.readPixel(MIX, 10, 10), [0, 255, 0, 255], 'opacity 0 is invisible');

assert.throws(() => e.compose([{ slot: 9, opacity: 1 }]), /invalid slot/);
assert.throws(() => e.setSource(0, Buffer.alloc(2), 'bgra'), /too short/);

const id = e.createSender('ikvj-selftest');
e.publish(id, MIX);
e.publish(id, 0);
console.log('hasClients:', e.hasClients(id));
e.destroySender(id);
assert.throws(() => e.publish(id, MIX), /unknown sender/);

assert.equal(e.sharedHandle(MIX).length, 8);

console.log('servers:', listServers());
e.dispose();
assert.throws(() => e.compose([]), /disposed/);
console.log('SELFTEST_PASS');
