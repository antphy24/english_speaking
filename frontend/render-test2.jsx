import React, { useState } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import PracticeArea from './src/components/PracticeArea.jsx';

// Mock supabase client
jest.mock('./src/utils/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: '4821b5ee-d907-4cb7-a875-2590802ee9ee' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: '4821b5ee-d907-4cb7-a875-2590802ee9ee', full_name: 'Sari', class: { class_name: 'test' } }
          })
        }),
        or: async () => ({
          data: []
        })
      })
    })
  }
}));

// We can bypass useEffect by directly calling the component with a wrapper
function TestWrapper() {
  const [student] = useState({ id: '123', full_name: 'Sari', class: { class_name: 'test' } });
  const [loadingAuth] = useState(false);
  const [customMaterials] = useState([]);
  
  // Actually, we can't easily inject state into PracticeArea without modifying it.
  // We can just spy on it or modify PracticeArea.jsx temporarily for the test.
}

