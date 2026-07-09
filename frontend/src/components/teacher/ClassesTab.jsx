import React, { useState } from 'react';
import { Plus, ChevronRight, Trash2, Edit2, Key, X, Check } from 'lucide-react';

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Left col: Classes list & Create */}
      <div className="lg:col-span-5 space-y-6">
        {/* Create Class */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
          <h3 className="font-bold text-base text-white">Create New Classroom</h3>
          <form onSubmit={handleCreateClass} className="space-y-3">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Class Name</label>
              <input
                type="text"
                required
                value={newClassName}
                onChange={e => setNewClassName(e.target.value)}
                placeholder="e.g. Grade 10 English A"
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm font-medium"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Class Code</label>
              <input
                type="text"
                required
                value={newClassCode}
                onChange={e => setNewClassCode(e.target.value)}
                placeholder="e.g. G10ENGA"
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm font-medium"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Grade Level</label>
              <select
                required
                value={newGradeLevel}
                onChange={e => setNewGradeLevel(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm font-medium"
              >
                <option value="General">General</option>
                <option value="Grade 10">Grade 10</option>
                <option value="Grade 11">Grade 11</option>
                <option value="Grade 12">Grade 12</option>
              </select>
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center justify-center space-x-1 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Class</span>
            </button>
          </form>
        </div>

        {/* Classes list */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
          <h3 className="font-bold text-base text-white">My Classes</h3>
          {classesList.length === 0 ? (
            <p className="text-slate-500 text-xs italic py-6">No classes created yet.</p>
          ) : (
            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
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
                      ? 'bg-indigo-600/10 border-indigo-500 text-white shadow-sm'
                      : 'bg-slate-900/40 border-slate-850 hover:bg-slate-900/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div>
                    <span className="font-bold text-sm block">{item.class_name}</span>
                    <span className="text-[10px] opacity-80 block font-mono mt-0.5">
                      Code: <strong className="text-indigo-400 font-bold tracking-widest">{item.class_code}</strong> | Grade: <strong className="text-indigo-400 font-bold">{item.grade_level || 'General'}</strong>
                    </span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <span className="text-[10px] px-2 py-0.5 bg-slate-950 border border-slate-850 rounded text-slate-400 font-semibold font-mono">
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

      {/* Right col: Enrollment */}
      <div className="lg:col-span-7">
        {selectedClass ? (
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-6">
            <div className="border-b border-slate-850 pb-4 flex justify-between items-start">
              <div>
                <span className="text-[10px] text-indigo-400 uppercase tracking-widest font-bold">Enroll Students In</span>
                {editingClass ? (
                  <div className="mt-2 space-y-2">
                    <input 
                      type="text" 
                      value={editClassName} 
                      onChange={e => setEditClassName(e.target.value)} 
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-white text-sm focus:border-indigo-500 outline-none" 
                      placeholder="Class Name"
                    />
                    <div className="flex space-x-2">
                      <input 
                        type="text" 
                        value={editClassCode} 
                        onChange={e => setEditClassCode(e.target.value)} 
                        className="w-1/2 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-white text-sm focus:border-indigo-500 outline-none" 
                        placeholder="Class Code"
                      />
                      <select 
                        value={editGradeLevel} 
                        onChange={e => setEditGradeLevel(e.target.value)} 
                        className="w-1/2 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-white text-sm focus:border-indigo-500 outline-none"
                      >
                        <option value="General">General</option>
                        <option value="Grade 10">Grade 10</option>
                        <option value="Grade 11">Grade 11</option>
                        <option value="Grade 12">Grade 12</option>
                      </select>
                    </div>
                    <div className="flex space-x-2 mt-2">
                      <button onClick={saveEditClass} className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg"><Check size={16} /></button>
                      <button onClick={() => setEditingClass(false)} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg"><X size={16} /></button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h3 className="text-xl font-bold text-white mt-0.5">{selectedClass.class_name}</h3>
                    <p className="text-[11px] text-slate-500 mt-1 font-mono">
                      Class Code: <span className="text-indigo-400 font-bold bg-slate-950 border border-slate-900 px-2 py-0.5 rounded tracking-widest text-xs">{selectedClass.class_code}</span> | Grade: <span className="text-indigo-400 font-bold bg-slate-950 border border-slate-900 px-2 py-0.5 rounded tracking-widest text-xs">{selectedClass.grade_level || 'General'}</span>
                    </p>
                  </>
                )}
              </div>
              
              {!editingClass && (
                <div className="flex space-x-2">
                  <button onClick={startEditClass} className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition" title="Edit Class">
                    <Edit2 size={16} />
                  </button>
                  <button onClick={() => handleDeleteClass(selectedClass.id, selectedClass.class_name)} className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition" title="Delete Class">
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>

            {/* Import Forms */}
            <form onSubmit={handleBulkEnroll} className="space-y-4">
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Bulk paste student list (Format: Name,SchoolID)
                </label>
                <textarea
                  required
                  rows={6}
                  value={bulkStudentsText}
                  onChange={e => setBulkStudentsText(e.target.value)}
                  placeholder={"John Doe,SD-10492\nJane Smith,SD-10519\nMichael Johnson,SD-10928"}
                  className="w-full px-4 py-3 bg-slate-900/60 border border-slate-800 rounded-xl text-white placeholder-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-xs font-mono leading-relaxed"
                />
                <p className="text-[10px] text-slate-500 italic">
                  Enter one student per line. Password will default to their School ID. Emails will generate as student_[SchoolID]@[ClassCode].HreFSpeak.com.
                </p>
              </div>

              <button
                type="submit"
                disabled={importing}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition-all disabled:opacity-50 cursor-pointer"
              >
                {importing ? 'Importing Accounts...' : 'Bulk Enroll Students'}
              </button>
            </form>

            {/* Import results summary */}
            {importResults && (
              <div className="p-4 bg-slate-950 border border-slate-850 rounded-xl space-y-2 animate-fadeIn text-xs">
                <h4 className="font-bold text-slate-200">Import Log:</h4>
                <p className="text-emerald-400 font-semibold">&bull; Successfully created {importResults.successCount} accounts.</p>
                {importResults.failures.length > 0 && (
                  <div className="space-y-1 mt-2">
                    <p className="text-rose-400 font-semibold">&bull; Failed to enroll {importResults.failures.length} student(s):</p>
                    <div className="pl-3 space-y-1 max-h-32 overflow-y-auto pr-1">
                      {importResults.failures.map((f, i) => (
                        <p key={i} className="text-rose-400 font-mono text-[10px]">{f}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Enrolled Students Table */}
            <div className="border-t border-slate-850 pt-5 space-y-3">
              <h4 className="font-bold text-sm text-slate-300">Enrolled Students ({allStudents.filter(s => s.class_id === selectedClass.id).length})</h4>
              {allStudents.filter(s => s.class_id === selectedClass.id).length === 0 ? (
                <p className="text-slate-500 text-xs italic">No students registered in this class.</p>
              ) : (
                <div className="overflow-x-auto border border-slate-850 rounded-xl max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-900/40 text-slate-400 border-b border-slate-850">
                        <th className="py-2 px-4">Student Name</th>
                        <th className="py-2 px-4">School ID</th>
                        <th className="py-2 px-4">Initial Login Email</th>
                        <th className="py-2 px-4 text-center">Status</th>
                        <th className="py-2 px-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850/60 text-slate-300">
                      {allStudents.filter(s => s.class_id === selectedClass.id).map(student => (
                        <tr key={student.id} className="hover:bg-slate-900/20">
                          {editingStudentId === student.id ? (
                            <>
                              <td className="py-2 px-4">
                                <input 
                                  type="text" 
                                  value={editStudentName} 
                                  onChange={e => setEditStudentName(e.target.value)} 
                                  className="w-full px-2 py-1 bg-slate-900 border border-slate-800 rounded text-white text-xs outline-none focus:border-indigo-500" 
                                />
                              </td>
                              <td className="py-2 px-4">
                                <input 
                                  type="text" 
                                  value={editSchoolId} 
                                  onChange={e => setEditSchoolId(e.target.value)} 
                                  className="w-full px-2 py-1 bg-slate-900 border border-slate-800 rounded text-white text-xs font-mono outline-none focus:border-indigo-500" 
                                />
                              </td>
                              <td className="py-2 px-4 text-slate-500">-</td>
                              <td className="py-2 px-4 text-center">-</td>
                              <td className="py-2 px-4 text-center">
                                <div className="flex justify-center space-x-1">
                                  <button onClick={() => saveEditStudent(student.id)} className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded transition"><Check size={14} /></button>
                                  <button onClick={() => setEditingStudentId(null)} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"><X size={14} /></button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-2 px-4 font-bold text-white">{student.full_name}</td>
                              <td className="py-2 px-4 font-mono">{student.school_id}</td>
                              <td className="py-2 px-4 font-mono text-slate-500">{`student_${student.school_id.replace(/[^a-zA-Z0-9]/g, '')}@${selectedClass.class_code}.HreFSpeak.com`.toLowerCase()}</td>
                              <td className="py-2 px-4 text-center">
                                {student.requires_password_change ? (
                                  <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-[4px] text-[9px] font-semibold">New</span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-[4px] text-[9px] font-semibold">Ready</span>
                                )}
                              </td>
                              <td className="py-2 px-4 text-center">
                                <div className="flex justify-center space-x-2">
                                  <button
                                    onClick={() => startEditStudent(student)}
                                    className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-300 transition cursor-pointer"
                                    title={`Edit ${student.full_name}`}
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleResetStudentPassword(student.id, student.school_id, student.full_name, selectedClass.id)}
                                    className="p-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 hover:border-amber-500/40 rounded-lg text-amber-400 transition cursor-pointer"
                                    title={`Reset Password for ${student.full_name}`}
                                  >
                                    <Key className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleUnenrollStudent(student.id, student.full_name, selectedClass.id)}
                                    className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/40 rounded-lg text-rose-400 hover:text-rose-300 transition cursor-pointer"
                                    title={`Remove ${student.full_name}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="glass-panel p-10 rounded-2xl border border-slate-800 text-center text-slate-500">
            Create or select a classroom on the left to start enrolling students.
          </div>
        )}
      </div>
    </div>
  );
}
