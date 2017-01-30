if redis.call("SCARD", KEYS[1]) ~= 0 then
  redis.call("BRPOPLPUSH", KEYS[2], KEYS[3], ARGV[1])
else
  return "NONE"
end
