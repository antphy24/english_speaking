// Q&A practice sets. A set is several questions answered in one session, like the
// research speaking test. Teachers write one question per line in Materials, so the
// number of lines decides how many questions the set has.

export const QA_MAX_QUESTIONS = 10; // keep in step with the backend (utils/storage.py)

// Built-in sets (keep the titles in step with BUILTIN_MATERIALS in backend/utils/export.py).
// They deliberately do not repeat the research pretest/posttest questions.
export const BUILTIN_QA_SETS = [
  {
    id: 'builtin-about-you',
    title: 'About You',
    questions: [
      'Tell me about your family.',
      'What do you usually do on weekends? Why?',
      'Describe a place you like to visit, and explain why you like it.',
    ],
  },
  {
    id: 'builtin-school-life',
    title: 'School Life',
    questions: [
      'What is your favourite subject, and why?',
      'Describe a teacher who has helped you. What did they do?',
      'If you could change one thing about your school, what would it be? Why?',
    ],
  },
  {
    id: 'builtin-opinions',
    title: 'Opinions',
    questions: [
      'Is it better to study alone or with friends? Give your reasons.',
      'Should students wear school uniforms? Give your reasons and an example.',
      'What is the best way to learn English? Give an example from your own experience.',
    ],
  },
];

/** "1. What...", "- What...", "Q2) What..." -> "What..." */
function stripNumbering(line) {
  return line.replace(/^\s*(?:Q(?:uestion)?\s*)?(?:\d{1,2}\s*[.):-]|[-*•])\s*/i, '').trim();
}

/** Material text -> list of questions (one per non-empty line, at most QA_MAX_QUESTIONS). */
export function parseQuestions(content) {
  return String(content || '')
    .split(/\r?\n/)
    .map(stripNumbering)
    .filter(Boolean)
    .slice(0, QA_MAX_QUESTIONS);
}

/** How many lines a teacher typed (to warn when it is over the limit). */
export function countQuestionLines(content) {
  return String(content || '').split(/\r?\n/).map(stripNumbering).filter(Boolean).length;
}

/** custom_materials rows (mode 'qa') + built-in sets -> [{ id, title, questions }] */
export function buildQaSets(materials = []) {
  const custom = (materials || [])
    .map((m, idx) => ({ id: m.id, title: m.title || `Question set ${idx + 1}`, questions: parseQuestions(m.content) }))
    .filter((s) => s.questions.length > 0);
  return [...custom, ...BUILTIN_QA_SETS];
}
