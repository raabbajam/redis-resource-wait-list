const Promise = require('bluebird');
const debug = require('debug')('redis-resource-wait-list:main');
const moment = require('moment');
const pool = require('generic-promise-pool');
const redis = require('redis');
const bigNumber = 9999;
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
    intervalToCheckRelease: 30000,
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
  const resourcesListKey = `${redisPrefix}:${name}:resource-set`;
  const availableListKey = `${redisPrefix}:${name}:available-list`;
  const busyListKey = `${redisPrefix}:${name}:busy-list`;
  const busySetKey = `${redisPrefix}:${name}:busy-set`;
  const keys = {
    resourcesListKey,
    availableListKey,
    busyListKey,
    busySetKey,
  };
  const properties = {
    stopped: false,
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
    releaseAllExpired,
  };
  const list = Object.assign(Object.create(prototypes), properties);
  return list;
}

module.exports = List;

function start() {
  const {keys, resources, settings} = this;
  const {intervalToCheckRelease} = settings;
  return this.getRedisClient((redisClient) =>
    redisClient.existsAsync(keys.resourcesListKey)
      .then((exist) => {
        if (exist) {
          return null;
        }
        const repeat = () => this.releaseAllExpired()
          .then(() => {
            this.timer = setTimeout(repeat, intervalToCheckRelease);
          })
          .catch(() => {});
        this.timer = setTimeout(repeat, intervalToCheckRelease);
        return redisClient.multi()
          .sadd(keys.resourcesListKey, ...resources)
          .rpush(keys.availableListKey, ...resources)
          .execAsync();
      }));
}

function acquire() {
  debug('acquire');
  const {keys, settings} = this;
  const {maxTimeoutToWait, maxTimeoutToRelease} = settings;
  return this.getRedisClient((redisClient) =>
    redisClient.brpoplpushAsync(keys.availableListKey, keys.busyListKey, maxTimeoutToWait)
      // .tap(debug)
      .tap((resource) => {
        const expired = moment().add(maxTimeoutToRelease, 'ms').unix();
        redisClient.zaddAsync(keys.busySetKey, expired, resource);
      }));
}

function release(resource) {
  debug(`release ${resource}`);
  const {keys} = this;
  return this.getRedisClient((redisClient) =>
    redisClient.multi()
      .lrem(keys.availableListKey, bigNumber, resource)
      .rpush(keys.availableListKey, resource)
      .lrem(keys.busyListKey, 1, resource)
      .zrem(keys.busySetKey, resource)
      .execAsync());
}

function add(resource) {
  const {keys} = this;
  return this.getRedisClient((redisClient) =>
    redisClient.multi()
      .sadd(keys.resourcesListKey, resource)
      .lrem(keys.availableListKey, bigNumber, resource)
      .rpush(keys.availableListKey, resource)
      .execAsync());
}

function remove(resource) {
  const {keys} = this;
  return this.getRedisClient((redisClient) =>
    redisClient.multi()
      .lrem(keys.busyListKey, bigNumber, resource)
      .lrem(keys.availableListKey, bigNumber, resource)
      .srem(keys.resourcesListKey, resource)
      .execAsync());
}

function getInfo() {
  const {keys, settings} = this;
  return this.getRedisClient((redisClient) =>
    redisClient.multi()
      .smembers(keys.resourcesListKey)
      .lrange(keys.availableListKey, 0, bigNumber)
      .lrange(keys.busyListKey, 0, bigNumber)
      .execAsync())
    .spread((resources, available, busy) => ({resources, available, busy, settings}));
}

function stop() {
  debug('stop');
  const {keys, redisPool, timer} = this;
  if (timer) {
    clearTimeout(timer);
  }
  return this.getRedisClient((redisClient) =>
    redisClient.lrangeAsync(keys.busyListKey, 0, bigNumber)
      // .tap(debug)
      .map((busyResource) => this.release(busyResource))
      .then(() => redisClient.multi()
        .del(keys.resourcesListKey)
        .del(keys.availableListKey)
        .del(keys.busyListKey)
        .del(keys.busySetKey)
        .execAsync()))
    .then(() => redisPool.drain())
    .then(() => {
      this.stopped = true;
    });
}

function getRedisClient(fn) {
  const {redisPool, stopped} = this;
  return Promise.resolve()
    .then(() => {
      if (stopped) {
        const error = new Error('The resource list is already stopped and inaccessible.');
        throw error;
      }
    })
    .then(() => redisPool.acquire(fn));
}

function releaseAllExpired() {
  debug('releaseAllExpired');
  const {keys, stopped} = this;
  return Promise.resolve()
    .then(() => {
      if (stopped) {
        const error = new Error('The resource list is already stopped and inaccessible.');
        throw error;
      }
      return this.getRedisClient((redisClient) => {
        const now = moment().unix();
        return redisClient.zrangebyscoreAsync(keys.busySetKey, 0, now)
          // .tap(debug)
          .map((resource) => this.release(resource));
      });
    });
}
