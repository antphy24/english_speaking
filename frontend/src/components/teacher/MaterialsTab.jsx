import React, { useState, useMemo } from 'react';
import { Trash2, Edit2, X, Check } from 'lucide-react';
import ReadingLengthHint from '../UI/ReadingLengthHint';
import { MODE_LABELS, MODE_ORDER } from '../../utils/modes';

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

  // Filters for the materials list
  const [filterMode, setFilterMode] = useState('all');
  const [filterClass, setFilterClass] = useState('all'); // 'all' | 'global' | class id
  const [filterText, setFilterText] = useState('');

  const visibleMaterials = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return groupedMaterials.filter((g) => {
      if (filterMode !== 'all' && g.mode !== filterMode) return false;
      if (filterClass === 'global' && !g.isGlobal) return false;
      if (filterClass !== 'all' && filterClass !== 'global') {
        if (g.isGlobal || !g.materials.some((m) => String(m.class_id) === String(filterClass))) return false;
      }
      if (q && !`${g.title || ''} ${g.content || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [groupedMaterials, filterMode, filterClass, filterText]);

  const modeCounts = useMemo(() => {
    const c = {};
    groupedMaterials.forEach((g) => { c[g.mode] = (c[g.mode] || 0) + 1; });
    return c;
  }, [groupedMaterials]);

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
      <div className="lg:col-span-5 bg-surface border border-line p-6 rounded-2xl border border-line space-y-4">
        <h3 className="font-bold text-base text-ink">Add Class Material</h3>
        
        <form onSubmit={handleCreateMaterial} className="space-y-4">
          {/* Admin Mode Toggle */}
          {teacher?.is_admin && (
            <div className="space-y-1 text-left">
              <label className="text-xs font-bold text-ink-muted block">Target Type</label>
              <div className="flex space-x-4">
                <label className="flex items-center space-x-2 text-xs">
                  <input
                    type="radio"
                    value="class"
                    checked={materialCreationMode === 'class'}
                    onChange={() => setMaterialCreationMode('class')}
                    className="text-brand-ink bg-surface-muted border-line"
                  />
                  <span>Custom Class Material</span>
                </label>
                <label className="flex items-center space-x-2 text-xs">
                  <input
                    type="radio"
                    value="global"
                    checked={materialCreationMode === 'global'}
                    onChange={() => setMaterialCreationMode('global')}
                    className="text-brand-ink bg-surface-muted border-line"
                  />
                  <span>Global Default Material</span>
                </label>
              </div>
            </div>
          )}

          {/* Class or Grade Dropdown */}
          {materialCreationMode === 'class' ? (
            <div className="space-y-2 text-left">
              <label className="text-xs font-bold text-ink-muted block flex justify-between items-center">
                <span>Target Classrooms</span>
                <span className="text-brand-ink lowercase font-normal">{selectedClassesMaterial.length} selected</span>
              </label>
              <div className="max-h-32 overflow-y-auto space-y-1 bg-surface-muted border border-line rounded-xl p-2">
                {classesList.length === 0 ? (
                  <div className="text-xs text-ink-subtle p-2">No classes available</div>
                ) : (
                  classesList.map(c => (
                    <label key={c.id} className="flex items-center space-x-2 text-xs text-ink-muted hover:bg-line p-1.5 rounded cursor-pointer transition">
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
                        className="text-brand-ink bg-surface border-line rounded"
                      />
                      <span className="truncate">{c.class_name} <span className="text-xs text-ink-subtle">({c.grade_level || 'General'})</span></span>
                    </label>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-1 text-left">
              <label className="text-xs font-bold text-ink-muted block">Target Grade Level</label>
              <select
                value={globalGradeLevel}
                onChange={e => setGlobalGradeLevel(e.target.value)}
                className="w-full px-4 py-2.5 bg-surface border border-line-strong rounded-[10px] text-ink focus:outline-none focus:border-brand transition text-sm"
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
            <label className="text-xs font-bold text-ink-muted block">Practice Mode</label>
            <select
              value={materialMode}
              onChange={e => {
                setMaterialMode(e.target.value);
                setActionError('');
                setActionSuccess('');
              }}
              className="w-full px-4 py-2.5 bg-surface border border-line-strong rounded-[10px] text-ink focus:outline-none focus:border-brand transition text-sm"
            >
              {MODE_ORDER.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
            </select>
          </div>

          {/* Title input (Hidden for Conversation mode since it's hardcoded) */}
          {materialMode !== 'conversation' && (
            <div className="space-y-1 text-left animate-fadeIn">
              <label className="text-xs font-bold text-ink-muted block">Material Title</label>
              <input
                type="text"
                required
                value={materialTitle}
                onChange={e => setMaterialTitle(e.target.value)}
                placeholder={materialMode === 'read_aloud' ? "e.g. Tech Essay (Hard)" : materialMode === 'debate' ? "e.g. AI in Education" : materialMode === 'mattering' ? "e.g. Phones in School" : "e.g. Hobbies Topic"}
                className="w-full px-4 py-2.5 bg-surface border border-line-strong rounded-[10px] text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand transition text-sm"
              />
            </div>
          )}

          {/* Content text-area */}
          <div className="space-y-1 text-left">
            <label className="text-xs font-bold text-ink-muted block">
              {materialMode === 'read_aloud' && 'Paragraph Text (to read aloud)'}
              {materialMode === 'qa' && 'Question prompt'}
              {materialMode === 'conversation' && 'AI Tutor Greeting & Context'}
              {materialMode === 'debate' && 'Debate Motion Statement'}
              {materialMode === 'mattering' && 'Motion (first line) + Background (optional)'}
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
                  : materialMode === 'mattering'
                  ? "This House would ban smartphones in schools.\nMany schools now collect phones in the morning. Supporters point to distraction; critics point to safety and digital skills..."
                  : "Hello! Today let's discuss your hobbies. What is something you enjoy doing in your free time?"
              }
              className="w-full px-4 py-3 bg-surface border border-line-strong rounded-[10px] text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand transition text-sm font-medium leading-relaxed"
            />
            {materialMode === 'read_aloud' && <ReadingLengthHint text={materialContent} />}
            {materialMode === 'mattering' && (
              <p className="text-xs text-ink-subtle leading-relaxed">
                Put the motion on the first line. Anything on the lines below is shown to students as background reading before they start.
              </p>
            )}
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-brand hover:bg-brand-hover text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer"
          >
            Add Material
          </button>
        </form>
      </div>

      {/* Right col: Materials List */}
      <div className="lg:col-span-7 bg-surface border border-line p-5 md:p-6 rounded-2xl shadow-card space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-bold text-base text-ink">Your materials</h3>
          <span className="text-[13px] text-ink-subtle">
            {visibleMaterials.length === groupedMaterials.length
              ? `${groupedMaterials.length} in total`
              : `Showing ${visibleMaterials.length} of ${groupedMaterials.length}`}
          </span>
        </div>

        {/* Mode filter chips */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by mode">
          {['all', ...MODE_ORDER].map((m) => {
            const active = filterMode === m;
            const count = m === 'all' ? groupedMaterials.length : (modeCounts[m] || 0);
            return (
              <button
                key={m}
                type="button"
                onClick={() => setFilterMode(m)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-sm transition-colors ${
                  active ? 'bg-brand-tint border-brand text-brand-ink font-semibold' : 'bg-surface border-line-strong text-ink-muted hover:bg-surface-muted'
                }`}
              >
                {m === 'all' ? 'All' : MODE_LABELS[m]}
                <span className="text-xs tabular-nums opacity-75">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="search"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search title or text"
            aria-label="Search materials"
            className="w-full min-h-[40px] px-3 bg-surface border border-line-strong rounded-[10px] text-ink text-sm placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand-ring"
          />
          <select
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            aria-label="Filter by class"
            className="w-full min-h-[40px] px-3 bg-surface border border-line-strong rounded-[10px] text-ink text-sm focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand-ring"
          >
            <option value="all">All classes</option>
            <option value="global">Global materials only</option>
            {classesList.map((c) => (
              <option key={c.id} value={c.id}>{c.class_name}</option>
            ))}
          </select>
        </div>

        {groupedMaterials.length === 0 ? (
          <p className="text-ink-subtle text-sm py-16 text-center">No materials yet. Add one with the form.</p>
        ) : visibleMaterials.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <p className="text-ink-muted text-sm">No materials match these filters.</p>
            <button
              type="button"
              onClick={() => { setFilterMode('all'); setFilterClass('all'); setFilterText(''); }}
              className="text-sm font-semibold text-brand-ink hover:underline underline-offset-4"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
            {visibleMaterials.map((group) => (
              <div key={group.id} className="p-4 rounded-xl bg-surface border border-line flex justify-between items-start gap-4">
                {editingGroupId === group.id ? (
                  <div className="w-full space-y-3">
                    {group.mode !== 'conversation' && (
                      <input 
                        type="text" 
                        value={editTitle} 
                        onChange={e => setEditTitle(e.target.value)} 
                        className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-ink text-sm focus:border-brand outline-none" 
                        placeholder="Material Title"
                      />
                    )}
                    <textarea
                      rows={4}
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-ink text-sm focus:border-brand outline-none"
                    />
                    {group.mode === 'read_aloud' && <ReadingLengthHint text={editContent} />}
                    
                    {!group.isGlobal && (
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-ink-muted block flex justify-between items-center">
                          <span>Assigned Classes</span>
                          <span className="text-brand-ink lowercase font-normal">{editClassIds.length} selected</span>
                        </label>
                        <div className="max-h-28 overflow-y-auto space-y-1 bg-surface border border-line rounded-lg p-2">
                          {classesList.map(c => (
                            <label key={c.id} className="flex items-center space-x-2 text-xs text-ink-muted hover:bg-line p-1.5 rounded cursor-pointer transition">
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
                                className="text-brand-ink bg-surface-muted border-line rounded"
                              />
                              <span className="truncate">{c.class_name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end space-x-2 pt-2">
                      <button onClick={() => saveEditMaterialGroup(group)} className="p-1.5 bg-success-tint hover:brightness-95 text-success rounded-lg flex items-center space-x-1 text-xs px-3"><Check size={14} /> <span>Save</span></button>
                      <button onClick={() => setEditingGroupId(null)} className="p-1.5 bg-surface-muted hover:bg-line text-ink-muted rounded-lg flex items-center space-x-1 text-xs px-3"><X size={14} /> <span>Cancel</span></button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                        <span className="inline-flex items-center h-6 px-2 bg-brand-tint text-brand-ink rounded-md text-xs font-semibold">{MODE_LABELS[group.mode] || group.mode}</span>
                        
                        {group.isGlobal ? (
                          <span className="text-xs text-success tabular-nums bg-success-tint border border-success/30 px-2 py-0.5 rounded">Global: {group.grade_level}</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {group.classes.map(c => (
                              <span key={c.class_name} className="text-xs text-ink-muted bg-surface-muted border border-line px-1.5 py-0.5 rounded">
                                {c.class_name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <h4 className="font-bold text-ink text-sm truncate">{group.title}</h4>
                      <p className="text-xs text-ink-muted line-clamp-3 leading-relaxed whitespace-pre-wrap">{group.content}</p>
                    </div>

                    <div className="flex flex-col space-y-2 shrink-0">
                      <button
                        onClick={() => startEditMaterialGroup(group)}
                        className="p-2 bg-surface border border-line hover:border-brand/30 hover:bg-brand-tint text-ink-subtle hover:text-brand-ink rounded-lg transition cursor-pointer"
                        title="Edit material and class assignments"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteMaterialGroup(group.materials.map(m => m.id))}
                        className="p-2 bg-surface border border-line hover:border-danger/30 hover:bg-danger-tint text-ink-subtle hover:text-danger rounded-lg transition cursor-pointer"
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
