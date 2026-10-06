import React from 'react';
import { Search, Filter, Download, FileSpreadsheet, Loader2, Info, Grid3x3, Headphones } from 'lucide-react';

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
  handleDownloadExcel,
  exporting = false,
  assessmentsCapped = false,
  passMark = 75,
  setPassMark = () => {},
  formatScoreDetails,
  onReview,
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
              <option value="mattering">Mattering</option>
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

          {/* Excel export: all matching records (built on the server) */}
          <button
            onClick={() => handleDownloadExcel('detailed')}
            disabled={exporting}
            title="Download all matching records as an Excel file, with a per-student summary sheet"
            className="flex items-center space-x-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-700/10 active:scale-95 transition cursor-pointer"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            <span>{exporting ? 'Preparing...' : 'Export Excel'}</span>
          </button>
          {/* Score matrix: students x materials, highest score, colour-coded by pass mark */}
          <div className="flex items-center rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            <label className="flex items-center gap-1.5 pl-3 pr-2 text-[11px] text-slate-400" title="Scores at or above the pass mark are green, below are red. You can also change it inside the Excel file.">
              Pass mark
              <input
                type="number"
                min={0}
                max={100}
                value={passMark}
                onChange={e => setPassMark(e.target.value)}
                className="w-12 px-1.5 py-1 bg-slate-950 border border-slate-800 rounded-md text-white text-xs text-center focus:outline-none focus:border-indigo-500"
              />
            </label>
            <button
              onClick={() => handleDownloadExcel('matrix')}
              disabled={exporting}
              title="Excel with one row per student and one column per material (highest score), colour-coded by the pass mark"
              className="flex items-center space-x-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-bold transition cursor-pointer"
            >
              <Grid3x3 className="w-3.5 h-3.5" />
              <span>Score Matrix</span>
            </button>
          </div>
          <button
            onClick={handleDownloadCSV}
            title="Quick CSV of the records shown on screen"
            className="flex items-center space-x-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {assessmentsCapped && (
        <div className="flex items-start space-x-2 p-3 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-200 text-xs">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Showing the {allAssessments.length.toLocaleString()} most recent records. There are more in this period -
            use <strong>Export Excel</strong> to get all of them, or choose a shorter period.
          </span>
        </div>
      )}

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
                  <th className="py-3.5 pl-6 pr-2">Review</th>
                  <th className="py-3.5 px-6">Student</th>
                  <th className="py-3.5 px-6">School ID</th>
                  <th className="py-3.5 px-6">Class</th>
                  <th className="py-3.5 px-6">Material Title</th>
                  <th className="py-3.5 px-6">Date</th>
                  <th className="py-3.5 px-6">Score details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850 text-slate-300">
                {filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map(record => (
                  <tr key={record.id} className="hover:bg-slate-900/10 transition">
                    <td className="py-4 pl-6 pr-2">
                      <button
                        onClick={() => onReview?.(record)}
                        title="Open the transcript and full feedback. The recording can be played for each student's latest attempt per mode."
                        className="flex items-center space-x-1 px-2.5 py-1.5 bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/30 text-indigo-200 hover:text-white rounded-lg text-[11px] font-semibold transition cursor-pointer"
                      >
                        <Headphones className="w-3.5 h-3.5" />
                        <span>Review</span>
                      </button>
                    </td>
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
