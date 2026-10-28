import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from './UI/Logo';

function NotFound() {
  return (
    <div className="min-h-screen bg-canvas text-ink flex items-center justify-center p-4">
      <div className="text-center flex flex-col items-center gap-4 max-w-md">
        <Logo size="lg" markOnly />
        <p className="text-[13px] font-semibold text-brand-ink">Error 404</p>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">This page does not exist</h1>
        <p className="text-[15px] text-ink-muted">
          The link may be old or mistyped. Go back to the start and try again.
        </p>
        <Link
          to="/"
          className="mt-2 inline-flex items-center justify-center min-h-[44px] px-5 rounded-[10px] bg-brand hover:bg-brand-hover text-white text-sm font-semibold transition-colors"
        >
          Go to the start page
        </Link>
      </div>
    </div>
  );
}

export default NotFound;
