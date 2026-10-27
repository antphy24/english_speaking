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
    <div className="mb-5 space-y-2">
      {tests.map((t) => (
        <button key={t.test_id} onClick={() => navigate(`/speaking-test/${t.test_id}`)}
                className="w-full flex items-center gap-3 text-left bg-amber-500/10 border border-amber-500/30 hover:border-amber-400/60 rounded-2xl p-4 transition">
          <ClipboardCheck className="w-6 h-6 text-amber-300 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">{t.title}</div>
            <div className="text-xs text-amber-200/80">
              {t.status === 'in_progress' ? 'Continue your speaking test' : 'Your teacher opened a speaking test for you'} · about {t.minutes} min
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-amber-300" />
        </button>
      ))}
    </div>
  );
}
