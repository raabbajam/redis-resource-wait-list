redis.call("LREM", KEYS[1], 9999, ARGV[1])
redis.call("ZREM", KEYS[2], ARGV[1])
if redis.call("SISMEMBER", KEYS[3], ARGV[1]) == 1 then
  redis.call("LREM", KEYS[4], 9999, ARGV[1])
  return redis.call("RPUSH", KEYS[4], ARGV[1])
else
  return nil
end
