const debug = require('debug')('redis-resource-wait-list:main');
const Promise = require('bluebird');
const moment = require('moment');
const pool = require('generic-promise-pool');
const redis = require('redis');
const _ = require('lodash');
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
  const settings = Object.assign({}, defaults, options, {name});
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
    releaseAllExpired,
    stop,
    destroy,
    sync,
  };
  const list = Object.assign(Object.create(prototypes), properties);
  return list;
}

module.exports = List;

function start() {
  const {keys, resources = [], settings} = this;
  const {
    redisPrefix,
    name,
  } = settings;
  debug(`starting ${redisPrefix}:${name}`);
  const {intervalToCheckRelease} = settings;
  return this.getRedisClient((redisClient) =>
    redisClient.existsAsync(keys.resourcesListKey)
      .then((exist) => {
        const repeat = () => this.releaseAllExpired()
          .then(() => {
            this.timer = setTimeout(repeat, intervalToCheckRelease);
          })
          .catch(debug);
        this.timer = setTimeout(repeat, intervalToCheckRelease);
        if (exist) {
          return this.sync(resources);
        }
        if (!resources.length) {
          return null;
        }
        return redisClient.multi()
          .sadd(keys.resourcesListKey, ...resources)
          .rpush(keys.availableListKey, ...resources)
          .execAsync();
      }))
      .return(this);
}

function acquire() {
  const {keys, settings} = this;
  const {name} = settings;
  debug(`${name} acquire`);
  const {maxTimeoutToWait, maxTimeoutToRelease} = settings;
  const thousand = 1000;
  const timeout = Math.ceil(maxTimeoutToWait / thousand);
  return this.getRedisClient((redisClient) =>
    redisClient.scardAsync(keys.resourcesListKey)
      .then((hasResource) => {
        if (!hasResource) {
          const error = new Error('ENOTFOUND. This list has no member');
          throw error;
        }
        return redisClient.brpoplpushAsync(keys.availableListKey, keys.busyListKey, timeout);
      })
      .tap((resource) => {
        debug(`${name} ${resource}`);
        if (!resource) {
          const error = new Error('ETIMEOUT. Can\'t find resouce.');
          throw error;
        }
        const expired = moment().add(maxTimeoutToRelease, 'ms').unix();
        redisClient.zaddAsync(keys.busySetKey, expired, resource);
      }));
}

function release(resource) {
  const {keys, settings: {name}} = this;
  debug(`${name} release ${resource}`);
  const sha = '7834e4d113867947e1e2e376f9623297bfab7991';
  const restArgs = [
    4,
    keys.busyListKey, keys.busySetKey, keys.resourcesListKey, keys.availableListKey,
    resource,
  ];
  return this.getRedisClient((redisClient) =>
    redisClient.evalshaAsync(sha, ...restArgs)
      .catch((error) => {
        if (!/NOSCRIPT/i.test(error.message)) {
          throw error;
        }
        // eslint-disable-next-line max-len
        const source = 'redis.call("LREM", KEYS[1], 9999, ARGV[1]) redis.call("ZREM", KEYS[2], ARGV[1]) if redis.call("SISMEMBER", KEYS[3], ARGV[1]) == 1 then redis.call("LREM", KEYS[4], 9999, ARGV[1]) return redis.call("RPUSH", KEYS[4], ARGV[1]) else return nil end';
        return redisClient.evalAsync(source, ...restArgs);
      }));
}

function add(...resources) {
  const {keys, settings} = this;
  const {name} = settings;
  debug(`${name} add ${resources}`);
  return this.getRedisClient((redisClient) => {
    const multi = redisClient.multi();
    resources.forEach((resource) => {
      multi
        .sadd(keys.resourcesListKey, resource)
        .lrem(keys.availableListKey, bigNumber, resource)
        .rpush(keys.availableListKey, resource);
    });
    return multi.execAsync();
  });
}

function remove(...resources) {
  const {keys, settings} = this;
  const {name} = settings;
  debug(`${name} remove ${resources}`);
  return this.getRedisClient((redisClient) => {
    const multi = redisClient.multi();
    resources.forEach((resource) => {
      multi
        .lrem(keys.busyListKey, bigNumber, resource)
        .lrem(keys.availableListKey, bigNumber, resource)
        .srem(keys.resourcesListKey, resource);
    });
    return multi.execAsync();
  });
}

function getInfo() {
  const {keys, settings, name} = this;
  debug(`${name} getInfo`);
  return this.getRedisClient((redisClient) =>
    redisClient.multi()
      .smembers(keys.resourcesListKey)
      .lrange(keys.availableListKey, 0, bigNumber)
      .lrange(keys.busyListKey, 0, bigNumber)
      .execAsync())
    .spread((resources, available, busy) => ({
      name,
      resources,
      available,
      busy,
      settings,
    }))
    .tap(debug);
}

function stop() {
  const {redisPool, timer, name} = this;
  debug(`${name} stop`);
  if (timer) {
    debug('clearTimeout timer');
    clearTimeout(timer);
  }
  return redisPool.drain()
    .then(() => {
      this.stopped = true;
    });
}

function destroy(options = {}) {
  const {keys, name} = this;
  debug(`${name} destroy`);
  return this.getRedisClient((redisClient) =>
    redisClient.multi()
      .del(keys.resourcesListKey)
      .del(keys.availableListKey)
      .del(keys.busyListKey)
      .del(keys.busySetKey)
      .execAsync())
    .tap(() => {
      const {with_stop} = options;
      if (with_stop) {
        return this.stop();
      }
      return null;
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
  const {keys, stopped, name} = this;
  debug(`${name} releaseAllExpired`);
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

function sync(resourcesReference) {
  const {name} = this;
  debug(`${name} sync ${resourcesReference}`);
  return this.getInfo()
    .then((info) => {
      const {resources} = info;
      const resourcesToRemove = _.differenceBy(resources, resourcesReference, _.toString);
      const resourcesToAdd = _.differenceBy(resourcesReference, resources, _.toString);
      debug({name, resources, resourcesReference, resourcesToRemove, resourcesToAdd});
      const promises = [];
      if (resourcesToRemove.length) {
        promises.push(this.remove(...resourcesToRemove));
      }
      if (resourcesToAdd.length) {
        promises.push(this.add(...resourcesToAdd));
      }
      if (promises.length) {
        return Promise.all(promises);
      }
      return null;
    });
}
