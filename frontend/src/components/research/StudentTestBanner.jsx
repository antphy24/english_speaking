import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, ChevronRight } from 'lucide-react';
import { supabaseStudent } from '../../utils/supabaseClient';
import { researchRequest } from '../../utils/researchApi';

/** Shows open speaking tests (Research Test mode) at the top of the practice area. */
export default function StudentTestBanner({ studentId }) {
  const navigate = useNavigate();
  const [tests, setTests] = useState([]);

  useEffect(() => {
    if (!studentId) return undefined;
    let cancelled = false;
    researchRequest(supabaseStudent, '/my-tests', { retries: 1 })
      .then((list) => { if (!cancelled) setTests(list.filter((t) => t.status !== 'done')); })
      .catch(() => { /* the practice area works without it */ });
    return () => { cancelled = true; };
  }, [studentId]);

  if (!tests.length) return null;
  return (
    <div className="space-y-2.5">
      {tests.map((t) => (
        <button key={t.test_id} type="button" onClick={() => navigate(`/speaking-test/${t.test_id}`)}
                className="w-full flex items-center gap-4 text-left bg-warning-tint border border-warning/30 hover:border-warning/60 rounded-2xl px-4 py-3.5 md:px-5 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-ring">
          <span className="w-10 h-10 rounded-full bg-surface text-warning flex items-center justify-center shrink-0">
            <ClipboardCheck className="w-5 h-5" aria-hidden="true" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-semibold text-ink">{t.title}</span>
            <span className="block text-sm text-ink-muted">
              {t.status === 'in_progress' ? 'Continue your speaking test' : 'Your teacher opened a speaking test for you'} · about {t.minutes} min
            </span>
          </span>
          <ChevronRight className="w-5 h-5 text-warning shrink-0" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
