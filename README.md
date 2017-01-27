# redis-resource-wait-list

[![NPM version][npm-image]][npm-url]
[![Build Status][travis-image]][travis-url]
[![Coveralls Status][coveralls-image]][coveralls-url]
[![Dependency Status][depstat-image]][depstat-url]
[![Downloads][download-badge]][npm-url]

> Manage limited atomic resource using redis, with wait / queue feature.

## Install

```sh
npm i -S redis-resource-wait-list
```

## Usage

```js
const List = require('redis-resource-wait-list');

// options and defaults
const list = List({
  name: 'server-list',
  resources: ['server-1', 'server-2', 'server-3'],
  options: {
    maxTimeoutToRelease: 5 * 60 * 1000, // Defaults to five minutes, important. see Reliable queues.
    maxTimeoutToWait: 5 * 60 * 1000, // Defaults to five minutes, important. see Reliable queues.
    intervalToCheckRelease: 30000, // Resource that exceed maxTimeoutToRelease will release every check, thus the interval option
    redisUrl: 'redis://127.0.0.1:6379',
    redisOptions: {},
    redisPrefix: 'wl',
  },
});
list.start() //Promise
  .then(() => list.acquire())
  .then((resource) => {
    // use resource
    return list.release(resource); // Promise
    list.add('server-4') // Promise
      .then(() => console.log('added'));
    list.remove('server-1') // Promise
      .then(() => console.log('removed'));
    list.getInfo()
      .then((info) => console.log('info'));
    /*
    info = {
      resources: ['server-2', 'server-3', 'server-4'],
      available: ['server-2', 'server-3', 'server-4'],
      busy: [],
      // clientWaiting: 0, // not implemented
      settings,
    };
    */
    list.stop(); // Promise

  });
```

## License

MIT © [Raabb Ajam](https://github.com/raabbajam)

[npm-url]: https://npmjs.org/package/redis-resource-wait-list
[npm-image]: https://img.shields.io/npm/v/redis-resource-wait-list.svg?style=flat-square

[travis-url]: https://travis-ci.org/raabbajam/redis-resource-wait-list
[travis-image]: https://img.shields.io/travis/raabbajam/redis-resource-wait-list.svg?style=flat-square

[coveralls-url]: https://coveralls.io/r/raabbajam/redis-resource-wait-list
[coveralls-image]: https://img.shields.io/coveralls/raabbajam/redis-resource-wait-list.svg?style=flat-square

[depstat-url]: https://david-dm.org/raabbajam/redis-resource-wait-list
[depstat-image]: https://david-dm.org/raabbajam/redis-resource-wait-list.svg?style=flat-square

[download-badge]: http://img.shields.io/npm/dm/redis-resource-wait-list.svg?style=flat-square
