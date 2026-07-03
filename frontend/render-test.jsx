import React from 'react';
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

try {
  const html = renderToString(
    <MemoryRouter>
      <PracticeArea />
    </MemoryRouter>
  );
  console.log("RENDER SUCCESS!");
} catch (e) {
  console.error("RENDER ERROR:", e);
}
