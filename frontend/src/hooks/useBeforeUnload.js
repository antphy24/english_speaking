import { useEffect } from 'react';

export default function useBeforeUnload(shouldWarn, message = "You have unsaved changes or active recordings. Are you sure you want to leave?") {
  useEffect(() => {
    if (!shouldWarn) return;
    
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = message;
      return message;
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldWarn, message]);
}
