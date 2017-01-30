# Lua Scripts Notes

## list.start()

generate list for all-resources and available-resource.

## list.acquire()

get available resource
Steps:
  check if resource at least has 1 member
  get last resource / pop it from available list. push it to busy list.
  if available is empty, blocking.
  add to busy set with expired timestamp to release when maxTimeoutToRelease reached

input key: all-resource set, available, busy-list
input args: timeout block (in second)

## list.release(resource)

return resource to end of available list.
Steps:
  remove resource from busy list.
  check if resource is not removed while busy by checking if it exist in all resource set
  if exist, return it to available list
  else do nothing

input key: busy, busy-set, all-resource, available,
input args: resource
