import { getMediaTypesForDomain, inferDomainFromWork } from '../config/domainConfig';
import { VectorIcon } from './VectorIcon';

export function WorkTypeSelector({
  value = 'movie',
  domain = null,
  onChange,
  label,
}) {
  const activeDomain = domain || inferDomainFromWork({ workType: value });
  const mediaTypes = getMediaTypesForDomain(activeDomain);
  const colsClass = mediaTypes.length >= 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3';

  return (
    <div>
      {label && (
        <p className="mb-2 text-xs font-medium text-muted">{label}</p>
      )}
      <div className={`grid gap-2 ${colsClass}`}>
        {mediaTypes.map((type) => {
          const isSelected = (value || mediaTypes[0]?.id) === type.id;
          return (
            <button
              key={type.id}
              type="button"
              onClick={() => onChange(type.id)}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 py-2.5 text-center transition-colors ${
                isSelected
                  ? 'border-accent bg-accent/15 text-ink'
                  : 'border-line bg-app text-muted hover:text-ink'
              }`}
            >
              <VectorIcon
                name={type.icon}
                className={`h-4 w-4 ${isSelected ? 'text-accent' : 'text-subtle'}`}
              />
              <span className="line-clamp-1 text-[11px] font-medium leading-tight">
                {type.shortLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
