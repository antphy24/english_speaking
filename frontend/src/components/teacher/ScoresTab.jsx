import React from 'react';
import { Search, Filter, Download } from 'lucide-react';

export function ScoresTab({
  classesList,
  searchQuery,
  setSearchQuery,
  selectedClassFilter,
  setSelectedClassFilter,
  selectedModeFilter,
  setSelectedModeFilter,
  selectedMaterialFilter,
  setSelectedMaterialFilter,
  allAssessments = [],
  getFilteredAssessments,
  handleDownloadCSV,
  formatScoreDetails,
  currentPage,
  setCurrentPage,
  itemsPerPage,
}) {
  const filtered = getFilteredAssessments();
  
  const uniqueMaterials = Array.from(new Set(
    allAssessments
      .map(item => item.feedback?.material_title || item.feedback?.motion || 'Default Material')
      .filter(Boolean)
  )).sort();
  
  return (
    <div className="space-y-6">
      {/* Search & Filters */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col md:flex-row justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-3.5 text-slate-600" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search student name or School ID..."
            className="w-full pl-9 pr-4 py-2.5 bg-slate-900/60 border border-slate-800 rounded-xl text-white placeholder-slate-605 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm font-medium"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Class Filter */}
          <div className="flex items-center space-x-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={selectedClassFilter}
              onChange={e => setSelectedClassFilter(e.target.value)}
              className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500 transition-all"
            >
              <option value="all">All Classes</option>
              {classesList.map(c => (
                <option key={c.id} value={c.class_name}>{c.class_name}</option>
              ))}
            </select>
          </div>

          {/* Mode Filter */}
          <div className="flex items-center space-x-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={selectedModeFilter}
              onChange={e => setSelectedModeFilter(e.target.value)}
              className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500 transition-all"
            >
              <option value="all">All Modes</option>
              <option value="read_aloud">Read Aloud</option>
              <option value="qa">Q&A Mock</option>
              <option value="conversation">AI Dialogue</option>
              <option value="debate">Debate</option>
            </select>
          </div>

          {/* Material Filter */}
          <div className="flex items-center space-x-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={selectedMaterialFilter}
              onChange={e => setSelectedMaterialFilter(e.target.value)}
              className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500 transition-all max-w-[200px] truncate"
            >
              <option value="all">All Materials</option>
              {uniqueMaterials.map((mat, i) => (
                <option key={i} value={mat}>{mat}</option>
              ))}
            </select>
          </div>

          {/* CSV Export Button */}
          <button
            onClick={handleDownloadCSV}
            className="flex items-center space-x-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-700/10 active:scale-95 transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Score table */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden flex flex-col">
        {filtered.length === 0 ? (
          <div className="py-20 text-center text-slate-500 text-xs italic">
            No assessment records match filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900/60 border-b border-slate-850 text-slate-400 font-semibold uppercase tracking-wider">
                  <th className="py-3.5 px-6">Student</th>
                  <th className="py-3.5 px-6">School ID</th>
                  <th className="py-3.5 px-6">Class</th>
                  <th className="py-3.5 px-6">Material Title</th>
                  <th className="py-3.5 px-6">Date</th>
                  <th className="py-3.5 px-6">Score details</th>
                  <th className="py-3.5 px-6">Examiner Feedback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850 text-slate-300">
                {filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map(record => (
                  <tr key={record.id} className="hover:bg-slate-900/10 transition">
                    <td className="py-4 px-6 font-bold text-white">{record.student?.full_name}</td>
                    <td className="py-4 px-6 font-mono text-[10px]">{record.student?.school_id}</td>
                    <td className="py-4 px-6">{record.student?.class?.class_name}</td>
                    <td className="py-4 px-6 text-slate-300 font-medium truncate max-w-[150px]" title={record.feedback?.material_title || record.feedback?.motion || 'Default Material'}>
                      {record.feedback?.material_title || record.feedback?.motion || 'Default Material'}
                    </td>
                    <td className="py-4 px-6 text-slate-400 font-mono text-[10px]">
                      {new Date(record.created_at).toLocaleString()}
                    </td>
                    <td className="py-4 px-6">
                      {formatScoreDetails(record.mode, record.feedback)}
                    </td>
                    <td className="py-4 px-6 max-w-xs truncate italic text-slate-400" title={record.feedback?.feedback || record.feedback}>
                      {record.feedback?.feedback || record.feedback}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > itemsPerPage && (
          <div className="flex items-center justify-between px-6 py-4 bg-slate-900/40 border-t border-slate-850">
            <span className="text-xs text-slate-400">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filtered.length)} of {filtered.length} entries
            </span>
            <div className="flex space-x-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-xs font-medium rounded-md bg-slate-800 text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={currentPage * itemsPerPage >= filtered.length}
                className="px-3 py-1 text-xs font-medium rounded-md bg-slate-800 text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
