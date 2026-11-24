/**
 * Configuração e filtragem por domínio do Curador (OracleWidget) — v2.4.0 Fase 5.
 * Adapta presets de humor, rótulos, placeholders e escopo da fila ao domínio ativo
 * (Cinema, Leitura, Games, Música ou Todos).
 */

import { inferDomainFromWork, normalizeDomainId } from '../config/domainConfig.js';

export const ORACLE_DOMAIN_CONFIG = Object.freeze({
  cinema: Object.freeze({
    domain: 'cinema',
    title: 'Curador de Cinema',
    subtitle: 'Cruza clima, DNA e sua fila de Cinema',
    actionLabel: 'Sugerir Sessão',
    aiActionLabel: 'Consultar Curador',
    iconName: 'Film',
    emptyQueueNotice:
      'Adicione pelo menos um filme, série ou anime na fila "Quero Ver" para gerar uma sugestão.',
    placeholder:
      'Ou descreva o clima (ex: suspense de 90 min para ver hoje à noite)...',
    alternativesHeading: 'Outras opções da sua fila de Cinema:',
    presets: Object.freeze([
      Object.freeze({ id: 'Imersão Épica', label: 'Imersão Épica', icon: 'Mountain' }),
      Object.freeze({ id: 'Sessão Leve', label: 'Sessão Leve', icon: 'Feather' }),
      Object.freeze({ id: 'Suspense Sombrio', label: 'Suspense / Noir', icon: 'Moon' }),
      Object.freeze({ id: 'Drama & Reflexão', label: 'Drama & Reflexão', icon: 'Compass' }),
      Object.freeze({ id: 'Maratona Sci-Fi / Anime', label: 'Sci-Fi & Anime', icon: 'Cpu' }),
    ]),
  }),
  reading: Object.freeze({
    domain: 'reading',
    title: 'Curador de Leitura',
    subtitle: 'Sugere a próxima leitura da sua fila',
    actionLabel: 'Sugerir Leitura',
    aiActionLabel: 'Consultar Curador',
    iconName: 'BookOpen',
    emptyQueueNotice:
      'Adicione pelo menos um livro, mangá ou HQ na fila "Quero Ler" para gerar uma sugestão.',
    placeholder:
      'Ou descreva o clima (ex: ficção científica curta para ler no fim de semana)...',
    alternativesHeading: 'Outras opções da sua fila de Leitura:',
    presets: Object.freeze([
      Object.freeze({ id: 'Imersão Literária', label: 'Imersão Literária', icon: 'BookOpen' }),
      Object.freeze({ id: 'Leitura Curta', label: 'Leitura Curta', icon: 'Feather' }),
      Object.freeze({ id: 'Mistério & Suspense', label: 'Mistério & Suspense', icon: 'Moon' }),
      Object.freeze({ id: 'Não-Ficção & Ideias', label: 'Ideias & Ensaios', icon: 'Compass' }),
      Object.freeze({ id: 'Fantasia & Mangá', label: 'Fantasia & Mangá', icon: 'Sparkles' }),
    ]),
  }),
  games: Object.freeze({
    domain: 'games',
    title: 'Curador de Games',
    subtitle: 'Escolhe o próximo jogo do seu catálogo',
    actionLabel: 'Sugerir Jogo',
    aiActionLabel: 'Consultar Curador',
    iconName: 'Gamepad2',
    emptyQueueNotice:
      'Adicione pelo menos um jogo na fila "Quero Jogar" para gerar uma sugestão.',
    placeholder:
      'Ou descreva o clima (ex: indie curto de 8h para jogar sem pressa)...',
    alternativesHeading: 'Outras opções da sua fila de Games:',
    presets: Object.freeze([
      Object.freeze({ id: 'Campanha Épica', label: 'Campanha Épica', icon: 'Mountain' }),
      Object.freeze({ id: 'Indie Curto', label: 'Indie Curto', icon: 'Feather' }),
      Object.freeze({ id: 'Atmosfera Sombria', label: 'Atmosfera Sombria', icon: 'Moon' }),
      Object.freeze({ id: 'Narrativa & RPG', label: 'Narrativa & RPG', icon: 'Compass' }),
      Object.freeze({ id: 'Ação & Desafio', label: 'Ação & Desafio', icon: 'Flame' }),
    ]),
  }),
  music: Object.freeze({
    domain: 'music',
    title: 'Curador Musical',
    subtitle: 'Escolhe o próximo álbum ou disco da fila',
    actionLabel: 'Sugerir Audição',
    aiActionLabel: 'Consultar Curador',
    iconName: 'Music',
    emptyQueueNotice:
      'Adicione pelo menos um álbum ou disco na fila "Quero Ouvir" para gerar uma sugestão.',
    placeholder:
      'Ou descreva o clima (ex: álbum atmosférico para ouvir inteiro à noite)...',
    alternativesHeading: 'Outras opções da sua fila de Música:',
    presets: Object.freeze([
      Object.freeze({ id: 'Álbum Completo', label: 'Álbum Completo', icon: 'Music' }),
      Object.freeze({ id: 'Audição Leve', label: 'Audição Leve', icon: 'Feather' }),
      Object.freeze({ id: 'Noturno & Atmosférico', label: 'Noturno', icon: 'Moon' }),
      Object.freeze({ id: 'Clássico Essencial', label: 'Clássico', icon: 'Compass' }),
      Object.freeze({ id: 'Energia & Ritmo', label: 'Energia & Ritmo', icon: 'Flame' }),
    ]),
  }),
  all: Object.freeze({
    domain: 'all',
    title: 'Curador OmniPrism',
    subtitle: 'Cruza clima e sua fila nos 4 mundos',
    actionLabel: 'Sugerir Obra',
    aiActionLabel: 'Consultar Curador',
    iconName: 'Layers',
    emptyQueueNotice:
      'Adicione pelo menos uma obra na fila para receber uma sugestão do curador.',
    placeholder:
      'Ou descreva o clima (ex: algo curto e envolvente para hoje à noite)...',
    alternativesHeading: 'Outras opções da sua fila:',
    presets: Object.freeze([
      Object.freeze({ id: 'Imersão Épica', label: 'Imersão Épica', icon: 'Mountain' }),
      Object.freeze({ id: 'Sessão Leve', label: 'Leve & Curto', icon: 'Feather' }),
      Object.freeze({ id: 'Atmosfera Sombria', label: 'Sombrio', icon: 'Moon' }),
      Object.freeze({ id: 'Reflexão & Clássico', label: 'Reflexão', icon: 'Compass' }),
      Object.freeze({ id: 'Descoberta', label: 'Descoberta', icon: 'Sparkles' }),
    ]),
  }),
});

export function getOracleConfigForDomain(domain = 'cinema') {
  if (domain === 'all') return ORACLE_DOMAIN_CONFIG.all;
  const clean = normalizeDomainId(domain);
  return ORACLE_DOMAIN_CONFIG[clean] || ORACLE_DOMAIN_CONFIG.cinema;
}

export function scopeOracleItemsForDomain(items = [], domain = 'cinema') {
  const backlog = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.inBacklog !== false
  );
  const scoped =
    domain === 'all'
      ? backlog
      : backlog.filter((item) => inferDomainFromWork(item) === normalizeDomainId(domain));

  return {
    scopedItems: scoped,
    queuedItems: scoped.filter((item) => item.status === 'queued'),
    completedItems: scoped.filter((item) => item.status === 'completed'),
  };
}
