let shared = 0;

export function bump(): number {
  shared += 1;
  return shared;
}

export function localOnly(): number {
  let local = 1;
  local += 1;
  return local;
}

export function readShared(): number {
  return shared;
}
