// The one place for practice-mode names, so every screen says the same thing.
export const MODE_ORDER = ['read_aloud', 'qa', 'conversation', 'debate', 'mattering'];

export const MODE_LABELS = {
  read_aloud: 'Read Aloud',
  qa: 'Q&A',
  conversation: 'Conversation',
  debate: 'Debate',
  mattering: 'Mattering',
};

export const modeLabel = (mode) => MODE_LABELS[mode] || mode;
