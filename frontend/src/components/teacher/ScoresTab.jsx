import React from 'react';
import { Search, Filter, Download, FileSpreadsheet, Loader2, Info, Grid3x3, Headphones } from 'lucide-react';
import { MODE_LABELS, MODE_ORDER } from '../../utils/modes';

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
      <div className="bg-surface border border-line p-6 rounded-2xl border border-line flex flex-col md:flex-row justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-3.5 text-ink-subtle" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search student name or School ID..."
            className="w-full pl-9 pr-4 py-2.5 bg-surface border border-line-strong rounded-[10px] text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand-ring transition-all text-sm font-medium"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Class Filter */}
          <div className="flex items-center space-x-1.5">
            <Filter className="w-3.5 h-3.5 text-ink-subtle" />
            <select
              value={selectedClassFilter}
              onChange={e => setSelectedClassFilter(e.target.value)}
              className="px-3 py-2 bg-surface border border-line-strong rounded-[10px] text-ink text-sm focus:outline-none focus:border-brand transition-all"
            >
              <option value="all">All classes</option>
              {classesList.map(c => (
                <option key={c.id} value={c.class_name}>{c.class_name}</option>
              ))}
            </select>
          </div>

          {/* Mode Filter */}
          <div className="flex items-center space-x-1.5">
            <Filter className="w-3.5 h-3.5 text-ink-subtle" />
            <select
              value={selectedModeFilter}
              onChange={e => setSelectedModeFilter(e.target.value)}
              className="px-3 py-2 bg-surface border border-line-strong rounded-[10px] text-ink text-sm focus:outline-none focus:border-brand transition-all"
            >
              <option value="all">All modes</option>
              {MODE_ORDER.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
            </select>
          </div>

          {/* Material Filter */}
          <div className="flex items-center space-x-1.5">
            <Filter className="w-3.5 h-3.5 text-ink-subtle" />
            <select
              value={selectedMaterialFilter}
              onChange={e => setSelectedMaterialFilter(e.target.value)}
              className="px-3 py-2 bg-surface border border-line-strong rounded-[10px] text-ink text-sm focus:outline-none focus:border-brand transition-all max-w-[200px] truncate"
            >
              <option value="all">All materials</option>
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
            className="flex items-center space-x-1 px-4 py-2 bg-success hover:brightness-95 disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-lg active:scale-95 transition cursor-pointer"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            <span>{exporting ? 'Preparing...' : 'Export Excel'}</span>
          </button>
          {/* Score matrix: students x materials, highest score, colour-coded by pass mark */}
          <div className="flex items-center rounded-xl border border-line bg-surface-muted overflow-hidden">
            <label className="flex items-center gap-1.5 pl-3 pr-2 text-xs text-ink-muted" title="Scores at or above the pass mark are green, below are red. You can also change it inside the Excel file.">
              Pass mark
              <input
                type="number"
                min={0}
                max={100}
                value={passMark}
                onChange={e => setPassMark(e.target.value)}
                className="w-12 px-1.5 py-1 bg-surface border border-line-strong rounded-md text-ink text-sm text-center focus:outline-none focus:border-brand"
              />
            </label>
            <button
              onClick={() => handleDownloadExcel('matrix')}
              disabled={exporting}
              title="Excel with one row per student and one column per material (highest score), colour-coded by the pass mark"
              className="flex items-center space-x-1 px-3 py-2 bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-xs font-bold transition cursor-pointer"
            >
              <Grid3x3 className="w-3.5 h-3.5" />
              <span>Score Matrix</span>
            </button>
          </div>
          <button
            onClick={handleDownloadCSV}
            title="Quick CSV of the records shown on screen"
            className="flex items-center space-x-1 px-3 py-2 bg-surface-muted hover:bg-line text-ink-muted text-xs font-semibold rounded-xl transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {assessmentsCapped && (
        <div className="flex items-start space-x-2 p-3 rounded-xl border border-warning/30 bg-warning-tint text-warning text-xs">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Showing the {allAssessments.length.toLocaleString()} most recent records. There are more in this period -
            use <strong>Export Excel</strong> to get all of them, or choose a shorter period.
          </span>
        </div>
      )}

      {/* Score table */}
      <div className="bg-surface border border-line rounded-2xl border border-line overflow-hidden flex flex-col">
        {filtered.length === 0 ? (
          <div className="py-20 text-center text-ink-subtle text-xs italic">
            No assessment records match filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-muted border-b border-line text-ink-muted font-semibold ">
                  <th className="py-3.5 pl-6 pr-2">Review</th>
                  <th className="py-3.5 px-6">Student</th>
                  <th className="py-3.5 px-6">School ID</th>
                  <th className="py-3.5 px-6">Class</th>
                  <th className="py-3.5 px-6">Material Title</th>
                  <th className="py-3.5 px-6">Date</th>
                  <th className="py-3.5 px-6">Score details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink-muted">
                {filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map(record => (
                  <tr key={record.id} className="hover:bg-surface-muted transition">
                    <td className="py-4 pl-6 pr-2">
                      <button
                        onClick={() => onReview?.(record)}
                        title="Open the transcript and full feedback. The recording can be played for each student's latest attempt per mode."
                        className="flex items-center space-x-1 px-2.5 py-1.5 bg-brand-tint hover:bg-brand-hover border border-brand/30 text-brand-ink hover:text-ink rounded-lg text-xs font-semibold transition cursor-pointer"
                      >
                        <Headphones className="w-3.5 h-3.5" />
                        <span>Review</span>
                      </button>
                    </td>
                    <td className="py-4 px-6 font-bold text-ink">{record.student?.full_name}</td>
                    <td className="py-4 px-6 tabular-nums text-xs">{record.student?.school_id}</td>
                    <td className="py-4 px-6">{record.student?.class?.class_name}</td>
                    <td className="py-4 px-6 text-ink-muted font-medium truncate max-w-[150px]" title={record.feedback?.material_title || record.feedback?.motion || 'Default Material'}>
                      {record.feedback?.material_title || record.feedback?.motion || 'Default Material'}
                    </td>
                    <td className="py-4 px-6 text-ink-muted tabular-nums text-xs">
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
          <div className="flex items-center justify-between px-6 py-4 bg-surface-muted border-t border-line">
            <span className="text-xs text-ink-muted">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filtered.length)} of {filtered.length} entries
            </span>
            <div className="flex space-x-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-xs font-medium rounded-md bg-surface-muted text-ink-muted disabled:opacity-50 disabled:cursor-not-allowed hover:bg-line"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={currentPage * itemsPerPage >= filtered.length}
                className="px-3 py-1 text-xs font-medium rounded-md bg-surface-muted text-ink-muted disabled:opacity-50 disabled:cursor-not-allowed hover:bg-line"
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
