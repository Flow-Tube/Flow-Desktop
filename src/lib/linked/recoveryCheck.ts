/** Two distinct word positions (0-based, ascending) the user types back to prove they saved the key. */
export function pickCheckPositions(count: number, random: () => number = Math.random): [number, number] {
  const first = Math.floor(random() * count);
  const second = (first + 1 + Math.floor(random() * (count - 1))) % count;
  return first < second ? [first, second] : [second, first];
}

export function wordMatches(expected: string, typed: string): boolean {
  return expected.toLowerCase() === typed.trim().toLowerCase();
}
