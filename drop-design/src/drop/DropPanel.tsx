import { Link } from 'react-router-dom';
import { useEditor } from '../store/editor';

export function DropPanel() {
  const linked = useEditor((s) => s.design?.dropEventId);
  return (
    <div className="space-y-4 text-sm">
      <p>Make artwork for a Drop special class or workshop. When it’s ready, click <strong>Send to Drop</strong> (top right) to approve it. It’s added to the event in the app straight away.</p>
      {linked ? <p className="rounded-xl bg-emerald-50 p-3 text-emerald-800">This design is linked to a Drop event.</p> : null}
      <Link to="/drop" className="btn-primary w-full">Start from an event brief</Link>
      <p className="text-xs text-muted">Describe the look you want, add the pictures that must be used, and get four design options to choose from.</p>
    </div>
  );
}
