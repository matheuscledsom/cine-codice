import { domainConfig } from '../config/domainConfig';
import { CoverImage } from './CoverImage';

export function CoverArt({
  item,
  className = '',
  showTitle = false,
  compact = false,
  priority = false,
}) {
  if (!item) return null;

  const primaryBadge = item[domainConfig.cardFields.primary];
  const creator =
    item[domainConfig.cardFields.creator] ||
    item.director ||
    item.studio ||
    item.author ||
    '';

  const sources = [
    ...(Array.isArray(item.coverCandidates) ? item.coverCandidates : []),
    ...(Array.isArray(item.coverSources) ? item.coverSources : []),
    item.coverUrl,
    item.thumbnailUrl,
    ...(Array.isArray(item.jikanCoverUrls) ? item.jikanCoverUrls : []),
    item.backdropUrl,
  ].filter(Boolean);

  return (
    <CoverImage
      sources={sources}
      title={item.title}
      director={creator}
      workType={item.workType || 'movie'}
      releaseYear={item.releaseYear || ''}
      genre={Array.isArray(item.genres) ? item.genres[0] || '' : ''}
      badge={primaryBadge}
      className={className}
      showTitle={showTitle}
      compact={compact}
      priority={priority}
    />
  );
}
