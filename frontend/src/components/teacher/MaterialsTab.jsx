import React, { useState, useMemo } from 'react';
import { Trash2, Edit2, X, Check } from 'lucide-react';

export function MaterialsTab({
  teacher,
  classesList,
  selectedClassesMaterial,
  setSelectedClassesMaterial,
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
  handleDeleteMaterialGroup,
  setActionError,
  setActionSuccess,
  handleUpdateMaterialGroup,
}) {
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editClassIds, setEditClassIds] = useState([]);

  const groupedMaterials = useMemo(() => {
    const groups = {};
    customMaterials.forEach(m => {
      if (m.class_id === null) {
        // Global material
        groups[`global-${m.id}`] = {
          isGlobal: true,
          id: m.id,
          grade_level: m.grade_level,
          mode: m.mode,
          title: m.title,
          content: m.content,
          materials: [m]
        };
      } else {
        const key = `${m.mode}|${m.title}|${m.content}`;
        if (!groups[key]) {
          groups[key] = {
            isGlobal: false,
            id: m.id, // primary id for key
            mode: m.mode,
            title: m.title,
            content: m.content,
            classes: [],
            materials: []
          };
        }
        // avoid duplicates if same class is added twice (shouldn't happen but safe)
        if (!groups[key].classes.find(c => c.class_name === m.class?.class_name)) {
            groups[key].classes.push(m.class || { class_name: 'Unknown Class' });
        }
        groups[key].materials.push(m);
      }
    });
    return Object.values(groups);
  }, [customMaterials]);

  const startEditMaterialGroup = (group) => {
    setEditTitle(group.title);
    setEditContent(group.content);
    setEditingGroupId(group.id);
    if (!group.isGlobal) {
      setEditClassIds(group.materials.map(m => m.class_id));
    } else {
      setEditClassIds([]);
    }
  };

  const saveEditMaterialGroup = async (group) => {
    if (!group.isGlobal && editClassIds.length === 0) {
      setActionError("A material must be assigned to at least one class.");
      return;
    }
    await handleUpdateMaterialGroup(
      group.materials,
      {
        title: editTitle,
        content: editContent
      },
      group.isGlobal ? null : editClassIds
    );
    setEditingGroupId(null);
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
            <div className="space-y-2 text-left">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block flex justify-between items-center">
                <span>Target Classrooms</span>
                <span className="text-indigo-400 lowercase font-normal">{selectedClassesMaterial.length} selected</span>
              </label>
              <div className="max-h-32 overflow-y-auto space-y-1 bg-slate-900 border border-slate-800 rounded-xl p-2">
                {classesList.length === 0 ? (
                  <div className="text-xs text-slate-500 p-2">No classes available</div>
                ) : (
                  classesList.map(c => (
                    <label key={c.id} className="flex items-center space-x-2 text-xs text-slate-300 hover:bg-slate-800 p-1.5 rounded cursor-pointer transition">
                      <input 
                        type="checkbox" 
                        checked={selectedClassesMaterial.includes(c.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedClassesMaterial(prev => [...prev, c.id]);
                          } else {
                            setSelectedClassesMaterial(prev => prev.filter(id => id !== c.id));
                          }
                        }}
                        className="text-indigo-500 bg-slate-950 border-slate-700 rounded"
                      />
                      <span className="truncate">{c.class_name} <span className="text-[10px] text-slate-500">({c.grade_level || 'General'})</span></span>
                    </label>
                  ))
                )}
              </div>
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
        
        {groupedMaterials.length === 0 ? (
          <p className="text-slate-500 text-xs italic py-16 text-center">No custom materials created yet.</p>
        ) : (
          <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
            {groupedMaterials.map((group) => (
              <div key={group.id} className="p-4 rounded-xl bg-slate-900/50 border border-slate-850 flex justify-between items-start gap-4">
                {editingGroupId === group.id ? (
                  <div className="w-full space-y-3">
                    {group.mode !== 'conversation' && group.mode !== 'debate' && (
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
                    
                    {!group.isGlobal && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block flex justify-between items-center">
                          <span>Assigned Classes</span>
                          <span className="text-indigo-400 lowercase font-normal">{editClassIds.length} selected</span>
                        </label>
                        <div className="max-h-28 overflow-y-auto space-y-1 bg-slate-950 border border-slate-800 rounded-lg p-2">
                          {classesList.map(c => (
                            <label key={c.id} className="flex items-center space-x-2 text-xs text-slate-300 hover:bg-slate-800 p-1.5 rounded cursor-pointer transition">
                              <input 
                                type="checkbox" 
                                checked={editClassIds.includes(c.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setEditClassIds(prev => [...prev, c.id]);
                                  } else {
                                    setEditClassIds(prev => prev.filter(id => id !== c.id));
                                  }
                                }}
                                className="text-indigo-500 bg-slate-900 border-slate-700 rounded"
                              />
                              <span className="truncate">{c.class_name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end space-x-2 pt-2">
                      <button onClick={() => saveEditMaterialGroup(group)} className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg flex items-center space-x-1 text-xs px-3"><Check size={14} /> <span>Save</span></button>
                      <button onClick={() => setEditingGroupId(null)} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg flex items-center space-x-1 text-xs px-3"><X size={14} /> <span>Cancel</span></button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                        {group.mode === 'read_aloud' && <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded text-[9px] font-bold uppercase tracking-wider">Read Aloud</span>}
                        {group.mode === 'qa' && <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded text-[9px] font-bold uppercase tracking-wider">Q&A Mock</span>}
                        {group.mode === 'conversation' && <span className="px-2 py-0.5 bg-pink-500/10 text-pink-400 border border-pink-500/20 rounded text-[9px] font-bold uppercase tracking-wider">AI Dialogue</span>}
                        {group.mode === 'debate' && <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded text-[9px] font-bold uppercase tracking-wider">Debate</span>}
                        
                        {group.isGlobal ? (
                          <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">Global: {group.grade_level}</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {group.classes.map(c => (
                              <span key={c.class_name} className="text-[9px] text-slate-400 bg-slate-800/80 border border-slate-700 px-1.5 py-0.5 rounded">
                                {c.class_name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <h4 className="font-bold text-white text-sm truncate">{group.title}</h4>
                      <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed whitespace-pre-wrap">{group.content}</p>
                    </div>

                    <div className="flex flex-col space-y-2 shrink-0">
                      <button
                        onClick={() => startEditMaterialGroup(group)}
                        className="p-2 bg-slate-950 border border-slate-850 hover:border-indigo-900/50 hover:bg-indigo-950/20 text-slate-500 hover:text-indigo-400 rounded-lg transition cursor-pointer"
                        title="Edit material and class assignments"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteMaterialGroup(group.materials.map(m => m.id))}
                        className="p-2 bg-slate-950 border border-slate-850 hover:border-rose-900/50 hover:bg-rose-950/20 text-slate-500 hover:text-rose-400 rounded-lg transition cursor-pointer"
                        title="Delete material from all classes"
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
