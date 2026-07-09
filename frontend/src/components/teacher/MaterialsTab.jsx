import React, { useState } from 'react';
import { Trash2, Edit2, X, Check } from 'lucide-react';

export function MaterialsTab({
  teacher,
  classesList,
  selectedClassMaterial,
  setSelectedClassMaterial,
  materialCreationMode,
  setMaterialCreationMode,
  globalGradeLevel,
  setGlobalGradeLevel,
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
  handleUpdateMaterial,
}) {
  const [editingMaterialId, setEditingMaterialId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  const startEditMaterial = (material) => {
    setEditTitle(material.title);
    setEditContent(material.content);
    setEditingMaterialId(material.id);
  };

  const saveEditMaterial = async (materialId) => {
    await handleUpdateMaterial(materialId, {
      title: editTitle,
      content: editContent
    });
    setEditingMaterialId(null);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start animate-fadeIn">
      {/* Left col: Add Material */}
      <div className="lg:col-span-5 glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
        <h3 className="font-bold text-base text-white">Add Class Material</h3>
        
        <form onSubmit={handleCreateMaterial} className="space-y-4">
          {/* Admin Mode Toggle */}
          {teacher?.is_admin && (
            <div className="space-y-1 text-left">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Target Type</label>
              <div className="flex space-x-4">
                <label className="flex items-center space-x-2 text-xs">
                  <input
                    type="radio"
                    value="class"
                    checked={materialCreationMode === 'class'}
                    onChange={() => setMaterialCreationMode('class')}
                    className="text-indigo-500 bg-slate-900 border-slate-800"
                  />
                  <span>Custom Class Material</span>
                </label>
                <label className="flex items-center space-x-2 text-xs">
                  <input
                    type="radio"
                    value="global"
                    checked={materialCreationMode === 'global'}
                    onChange={() => setMaterialCreationMode('global')}
                    className="text-indigo-500 bg-slate-900 border-slate-800"
                  />
                  <span>Global Default Material</span>
                </label>
              </div>
            </div>
          )}

          {/* Class or Grade Dropdown */}
          {materialCreationMode === 'class' ? (
            <div className="space-y-1 text-left">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Target Classroom</label>
              <select
                value={selectedClassMaterial?.id || ''}
                onChange={e => setSelectedClassMaterial(classesList.find(c => c.id === e.target.value))}
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500 transition text-xs"
              >
                {classesList.map(c => (
                  <option key={c.id} value={c.id}>{c.class_name} (Grade: {c.grade_level || 'General'})</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1 text-left">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Target Grade Level</label>
              <select
                value={globalGradeLevel}
                onChange={e => setGlobalGradeLevel(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500 transition text-xs"
              >
                <option value="General">General</option>
                <option value="Grade 10">Grade 10</option>
                <option value="Grade 11">Grade 11</option>
                <option value="Grade 12">Grade 12</option>
              </select>
            </div>
          )}

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
              <option value="conversation">3. AI Conversation</option>
              <option value="debate">4. Debate Motion</option>
            </select>
          </div>

          {/* Title input (Hidden for Debate mode only) */}
          {materialMode !== 'debate' && (
            <div className="space-y-1 text-left animate-fadeIn">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Material Title</label>
              <input
                type="text"
                required
                value={materialTitle}
                onChange={e => setMaterialTitle(e.target.value)}
                placeholder={materialMode === 'read_aloud' ? "e.g. Tech Essay (Hard)" : materialMode === 'conversation' ? "e.g. Booking a Hotel" : "e.g. Hobbies Topic"}
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
              {materialMode === 'debate' && 'Debate Motion Statement'}
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
                  : materialMode === 'debate'
                  ? "This House would ban the use of AI in educational assessments."
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
                {editingMaterialId === material.id ? (
                  <div className="w-full space-y-3">
                    {material.mode !== 'conversation' && material.mode !== 'debate' && (
                      <input 
                        type="text" 
                        value={editTitle} 
                        onChange={e => setEditTitle(e.target.value)} 
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white text-sm focus:border-indigo-500 outline-none" 
                        placeholder="Material Title"
                      />
                    )}
                    <textarea
                      rows={4}
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white text-xs focus:border-indigo-500 outline-none"
                    />
                    <div className="flex justify-end space-x-2">
                      <button onClick={() => saveEditMaterial(material.id)} className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg flex items-center space-x-1 text-xs px-3"><Check size={14} /> <span>Save</span></button>
                      <button onClick={() => setEditingMaterialId(null)} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg flex items-center space-x-1 text-xs px-3"><X size={14} /> <span>Cancel</span></button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        {material.mode === 'read_aloud' && <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded text-[9px] font-bold uppercase tracking-wider">Read Aloud</span>}
                        {material.mode === 'qa' && <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded text-[9px] font-bold uppercase tracking-wider">Q&A Mock</span>}
                        {material.mode === 'conversation' && <span className="px-2 py-0.5 bg-pink-500/10 text-pink-400 border border-pink-500/20 rounded text-[9px] font-bold uppercase tracking-wider">AI Dialogue</span>}
                        {material.mode === 'debate' && <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded text-[9px] font-bold uppercase tracking-wider">Debate</span>}
                        {material.class_id === null ? (
                          <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">Global: {material.grade_level}</span>
                        ) : (
                          <span className="text-[10px] text-slate-500 font-mono">({material.class?.class_name})</span>
                        )}
                      </div>
                      <h4 className="font-bold text-white text-sm truncate">{material.title}</h4>
                      <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed whitespace-pre-wrap">{material.content}</p>
                    </div>

                    <div className="flex flex-col space-y-2 shrink-0">
                      <button
                        onClick={() => startEditMaterial(material)}
                        className="p-2 bg-slate-950 border border-slate-850 hover:border-indigo-900/50 hover:bg-indigo-950/20 text-slate-500 hover:text-indigo-400 rounded-lg transition cursor-pointer"
                        title="Edit material"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteMaterial(material.id)}
                        className="p-2 bg-slate-950 border border-slate-850 hover:border-rose-900/50 hover:bg-rose-950/20 text-slate-500 hover:text-rose-400 rounded-lg transition cursor-pointer"
                        title="Delete material"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
