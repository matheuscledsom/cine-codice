import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  PROFILE_AVATAR_EMBLEMS,
  buildProfilePersonalFeed,
  resolveTop4Favorites,
} from '../src/lib/profileMetrics.js';

describe('FASE 5 (v1.2.0) — Perfil Editorial (Vitrine Top 4 Favoritos, Avatar Customizável & Remoção do Código Social)', () => {
  it('resolveTop4Favorites monta a grade de 4 slots (1..4) e preserva slots vazios para "+ Escolher favorito"', () => {
    const items = [
      { id: 'w-1', title: 'A Viagem de Chihiro', favoriteRank: 1 },
      { id: 'w-3', title: 'Blade Runner 2049', favoriteRank: 3 },
      { id: 'w-other', title: 'Duna', favoriteRank: null },
    ];

    const slots = resolveTop4Favorites(items);
    assert.equal(slots.length, 4);
    assert.equal(slots[0].slot, 1);
    assert.equal(slots[0].work?.id, 'w-1');
    assert.equal(slots[1].slot, 2);
    assert.equal(slots[1].work, null);
    assert.equal(slots[2].slot, 3);
    assert.equal(slots[2].work?.id, 'w-3');
    assert.equal(slots[3].slot, 4);
    assert.equal(slots[3].work, null);
  });

  it('PROFILE_AVATAR_EMBLEMS oferece os 8 emblemas cinematográficos minimalistas e ImageCropModal redimensiona avatar em 256x256 px', () => {
    assert.equal(PROFILE_AVATAR_EMBLEMS.length, 8);
    assert.deepEqual(
      PROFILE_AVATAR_EMBLEMS.map((e) => e.id),
      ['Film', 'Clapperboard', 'Tv', 'Sparkles', 'Award', 'Compass', 'Flame', 'Star']
    );

    const cropSrc = fs.readFileSync(
      path.resolve('src/components/ImageCropModal.jsx'),
      'utf8'
    );
    assert.match(cropSrc, /const outW = isAvatar \? 256 : 1200/);
    assert.match(cropSrc, /const outH = isAvatar \? 256 : 450/);
  });

  it('buildProfilePersonalFeed extrai cenas favoritas, avaliações confirmadas e episódios vistos do acervo', () => {
    const items = [
      {
        id: 'eva',
        title: 'Neon Genesis Evangelion',
        workType: 'anime',
        status: 'completed',
        rating: 96,
        ratingSource: 'manual',
        favoriteScene: 'Eu não devo fugir.',
        notes: 'Direção magistral de Hideaki Anno.',
        updatedAt: '2026-11-22T14:00:00Z',
      },
      {
        id: 'spn',
        title: 'Sobrenatural',
        workType: 'series',
        status: 'playing',
        currentSeason: 2,
        currentEpisode: 5,
        updatedAt: '2026-11-21T10:00:00Z',
      },
    ];

    const feed = buildProfilePersonalFeed(items, []);
    assert.equal(feed.length >= 3, true);
    assert.equal(feed.some((e) => e.kind === 'scene' && e.quoteText === 'Eu não devo fugir.'), true);
    assert.equal(feed.some((e) => e.kind === 'review' && e.rating === 96), true);
    assert.equal(feed.some((e) => e.kind === 'progress' && e.badge.includes('T2 · Ep. 5')), true);
  });

  it('R6 — Todos os 10 arquivos sociais mortos foram fisicamente removidos e não há imports órfãos em src/', () => {
    const deletedFiles = [
      'src/components/social/CommunityScreen.jsx',
      'src/components/social/ProfileWall.jsx',
      'src/components/social/DirectChatDrawer.jsx',
      'src/components/social/UserProfileModal.jsx',
      'src/components/social/FriendProfileCardModal.jsx',
      'src/components/social/ShareProfileCardModal.jsx',
      'src/components/social/ActivityFeed.jsx',
      'src/components/auth/AuthModal.jsx',
      'src/components/BuddyReadPanel.jsx',
      'src/services/buddyReadService.js',
    ];

    for (const rel of deletedFiles) {
      assert.equal(
        fs.existsSync(path.resolve(rel)),
        false,
        `Arquivo social morto ainda existe: ${rel}`
      );
    }

    const appSrc = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8');
    assert.equal(/CommunityScreen|DirectChatDrawer|ProfileWall|AuthModal|BuddyReadPanel/.test(appSrc), false);
  });
});
