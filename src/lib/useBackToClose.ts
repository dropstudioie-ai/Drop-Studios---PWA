import { useEffect, useRef } from 'react';

/** While a full-screen overlay is open, the phone's back button (or a swipe back) closes it instead of leaving the page. */
export function useBackToClose(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    window.history.pushState({ overlay: true }, '');
    let closedByBack = false;
    const onPop = () => { closedByBack = true; close.current(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!closedByBack && window.history.state?.overlay) window.history.back();   // closed with the button: drop our history entry
    };
  }, []);
}
