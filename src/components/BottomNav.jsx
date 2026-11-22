import { BarChart2, Home, Library, PlusCircle, User } from 'lucide-react';
import { domainConfig } from '../config/domainConfig';

const ICONS = {
  Home,
  BarChart2,
  PlusCircle,
  Library,
  User,
};

export function BottomNav({ activeTab, onChangeTab }) {
  const navItems = domainConfig.navigation.filter(
    (item) => item.id !== 'community'
  );

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed bottom-0 left-0 right-0 z-40"
    >
      <div className="mx-auto max-w-md md:max-w-2xl lg:max-w-4xl border-t border-line bg-app/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <div
          className="grid h-16 items-center px-2"
          style={{
            gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))`,
          }}
        >
          {navItems.map((item) => {
            const Icon = ICONS[item.icon] || Home;
            const isActive = activeTab === item.id;

            if (item.isCenterHighlight) {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeTab(item.id)}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  className="group flex flex-col items-center justify-center gap-0.5 min-h-[44px] focus:outline-none"
                >
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-[4px] transition-colors duration-200 ${
                      isActive
                        ? 'bg-accent text-accent-ink border border-accent'
                        : 'border border-accent/40 bg-accent/10 text-accent group-hover:bg-accent/20'
                    }`}
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.5} />
                  </span>
                  <span
                    className={`text-[10px] font-medium tracking-tight transition-colors ${
                      isActive ? 'text-ink' : 'text-accent'
                    }`}
                  >
                    {item.label}
                  </span>
                </button>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeTab(item.id)}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className="relative flex flex-col items-center justify-center gap-1 py-1 min-h-[44px] transition-colors focus:outline-none"
              >
                <span className="relative inline-flex items-center justify-center">
                  <Icon
                    className={`h-5 w-5 transition-colors ${
                      isActive ? 'text-accent' : 'text-subtle hover:text-muted'
                    }`}
                    strokeWidth={1.5}
                  />
                </span>
                <span
                  className={`text-[10px] font-medium tracking-tight transition-colors ${
                    isActive ? 'text-ink' : 'text-subtle'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
