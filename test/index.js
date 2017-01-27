/* eslint no-console: 0 */
const Promise = require('bluebird');
const test = require('tape');
const List = require('../src');
test('List -- start', (assert) => {
  const list = List({
    name: 'resource-x',
    resources: ['x1'],
  });
  return list.start()
    .then(() => list.getInfo()
      .then((info) => {
        assert.ok(info.available.length === 1, 'should make available 1');
        assert.ok(info.busy.length === 0, 'should make busy length 0');
        return list.stop().then(() => assert.end());
      })
    )
    .catch((error) => {
      list.stop()
        .then(() => assert.end(error));
    });
});
test('List -- acquire', (assert) => {
  const list = List({
    name: 'resource-x',
    resources: ['x1'],
  });
  return list.start()
    .then(() => list.acquire())
    .then((x1) => {
      assert.ok(x1 === 'x1');
      return list.getInfo()
        .then((info) => {
          assert.ok(info.available.length === 0, 'should make none available');
          assert.ok(info.busy[0] === 'x1', 'should register resource as busy');
          assert.ok(info.busy.length === 1, 'should make busy length 1');
          return list.stop().then(() => assert.end());
        });
    })
    .catch((error) => {
      list.stop()
        .then(() => assert.end(error));
    });
});
test('List -- release', (assert) => {
  const list = List({
    name: 'resource-x',
    resources: ['x1'],
  });
  return list.start()
    .then(() => list.acquire())
    .then((x1) => list.release(x1))
    .then(() => list.getInfo())
    .then((info) => {
      assert.ok(info.available.length === 1, 'should make resource available');
      assert.ok(info.busy.length === 0, 'should release busy resource');
      return list.stop().then(() => assert.end());
    })
    .catch((error) => {
      list.stop()
        .then(() => assert.end(error));
    });
});
test('List -- add', (assert) => {
  const list = List({
    name: 'resource-x',
    resources: ['x1'],
  });
  return list.start()
    .then(() => list.add('x2'))
    .then(() => list.getInfo())
    .then((info) => {
      assert.ok(info.available.length === 2, 'should make available 2');
      return list.stop().then(() => assert.end());
    })
    .catch((error) => {
      list.stop()
        .then(() => assert.end(error));
    });
});
test('List -- remove', (assert) => {
  const list = List({
    name: 'resource-x',
    resources: ['x1'],
  });
  return list.start()
    .then(() => list.remove('x1'))
    .then(() => list.getInfo())
    .then((info) => {
      assert.ok(info.available.length === 0, 'should make available 0');
      return list.stop().then(() => assert.end());
    })
    .catch((error) => {
      list.stop()
        .then(() => assert.end(error));
    });
});
test('List -- stop', (assert) => {
  const list = List({
    name: 'resource-x',
    resources: ['x1'],
  });
  return list.start()
    .then(() => list.stop())
    .then(() => list.getInfo())
    .catch((error) => {
      assert.ok(Boolean(error), 'should error connection closed');
      assert.end();
    });
});
test('List -- started in 2 places', (assert) => {
  const list = List({
    name: 'resource-x',
    resources: ['x1'],
  });
  return list.start()
    .then(() => list.acquire())
    .then(() => list.start())
    .then(() => list.getInfo())
    .then((info) => {
      assert.ok(info.available.length === 0, 'should not re init');
      return list.stop().then(() => assert.end());
    })
    .catch((error) => {
      list.stop()
        .then(() => assert.end(error));
    });
});
test('List -- acquire more than available', (assert) => {
  const delay = 100;
  const list = List({
    name: 'resource-x',
    resources: ['x1'],
  });
  return list.start()
    .then(() => list.acquire())
    .then((x1) => {
      Promise.delay(delay).then(() => list.release(x1));
      return list.acquire();
    })
    .then((x1) => {
      assert.ok(x1 === 'x1', 'should wait until available');
      return list.stop().then(() => assert.end());
    })
    .catch((error) => {
      list.stop()
        .then(() => assert.end(error));
    });
});
test('List -- maxTimeoutToRelease', (assert) => {
  const delay = 2000;
  const list = List({
    name: 'resource-x',
    resources: ['x1'],
    options: {
      maxTimeoutToRelease: 1000,
      intervalToCheckRelease: 1000,
    },
  });
  return list.start()
    .then(() => list.acquire())
    .delay(delay)
    .then(() => list.getInfo())
    .then((info) => {
      assert.ok(info.available.length === 1, 'should released due to timeout');
      return list.stop().then(() => assert.end());
    })
    .catch((error) => {
      list.stop()
        .then(() => assert.end(error));
    });
});
test('List -- removed when busy', (assert) => {
  const list = List({
    name: 'resource-x',
    resources: ['x1'],
  });
  return list.start()
    .then(() => list.acquire())
    .then((x1) => list.remove(x1).then(() => list.release(x1)))
    .then(() => list.getInfo())
    .then((info) => {
      assert.ok(info.available.length === 0, 'should not released back to available due to removed');
      return list.stop().then(() => assert.end());
    })
    .catch((error) => {
      list.stop()
        .then(() => assert.end(error));
    });
});
test.only('List -- released multiple times', (assert) => {
  const list = List({
    name: 'resource-x',
    resources: ['x1'],
  });
  return list.start()
    .then(() => list.acquire())
    .then((x1) => list.release(x1).then(() => list.release(x1)).then(() => list.release(x1)))
    .then(() => list.getInfo())
    .then((info) => {
      assert.ok(info.available.length === 1, 'should not duplicate on available');
      return list.stop().then(() => assert.end());
    })
    .catch((error) => {
      list.stop()
        .then(() => assert.end(error));
    });
});
