import {
  Bookmark,
  CheckCircle2,
  PauseCircle,
  Play,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { getStatusConfigForDomain } from '../config/domainConfig';

const STATUS_SHAPES = {
  queued: Bookmark,
  playing: Play,
  completed: CheckCircle2,
  paused: PauseCircle,
  rewatching: RotateCcw,
  dropped: XCircle,
};

export function StatusBadge({ statusId, domain = 'cinema', size = 'sm' }) {
  const status = getStatusConfigForDomain(statusId, domain);
  const ShapeIcon = STATUS_SHAPES[status.id] || Bookmark;
  const sizeClasses =
    size === 'xs'
      ? 'px-1.5 py-0.5 text-[10px]'
      : 'px-2 py-0.5 text-[11px]';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${status.badgeClass} ${sizeClasses}`}
    >
      <ShapeIcon className="h-2.5 w-2.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span>{status.label}</span>
    </span>
  );
}
