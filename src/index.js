const Promise = require('bluebird');
const pool = require('generic-promise-pool');
const redis = require('redis');
const lastIndex = 9999;
Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);
function List(data = {}) {
  const {
    name,
    resources = [],
    options = {},
  } = data;
  const defaults = {
    maxTimeoutToRelease: 300000,
    maxTimeoutToWait: 300000,
    redisUrl: 'redis://127.0.0.1:6379',
    redisOptions: {},
    redisPrefix: 'wl',
  };
  const settings = Object.assign({}, defaults, options);
  const {redisUrl, redisOptions, redisPrefix} = settings;
  const poolOptions = {
    name: `${name}-pool`,
    create: () => Promise.resolve(redis.createClient(redisUrl, redisOptions)),
    destroy: (redisClient) => redisClient.quitAsync(),
    max: 30,
    min: 1,
  };
  const redisPool = pool.create(poolOptions);
  const resourcesListKey = `${redisPrefix}:${name}:resource-list`;
  const availableListKey = `${redisPrefix}:${name}:available-list`;
  const busyListKey = `${redisPrefix}:${name}:busy-list`;
  const busySetKey = `${redisPrefix}:${name}:busy-set`;
  const keys = {
    resourcesListKey,
    availableListKey,
    busyListKey,
    busySetKey,
  };
  // redisClient.on('error', (error) => console.log(`Error from "${name}" wait-list. ${error}`));
  const properties = {
    redisPool,
    settings,
    name,
    resources,
    keys,
  };
  const prototypes = {
    getRedisClient,
    start,
    acquire,
    release,
    add,
    remove,
    getInfo,
    stop,
  };
  const list = Object.assign(Object.create(prototypes), properties);
  return list;
}

module.exports = List;

function start() {
  const {keys, resources} = this;
  return this.getRedisClient((redisClient) =>
    redisClient.existsAsync(keys.resourcesListKey)
      .then((exist) => {
        if (exist) {
          return null;
        }
        return redisClient.multi()
          .rpush(keys.resourcesListKey, ...resources)
          .rpush(keys.availableListKey, ...resources)
          .execAsync();
      })
  );
}

function acquire() {
  const {keys, settings} = this;
  const {maxTimeoutToWait} = settings;
  return this.getRedisClient((redisClient) =>
    redisClient.brpoplpushAsync(keys.availableListKey, keys.busyListKey, maxTimeoutToWait));
}

function release(resource) {
  const {keys} = this;
  return this.getRedisClient((redisClient) =>
    redisClient.multi()
      .rpush(keys.availableListKey, resource)
      .lrem(keys.busyListKey, 1, resource)
      .execAsync()
    );
}

function add(resource) {
  const {keys} = this;
  return this.getRedisClient((redisClient) =>
    redisClient.multi()
      .rpush(keys.resourcesListKey, resource)
      .rpush(keys.availableListKey, resource)
      .execAsync()
    );
}

function remove(resource) {
  const {keys} = this;
  return this.getRedisClient((redisClient) =>
    redisClient.multi()
      .lrem(keys.busyListKey, 1, resource)
      .lrem(keys.availableListKey, 1, resource)
      .lrem(keys.resourcesListKey, 1, resource)
      .execAsync()
    );
}

function getInfo() {
  const {keys, settings} = this;
  return this.getRedisClient((redisClient) =>
    redisClient.multi()
      .lrange(keys.resourcesListKey, 0, lastIndex)
      .lrange(keys.availableListKey, 0, lastIndex)
      .lrange(keys.busyListKey, 0, lastIndex)
      .execAsync()
    )
    .spread((resources, available, busy) => ({resources, available, busy, settings}));
}

function stop() {
  const {keys, redisPool} = this;
  return this.getRedisClient((redisClient) =>
    redisClient.multi()
      .del(keys.resourcesListKey)
      .del(keys.availableListKey)
      .del(keys.busyListKey)
      .execAsync()
    )
    .then(() => redisPool.drain());
}

function getRedisClient(fn) {
  const {redisPool} = this;
  return Promise.resolve()
    .then(() => redisPool.acquire(fn));
}
