import React, { useState } from 'react';
import { Plus, ChevronRight, Trash2, Edit2, Key, X, Check } from 'lucide-react';
import TimerSettings from './TimerSettings';

export function ClassesTab({
  classesList,
  selectedClass,
  setSelectedClass,
  allStudents,
  newClassName,
  setNewClassName,
  newClassCode,
  setNewClassCode,
  newGradeLevel,
  setNewGradeLevel,
  handleCreateClass,
  bulkStudentsText,
  setBulkStudentsText,
  handleBulkEnroll,
  handleUnenrollStudent,
  importing,
  importResults,
  setActionSuccess,
  setActionError,
  setImportResults,
  handleUpdateClass,
  handleDeleteClass,
  handleUpdateStudent,
  handleResetStudentPassword,
}) {
  const [editingClass, setEditingClass] = useState(false);
  const [editClassName, setEditClassName] = useState('');
  const [editClassCode, setEditClassCode] = useState('');
  const [editGradeLevel, setEditGradeLevel] = useState('');

  const [editingStudentId, setEditingStudentId] = useState(null);
  const [editStudentName, setEditStudentName] = useState('');
  const [editSchoolId, setEditSchoolId] = useState('');

  const startEditClass = () => {
    setEditClassName(selectedClass.class_name);
    setEditClassCode(selectedClass.class_code);
    setEditGradeLevel(selectedClass.grade_level || 'General');
    setEditingClass(true);
  };

  const saveEditClass = async () => {
    await handleUpdateClass(selectedClass.id, {
      class_name: editClassName,
      class_code: editClassCode,
      grade_level: editGradeLevel
    });
    setEditingClass(false);
  };

  const startEditStudent = (student) => {
    setEditStudentName(student.full_name);
    setEditSchoolId(student.school_id);
    setEditingStudentId(student.id);
  };

  const saveEditStudent = async (studentId) => {
    await handleUpdateStudent(studentId, {
      full_name: editStudentName,
      school_id: editSchoolId
    });
    setEditingStudentId(null);
  };

  const classStudents = selectedClass
    ? allStudents.filter(s => s.class_id === selectedClass.id).sort((a, b) => a.full_name.localeCompare(b.full_name))
    : [];

  return (
    <div className="space-y-6">
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Wide left column: create a class, then the selected class (details + bulk enrol) */}
      <div className="lg:col-span-8 space-y-6">
        {/* Create Class */}
        <div className="bg-surface border border-line p-6 rounded-2xl border border-line space-y-4">
          <h3 className="font-bold text-base text-ink">Create a class</h3>
          <form onSubmit={handleCreateClass} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-xs font-bold text-ink-muted block mb-1">Class Name</label>
              <input
                type="text"
                required
                value={newClassName}
                onChange={e => setNewClassName(e.target.value)}
                placeholder="e.g. Grade 10 English A"
                className="w-full px-4 py-2.5 bg-surface border border-line-strong rounded-[10px] text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand-ring transition-all text-sm font-medium"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-ink-muted block mb-1">Class Code</label>
              <input
                type="text"
                required
                value={newClassCode}
                onChange={e => setNewClassCode(e.target.value)}
                placeholder="e.g. G10ENGA"
                className="w-full px-4 py-2.5 bg-surface border border-line-strong rounded-[10px] text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand-ring transition-all text-sm font-medium"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-ink-muted block mb-1">Grade Level</label>
              <select
                required
                value={newGradeLevel}
                onChange={e => setNewGradeLevel(e.target.value)}
                className="w-full px-4 py-2.5 bg-surface border border-line-strong rounded-[10px] text-ink focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand-ring transition-all text-sm font-medium"
              >
                <option value="General">General</option>
                <option value="Grade 10">Grade 10</option>
                <option value="Grade 11">Grade 11</option>
                <option value="Grade 12">Grade 12</option>
              </select>
            </div>
            <button
              type="submit"
              className="sm:col-span-3 sm:justify-self-start sm:w-auto sm:px-6 w-full min-h-[44px] bg-brand hover:bg-brand-hover text-white rounded-[10px] text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Create Class</span>
            </button>
          </form>
        </div>

        {selectedClass ? (
          <div className="bg-surface border border-line p-6 rounded-2xl border border-line space-y-6">
            <div className="border-b border-line pb-4 flex justify-between items-start">
              <div>
                <span className="text-xs text-brand-ink font-bold">Enroll Students In</span>
                {editingClass ? (
                  <div className="mt-2 space-y-2">
                    <input 
                      type="text" 
                      value={editClassName} 
                      onChange={e => setEditClassName(e.target.value)} 
                      className="w-full px-3 py-1.5 bg-surface border border-line-strong rounded-lg text-ink text-sm focus:border-brand outline-none" 
                      placeholder="Class Name"
                    />
                    <div className="flex space-x-2">
                      <input 
                        type="text" 
                        value={editClassCode} 
                        onChange={e => setEditClassCode(e.target.value)} 
                        className="w-1/2 px-3 py-1.5 bg-surface border border-line-strong rounded-lg text-ink text-sm focus:border-brand outline-none" 
                        placeholder="Class Code"
                      />
                      <select 
                        value={editGradeLevel} 
                        onChange={e => setEditGradeLevel(e.target.value)} 
                        className="w-1/2 px-3 py-1.5 bg-surface border border-line-strong rounded-lg text-ink text-sm focus:border-brand outline-none"
                      >
                        <option value="General">General</option>
                        <option value="Grade 10">Grade 10</option>
                        <option value="Grade 11">Grade 11</option>
                        <option value="Grade 12">Grade 12</option>
                      </select>
                    </div>
                    <div className="flex space-x-2 mt-2">
                      <button onClick={saveEditClass} className="p-1.5 bg-success-tint hover:brightness-95 text-success rounded-lg"><Check size={16} /></button>
                      <button onClick={() => setEditingClass(false)} className="p-1.5 bg-surface-muted hover:bg-line text-ink-muted rounded-lg"><X size={16} /></button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h3 className="text-xl font-bold text-ink mt-0.5">{selectedClass.class_name}</h3>
                    <p className="text-xs text-ink-subtle mt-1 tabular-nums">
                      Class Code: <span className="text-brand-ink font-bold bg-surface border border-line px-2 py-0.5 rounded text-xs">{selectedClass.class_code}</span> | Grade: <span className="text-brand-ink font-bold bg-surface border border-line px-2 py-0.5 rounded text-xs">{selectedClass.grade_level || 'General'}</span>
                    </p>
                  </>
                )}
              </div>
              
              {!editingClass && (
                <div className="flex space-x-2">
                  <button onClick={startEditClass} className="p-2 bg-surface-muted hover:bg-line text-ink-muted rounded-lg transition" title="Edit Class">
                    <Edit2 size={16} />
                  </button>
                  <button onClick={() => handleDeleteClass(selectedClass.id, selectedClass.class_name)} className="p-2 bg-danger-tint hover:bg-danger-tint text-danger rounded-lg transition" title="Delete Class">
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>

            {/* Speaking / preparation times for this class */}
            <TimerSettings selectedClass={selectedClass} handleUpdateClass={handleUpdateClass} />

            {/* Import Forms */}
            <form onSubmit={handleBulkEnroll} className="space-y-4">
              <div className="space-y-1.5 text-left">
                <label className="text-xs font-bold text-ink-muted block">
                  Bulk paste student list (Format: Name,SchoolID)
                </label>
                <textarea
                  required
                  rows={6}
                  value={bulkStudentsText}
                  onChange={e => setBulkStudentsText(e.target.value)}
                  placeholder={"John Doe,SD-10492\nJane Smith,SD-10519\nMichael Johnson,SD-10928"}
                  className="w-full px-4 py-3 bg-surface border border-line-strong rounded-[10px] text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand-ring transition-all text-sm tabular-nums leading-relaxed"
                />
                <p className="text-xs text-ink-subtle italic">
                  Enter one student per line. Password will default to their School ID. Emails will generate as student_[SchoolID]@[ClassCode].HreFSpeak.com.
                </p>
              </div>

              <button
                type="submit"
                disabled={importing}
                className="w-full min-h-[44px] bg-brand hover:bg-brand-hover text-white rounded-[10px] text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {importing ? 'Importing Accounts...' : 'Bulk Enroll Students'}
              </button>
            </form>

            {/* Import results summary */}
            {importResults && (
              <div className="p-4 bg-surface border border-line rounded-xl space-y-2 animate-fadeIn text-xs">
                <h4 className="font-bold text-ink">Import Log:</h4>
                <p className="text-success font-semibold">&bull; Successfully created {importResults.successCount} accounts.</p>
                {importResults.failures.length > 0 && (
                  <div className="space-y-1 mt-2">
                    <p className="text-danger font-semibold">&bull; Failed to enroll {importResults.failures.length} student(s):</p>
                    <div className="pl-3 space-y-1 max-h-32 overflow-y-auto pr-1">
                      {importResults.failures.map((f, i) => (
                        <p key={i} className="text-danger tabular-nums text-xs">{f}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        ) : (
          <div className="bg-surface border border-line p-10 rounded-2xl border border-line text-center text-ink-subtle">
            Select a class from the list, or create a new one above, to enrol students.
          </div>
        )}
      </div>

      {/* Narrow right column: the class list (first on phones, so a class can be picked) */}
      <div className="lg:col-span-4 order-first lg:order-none lg:sticky lg:top-6">
        {/* Classes list */}
        <div className="bg-surface border border-line p-6 rounded-2xl border border-line space-y-4">
          <h3 className="font-bold text-base text-ink">My classes ({classesList.length})</h3>
          {classesList.length === 0 ? (
            <p className="text-ink-subtle text-xs italic py-6">No classes created yet.</p>
          ) : (
            <div className="space-y-2 max-h-[420px] lg:max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
              {classesList.map(item => (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelectedClass(item);
                    setActionSuccess('');
                    setActionError('');
                    setImportResults(null);
                  }}
                  className={`w-full p-4 rounded-xl border text-left flex justify-between items-center transition ${
                    selectedClass?.id === item.id
                      ? 'bg-brand-tint border-brand text-ink shadow-sm'
                      : 'bg-surface-muted border-line hover:bg-surface-muted text-ink-muted hover:text-ink'
                  }`}
                >
                  <div>
                    <span className="font-bold text-sm block">{item.class_name}</span>
                    <span className="text-xs opacity-80 block tabular-nums mt-0.5">
                      Code: <strong className="text-brand-ink font-bold ">{item.class_code}</strong> | Grade: <strong className="text-brand-ink font-bold">{item.grade_level || 'General'}</strong>
                    </span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <span className="text-xs px-2 py-0.5 bg-surface border border-line rounded text-ink-muted font-semibold tabular-nums">
                      {allStudents.filter(s => s.class_id === item.id).length} students
                    </span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>

      {/* Enrolled students: full width under the class panels */}
      {selectedClass && (
            <div className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-6 space-y-4">
              <h3 className="font-bold text-base text-ink flex flex-wrap items-center gap-2">
                Students in {selectedClass.class_name} ({classStudents.length})
                <span className="text-xs font-semibold bg-surface-muted px-2.5 py-1 rounded-full">
                  <span className="text-warning">{allStudents.filter(s => s.class_id === selectedClass.id && s.requires_password_change).length} New</span>
                  <span className="text-ink-subtle mx-1.5">•</span>
                  <span className="text-success">{allStudents.filter(s => s.class_id === selectedClass.id && !s.requires_password_change).length} Ready</span>
                </span>
              </h3>
              {allStudents.filter(s => s.class_id === selectedClass.id).length === 0 ? (
                <p className="text-ink-subtle text-xs italic">No students registered in this class.</p>
              ) : (
                <div className="overflow-x-auto border border-line rounded-xl max-h-[640px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-surface-muted text-ink-muted text-[13px] border-b border-line sticky top-0">
                        <th className="py-3 px-4">Student Name</th>
                        <th className="py-3 px-4">School ID</th>
                        <th className="py-3 px-4">Initial Login Email</th>
                        <th className="py-3 px-4 text-center">Status</th>
                        <th className="py-3 px-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line text-ink-muted">
                      {classStudents.map(student => (
                        <tr key={student.id} className="hover:bg-surface-muted">
                          <td className="py-3 px-4 font-semibold text-ink">{student.full_name}</td>
                          <td className="py-3 px-4 tabular-nums">{student.school_id}</td>
                          <td className="py-3 px-4 tabular-nums text-ink-subtle">{`student_${student.school_id.replace(/[^a-zA-Z0-9]/g, '')}@${selectedClass.class_code}.HreFSpeak.com`.toLowerCase()}</td>
                          <td className="py-3 px-4 text-center">
                            {student.requires_password_change ? (
                              <span className="px-2 py-0.5 bg-warning-tint text-warning border border-warning/30 rounded-[4px] text-xs font-semibold">New</span>
                            ) : (
                              <span className="px-2 py-0.5 bg-success-tint text-success border border-success/30 rounded-[4px] text-xs font-semibold">Ready</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex justify-center space-x-2">
                              <button
                                onClick={() => startEditStudent(student)}
                                className="p-1.5 bg-surface-muted hover:bg-line border border-line rounded-lg text-ink-muted transition cursor-pointer"
                                title={`Edit ${student.full_name}`}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleResetStudentPassword(student.id, student.school_id, student.full_name, selectedClass.id)}
                                className="p-1.5 bg-warning-tint hover:bg-warning-tint border border-warning/30 hover:border-warning/30 rounded-lg text-warning transition cursor-pointer"
                                title={`Reset Password for ${student.full_name}`}
                              >
                                <Key className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleUnenrollStudent(student.id, student.full_name, selectedClass.id)}
                                className="p-1.5 bg-danger-tint hover:bg-danger-tint border border-danger/30 hover:border-danger/30 rounded-lg text-danger hover:text-danger transition cursor-pointer"
                                title={`Remove ${student.full_name}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
      )}

      {/* Edit Student Modal */}
      {editingStudentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(16_24_40/0.5)] p-4">
          <div className="bg-surface border border-line rounded-2xl w-full max-w-md shadow-2xl overflow-hidden relative">
            <div className="p-6 border-b border-line flex justify-between items-center">
              <h3 className="font-bold text-ink text-lg">Edit Student Profile</h3>
              <button onClick={() => setEditingStudentId(null)} className="text-ink-muted hover:text-ink transition">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-ink-muted block mb-1">Student Name</label>
                <input 
                  type="text" 
                  value={editStudentName} 
                  onChange={e => setEditStudentName(e.target.value)} 
                  className="w-full px-4 py-2.5 bg-surface border border-line-strong rounded-[10px] text-ink text-sm focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand-ring transition-all" 
                  placeholder="Full Name"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-ink-muted block mb-1">School ID</label>
                <input 
                  type="text" 
                  value={editSchoolId} 
                  onChange={e => setEditSchoolId(e.target.value)} 
                  className="w-full px-4 py-2.5 bg-surface border border-line-strong rounded-[10px] text-ink text-sm tabular-nums focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand-ring transition-all" 
                  placeholder="School ID"
                />
              </div>
            </div>
            <div className="p-6 border-t border-line bg-surface flex justify-end space-x-3">
              <button 
                onClick={() => setEditingStudentId(null)}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-ink-muted hover:text-ink bg-surface-muted hover:bg-line transition"
              >
                Cancel
              </button>
              <button 
                onClick={() => saveEditStudent(editingStudentId)}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-brand hover:bg-brand-hover shadow-md transition flex items-center space-x-2"
              >
                <Check size={16} />
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
