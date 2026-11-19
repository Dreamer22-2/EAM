export function findSubtypePair(splitRules, selectedCode, normalizeSubtype) {
  const availablePairs = splitRules.first.flatMap(([firstCode]) => (
    splitRules.second.map(([secondCode]) => [firstCode, secondCode])
  ));
  const normalizedPair = availablePairs.find(([firstCode, secondCode]) => (
    normalizeSubtype(firstCode, secondCode) === selectedCode
  ));
  if (normalizedPair) return normalizedPair;

  return availablePairs.find(([firstCode, secondCode]) => (
    `${firstCode}${secondCode}` === selectedCode
  )) || null;
}
