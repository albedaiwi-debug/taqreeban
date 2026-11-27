// Scoring rules (lower is better):
// - A guess scores how many times off it is: max(guess/answer, answer/guess). Perfect = 1×.
// - No cap: wild guesses are punished in full (plain average, by design).
// - No answer = 100× or the worst guess on that question, whichever is bigger,
//   so skipping is never better than guessing.
// - Round score = plain average of the 10 question scores.
// - Team question score = plain average of its members' scores on that question.
const MISS_FLOOR = 100;

function scoreGuess(guess, answer) {
  const r = guess / answer;
  return r >= 1 ? r : 1 / r;
}

function missPenalty(submittedMultiples) {
  return Math.max(MISS_FLOOR, ...submittedMultiples);
}

function average(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

module.exports = { scoreGuess, missPenalty, average, MISS_FLOOR };
