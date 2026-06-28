import React from 'react';
import { Trash2 } from 'lucide-react';

export function MaterialsTab({
  classesList,
  selectedClassMaterial,
  setSelectedClassMaterial,
  materialMode,
  setMaterialMode,
  materialTitle,
  setMaterialTitle,
  materialContent,
  setMaterialContent,
  handleCreateMaterial,
  customMaterials,
  handleDeleteMaterial,
  setActionError,
  setActionSuccess,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start animate-fadeIn">
      {/* Left col: Add Material */}
      <div className="lg:col-span-5 glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
        <h3 className="font-bold text-base text-white">Add Class Material</h3>
        
        <form onSubmit={handleCreateMaterial} className="space-y-4">
          {/* Class Dropdown */}
          <div className="space-y-1 text-left">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Target Classroom</label>
            <select
              value={selectedClassMaterial?.id || ''}
              onChange={e => setSelectedClassMaterial(classesList.find(c => c.id === e.target.value))}
              className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500 transition text-xs"
            >
              {classesList.map(c => (
                <option key={c.id} value={c.id}>{c.class_name}</option>
              ))}
            </select>
          </div>

          {/* Mode selection dropdown */}
          <div className="space-y-1 text-left">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Practice Mode</label>
            <select
              value={materialMode}
              onChange={e => {
                setMaterialMode(e.target.value);
                setActionError('');
                setActionSuccess('');
              }}
              className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500 transition text-xs"
            >
              <option value="read_aloud">1. Read Aloud</option>
              <option value="qa">2. Q&A Mock Prompt</option>
              <option value="conversation">3. AI Conversation greeting</option>
            </select>
          </div>

          {/* Title input (Hidden for Conversation mode) */}
          {materialMode !== 'conversation' && (
            <div className="space-y-1 text-left animate-fadeIn">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Material Title</label>
              <input
                type="text"
                required
                value={materialTitle}
                onChange={e => setMaterialTitle(e.target.value)}
                placeholder={materialMode === 'read_aloud' ? "e.g. Tech Essay (Hard)" : "e.g. Hobbies Topic"}
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-650 focus:outline-none focus:border-indigo-500 transition text-xs"
              />
            </div>
          )}

          {/* Content text-area */}
          <div className="space-y-1 text-left">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              {materialMode === 'read_aloud' && 'Paragraph Text (to read aloud)'}
              {materialMode === 'qa' && 'IELTS Cue Card Prompt'}
              {materialMode === 'conversation' && 'AI Tutor Greeting & Context'}
            </label>
            <textarea
              required
              rows={6}
              value={materialContent}
              onChange={e => setMaterialContent(e.target.value)}
              placeholder={
                materialMode === 'read_aloud' 
                  ? "Paste the text you want the student to read aloud..." 
                  : materialMode === 'qa'
                  ? "Describe a memorable journey you went on. You should say where, when, and explain why it made a strong impression..."
                  : "Hello! Today let's discuss your hobbies. What is something you enjoy doing in your free time?"
              }
              className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-755 focus:outline-none focus:border-indigo-500 transition text-xs font-medium leading-relaxed"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer"
          >
            Add Material
          </button>
        </form>
      </div>

      {/* Right col: Materials List */}
      <div className="lg:col-span-7 glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
        <h3 className="font-bold text-base text-white">Current Custom Materials</h3>
        
        {customMaterials.length === 0 ? (
          <p className="text-slate-500 text-xs italic py-16 text-center">No custom materials created yet.</p>
        ) : (
          <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
            {customMaterials.map((material) => (
              <div key={material.id} className="p-4 rounded-xl bg-slate-900/50 border border-slate-850 flex justify-between items-start gap-4">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    {material.mode === 'read_aloud' && <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded text-[9px] font-bold uppercase tracking-wider">Read Aloud</span>}
                    {material.mode === 'qa' && <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded text-[9px] font-bold uppercase tracking-wider">Q&A Mock</span>}
                    {material.mode === 'conversation' && <span className="px-2 py-0.5 bg-pink-500/10 text-pink-400 border border-pink-500/20 rounded text-[9px] font-bold uppercase tracking-wider">AI Dialogue</span>}
                    <span className="text-[10px] text-slate-500 font-mono">({material.class?.class_name})</span>
                  </div>
                  <h4 className="font-bold text-white text-sm truncate">{material.title}</h4>
                  <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed whitespace-pre-wrap">{material.content}</p>
                </div>

                <button
                  onClick={() => handleDeleteMaterial(material.id)}
                  className="p-2 bg-slate-950 border border-slate-850 hover:border-rose-900/50 hover:bg-rose-950/20 text-slate-500 hover:text-rose-400 rounded-lg transition shrink-0 cursor-pointer"
                  title="Delete material"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
