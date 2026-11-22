export function SkeletonScreen({ variant = 'home' }) {
  if (variant === 'list') {
    return (
      <div className="space-y-4 py-2" aria-busy="true" aria-label="Carregando catálogo">
        <div className="flex items-center justify-between gap-2">
          <div className="h-6 w-28 rounded-[4px] bg-card" />
          <div className="flex gap-1.5">
            <div className="h-10 w-24 rounded-[4px] bg-card" />
            <div className="h-10 w-20 rounded-[4px] bg-card" />
          </div>
        </div>
        <div className="h-11 w-full rounded-[4px] border border-line bg-card" />
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-3">
          {Array.from({ length: 12 }).map((_, idx) => (
            <div key={idx} className="space-y-1.5">
              <div className="aspect-[2/3] w-full rounded-[4px] border border-line bg-card" />
              <div className="h-3 w-4/5 rounded-[2px] bg-card" />
              <div className="h-2.5 w-1/2 rounded-[2px] bg-card" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'stats' || variant === 'profile') {
    return (
      <div className="space-y-4 py-2" aria-busy="true" aria-label="Carregando conteúdo">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-full border border-line bg-card" />
          <div className="space-y-2 flex-1">
            <div className="h-5 w-44 rounded-[4px] bg-card" />
            <div className="h-3 w-28 rounded-[4px] bg-card" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-20 rounded-[6px] border border-line bg-card" />
          ))}
        </div>
        <div className="h-44 w-full rounded-[6px] border border-line bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2" aria-busy="true" aria-label="Carregando tela">
      <div className="h-7 w-40 rounded-[4px] bg-card" />
      <div className="h-24 w-full rounded-[6px] border border-line bg-card" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="h-32 rounded-[6px] border border-line bg-card" />
        <div className="h-32 rounded-[6px] border border-line bg-card" />
      </div>
    </div>
  );
}
